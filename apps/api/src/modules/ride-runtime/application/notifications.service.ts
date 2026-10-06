import {
  ConflictException,
  Injectable,
  NotFoundException,
  type OnModuleInit,
  type OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { RuntimeService } from './runtime.service.js';
import { RuntimeStreams } from '../infrastructure/runtime-streams.js';
import {
  DeliveryError,
  NotificationProviders,
} from '../infrastructure/notification-providers.js';

interface Delivery {
  attempt_id: string;
  intent_id: string;
  ride_id: string;
  recipient_id: string;
  device_id: string;
  platform: 'android' | 'ios';
  token_encrypted: string;
  kind: string;
  expires_at: Date;
  attempts: number;
}
@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly owner = randomUUID();
  private timer?: ReturnType<typeof setTimeout>;
  private safetyTimer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private readonly logger = new Logger(NotificationsService.name);
  constructor(
    private readonly runtime: RuntimeService,
    private readonly streams: RuntimeStreams,
    private readonly providers: NotificationProviders,
    private readonly config: ConfigService,
  ) {}
  onModuleInit() {
    if (this.streams.enabled && this.streams.worker) {
      this.schedule();
      this.scheduleSafety();
    }
  }
  private schedule() {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.dispatch()
        .catch(() => this.logger.error('notifications_dispatch_failed'))
        .finally(() => this.schedule());
    }, 500);
  }
  private scheduleSafety() {
    if (this.stopped) return;
    this.safetyTimer = setTimeout(() => {
      void this.escalateDue()
        .catch(() => this.logger.error('safety_dispatch_failed'))
        .finally(() => this.scheduleSafety());
    }, 250);
  }
  async register(
    actor: string,
    deviceId: string,
    platform: 'android' | 'ios',
    token: string,
  ) {
    if (!token.trim()) throw new ConflictException('Token vacío');
    await this.runtime.db.transaction(async (client) => {
      // A device changing accounts must not retain subscriptions for the former user.
      await client.query(
        'update krow_runtime.devices set revoked_at=now() where device_id=$1 and actor_id<>$2',
        [deviceId, actor],
      );
      await client.query(
        `insert into krow_runtime.devices(actor_id,device_id,platform,token_encrypted) values($1,$2,$3,$4)
        on conflict(actor_id,device_id) do update set platform=excluded.platform,token_encrypted=excluded.token_encrypted,updated_at=now(),revoked_at=null`,
        [actor, deviceId, platform, this.providers.encrypt(token)],
      );
    });
    return { registered: true };
  }
  async revoke(actor: string, deviceId: string) {
    await this.runtime.db.query(
      'update krow_runtime.devices set revoked_at=now() where actor_id=$1 and device_id=$2',
      [actor, deviceId],
    );
    return { revoked: true };
  }
  async acknowledge(actor: string, intentId: string) {
    const rows = await this.runtime.db.query(
      'update krow_runtime.notification_intents set acknowledged_at=coalesce(acknowledged_at,now()) where intent_id=$1 and recipient_id=$2 returning intent_id',
      [intentId, actor],
    );
    if (!rows.length) throw new NotFoundException();
    return { acknowledged: true };
  }
  async inbox(actor: string) {
    return this.runtime.db.query(
      'select intent_id as "intentId",ride_id as "rideId",kind,created_at as "createdAt",expires_at as "expiresAt",acknowledged_at as "acknowledgedAt" from krow_runtime.notification_intents where recipient_id=$1 and created_at>now()-interval \'30 days\' order by created_at desc limit 100',
      [actor],
    );
  }
  async incident(actor: string, rideId: string, id: string, severity: string) {
    await this.runtime.authorize(actor, rideId);
    return this.runtime.db.transaction(async (client) => {
      await client.query(
        'select pg_advisory_xact_lock(hashtextextended($1,0))',
        [id],
      );
      const existing = await client.query<{
        reporter_id: string;
        ride_id: string;
        severity: string;
        acknowledged_at: Date | null;
      }>(
        'select reporter_id,ride_id,severity,acknowledged_at from krow_runtime.safety_incidents where incident_id=$1',
        [id],
      );
      if (
        existing.rows[0] &&
        (existing.rows[0].reporter_id !== actor ||
          existing.rows[0].ride_id !== rideId ||
          existing.rows[0].severity !== severity)
      )
        throw new ConflictException('Identificador de incidente reutilizado');
      await client.query(
        'insert into krow_runtime.safety_incidents(incident_id,ride_id,reporter_id,severity) values($1,$2,$3,$4) on conflict do nothing',
        [id, rideId, actor, severity],
      );
      await client.query(
        "insert into krow_runtime.notification_intents(ride_id,recipient_id,event_key,kind,expires_at) values($1,$2,$3,'safety',now()+interval '24 hours') on conflict do nothing",
        [rideId, actor, id],
      );
      return {
        incidentId: id,
        status: 'sent',
        humanAcknowledged: Boolean(existing.rows[0]?.acknowledged_at),
      };
    });
  }
  async incidentAction(
    actor: string,
    id: string,
    state: 'acknowledged' | 'responding' | 'resolved',
  ) {
    return this.runtime.db.transaction(async (client) => {
      const incident = await client.query<{
        state: string;
        assigned_to: string | null;
      }>(
        'select state,assigned_to from krow_runtime.safety_incidents where incident_id=$1 for update',
        [id],
      );
      const row = incident.rows[0];
      if (!row) throw new NotFoundException();
      if (row.assigned_to && row.assigned_to !== actor)
        throw new ConflictException(
          'Otro agente está atendiendo este incidente',
        );
      if (row.state === state) return { incidentId: id, state };
      const previous =
        state === 'acknowledged'
          ? 'open'
          : state === 'responding'
            ? 'acknowledged'
            : 'responding';
      const rows = await client.query(
        `update krow_runtime.safety_incidents set state=$2,assigned_to=$3,
      acknowledged_at=coalesce(acknowledged_at,now()),resolved_at=case when $2='resolved' then now() else resolved_at end
      where incident_id=$1 and (state=$4 or (state=$2 and assigned_to=$3)) returning incident_id`,
        [id, state, actor, previous],
      );
      if (!rows.rowCount) throw new ConflictException('El incidente cambió');
      await client.query(
        'insert into krow_runtime.incident_audit(incident_id,actor_id,previous_state,state) values($1,$2,$3,$4)',
        [id, actor, previous, state],
      );
      return { incidentId: id, state };
    });
  }
  async dispatch() {
    const db = this.runtime.db;
    // Invalidate before claiming delivery, including messages that waited in a retry queue.
    await db.query(`update krow_runtime.notification_intents n set expires_at=now()
      where n.expires_at>now() and (
        (n.kind in ('proximity','route_changed') and not exists(select 1 from public.bookings b join krow_runtime.rides r using(ride_id) where b.ride_id=n.ride_id and b.user_id=n.recipient_id and b.status in ('confirmed','in_progress') and r.state in ('scheduled','in_progress')))
        or (n.kind='proximity' and exists(select 1 from krow_runtime.stop_visits v where v.ride_id=n.ride_id and v.stop_id::text=split_part(n.event_key,':',2) and v.state not in ('pending','approaching')))
        or (n.kind='route_changed' and exists(select 1 from krow_runtime.notification_intents newer where newer.ride_id=n.ride_id and newer.recipient_id=n.recipient_id and newer.kind=n.kind and newer.created_at>n.created_at))
      )`);
    await db.query(`insert into krow_runtime.delivery_attempts(intent_id,device_id,channel,status)
      select n.intent_id,d.device_id,d.platform,'pending' from krow_runtime.notification_intents n join krow_runtime.devices d on d.actor_id=n.recipient_id
      where n.expires_at>now() and n.acknowledged_at is null and d.revoked_at is null on conflict do nothing`);
    const attempts = await db.query<Delivery>(
      `with candidates as (
      select a.attempt_id from krow_runtime.delivery_attempts a join krow_runtime.notification_intents n using(intent_id)
      join krow_runtime.devices d on d.device_id=a.device_id and d.actor_id=n.recipient_id
      where a.status in ('pending','failed','leased') and a.attempts<8 and a.next_attempt_at<=now() and (a.lease_until is null or a.lease_until<now())
      and n.expires_at>now() and n.acknowledged_at is null and d.revoked_at is null order by a.next_attempt_at limit 25 for update of a skip locked
    ), claimed as (update krow_runtime.delivery_attempts a set status='leased',lease_owner=$1,lease_until=now()+interval '30 seconds',attempts=attempts+1 from candidates c where a.attempt_id=c.attempt_id returning a.*)
    select a.attempt_id,a.attempts,a.device_id,n.*,d.platform,d.token_encrypted from claimed a join krow_runtime.notification_intents n using(intent_id) join krow_runtime.devices d on d.device_id=a.device_id and d.actor_id=n.recipient_id`,
      [this.owner],
    );
    await Promise.all(
      attempts.map(async (a) => {
        try {
          const providerId = await this.providers.push(
            a.platform,
            this.providers.decrypt(a.token_encrypted),
            {
              intentId: a.intent_id,
              rideId: a.ride_id,
              kind: a.kind,
              expiresAt: a.expires_at,
            },
          );
          await db.query(
            "update krow_runtime.delivery_attempts set status='accepted',provider_id=$3,lease_until=null,updated_at=now() where attempt_id=$1 and lease_owner=$2",
            [a.attempt_id, this.owner, providerId],
          );
        } catch (error) {
          const permanent = error instanceof DeliveryError && error.permanent;
          await db.query(
            "update krow_runtime.delivery_attempts set status=$3,error_code=$4,lease_until=null,next_attempt_at=now()+($5::int*interval '1 second'),updated_at=now() where attempt_id=$1 and lease_owner=$2",
            [
              a.attempt_id,
              this.owner,
              permanent ? 'expired' : 'failed',
              error instanceof DeliveryError ? error.code : 'provider_error',
              Math.min(300, 2 ** a.attempts) + Math.floor(Math.random() * 3),
            ],
          );
          if (permanent)
            await db.query(
              'update krow_runtime.devices set revoked_at=now() where actor_id=$1 and device_id=$2',
              [a.recipient_id, a.device_id],
            );
        }
      }),
    );
  }
  async escalateDue() {
    const db = this.runtime.db;
    const incidents = await db.query<{
      incident_id: string;
      escalation_level: number;
    }>(
      `update krow_runtime.safety_incidents set lease_owner=$1,lease_until=now()+interval '30 seconds'
      where incident_id in(select incident_id from krow_runtime.safety_incidents where state='open' and next_escalation_at<=now() and (lease_until is null or lease_until<now()) and escalation_level<3 order by created_at limit 10 for update skip locked)
      returning incident_id,escalation_level`,
      [this.owner],
    );
    await Promise.all(
      incidents.map(async (incident) => {
        try {
          await this.providers.escalate(
            incident.incident_id,
            incident.escalation_level,
          );
          // SMS is supplementary; a failure must not suppress the next guard escalation.
          const phone = this.config.get<string>(
            incident.escalation_level === 1
              ? 'SAFETY_BACKUP_PHONE'
              : 'SAFETY_SUPERVISOR_PHONE',
          );
          if (incident.escalation_level > 0 && phone)
            await this.providers
              .sms(
                phone,
                `KROW: incidente ${incident.incident_id} pendiente de atención.`,
              )
              .catch(() => this.logger.warn('safety_sms_failed'));
          await db.query(
            "update krow_runtime.safety_incidents set escalation_level=escalation_level+1,lease_until=null,next_escalation_at=created_at+((escalation_level+1)*interval '30 seconds') where incident_id=$1 and escalation_level=$2 and state='open' and lease_owner=$3",
            [incident.incident_id, incident.escalation_level, this.owner],
          );
        } catch {
          this.logger.error('safety_escalation_failed');
        }
      }),
    );
  }
  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.safetyTimer) clearTimeout(this.safetyTimer);
  }
}
