import {
  Injectable,
  ServiceUnavailableException,
  ForbiddenException,
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { PilotDatabase } from './pilot.database.js';
import {
  NotificationProviders,
  DeliveryError,
} from '../ride-runtime/infrastructure/notification-providers.js';
interface Intent {
  intent_id: string;
  ride_id: string;
  booking_id: string | null;
  recipient_id: string;
  kind: string;
  expires_at: Date;
  attempts: number;
}
@Injectable()
export class PilotNotifications implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private readonly logger = new Logger(PilotNotifications.name);
  constructor(
    private readonly db: PilotDatabase,
    private readonly config: ConfigService,
    private readonly provider: NotificationProviders,
  ) {}
  get enabled() {
    return (
      this.db.enabled &&
      this.config.get<string>('PILOT_PUSH_ENABLED') === 'true'
    );
  }
  private key() {
    return Buffer.from(
      this.config.getOrThrow<string>('PILOT_PUSH_ENCRYPTION_KEY'),
      'base64',
    );
  }
  // Tokens never appear in database plaintext, errors, or logs.
  private seal(token: string) {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const value = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), value]
      .map((x) => x.toString('base64'))
      .join('.');
  }
  private open(value: string) {
    const [iv, tag, data] = value
      .split('.')
      .map((x) => Buffer.from(x, 'base64'));
    const cipher = createDecipheriv('aes-256-gcm', this.key(), iv);
    cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(data), cipher.final()]).toString(
      'utf8',
    );
  }
  async register(actorId: string, deviceId: string, token: string) {
    if (!this.enabled)
      throw new ServiceUnavailableException('Notificaciones no habilitadas');
    await this.db.transaction(async (client) => {
      // Closure locks this same user before removing devices. A late opt-in
      // cannot recreate a registration after the account has been closed.
      const profile = await client.query<{
        is_active: boolean | null;
        deleted_at: Date | null;
      }>(
        'select is_active,deleted_at from public.users where uuid=$1 for share',
        [actorId],
      );
      if (
        !profile.rows[0] ||
        profile.rows[0].is_active === false ||
        profile.rows[0].deleted_at
      )
        throw new ForbiddenException('Esta cuenta está desactivada');
      const result = await client.query<{ device_id: string }>(
        `insert into krow_pilot.devices(device_id,actor_id,token_encrypted) values($1,$2,$3) on conflict(device_id) do update set token_encrypted=$3,updated_at=now() where devices.actor_id=excluded.actor_id returning device_id`,
        [deviceId, actorId, this.seal(token)],
      );
      if (!result.rows.length)
        throw new ForbiddenException(
          'El dispositivo no pertenece a esta cuenta',
        );
    });
    return { success: true };
  }
  async unregister(actorId: string, deviceId: string) {
    await this.db.query(
      'delete from krow_pilot.devices where device_id=$1 and actor_id=$2',
      [deviceId, actorId],
    );
    return { success: true };
  }
  onModuleInit() {
    if (this.enabled) this.schedule();
  }
  private schedule() {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.dispatch()
        .catch(() => this.logger.error('pilot_push_dispatch_failed'))
        .finally(() => this.schedule());
    }, 1000);
  }
  async dispatch() {
    const intents = await this.db
      .query<Intent>(`with due as(select intent_id from krow_pilot.outbox where status='pending' and next_at<=now() and (lease_until is null or lease_until<now()) order by next_at for update skip locked limit 20)
      update krow_pilot.outbox o set lease_until=now()+interval '2 minutes',attempts=attempts+1 from due where o.intent_id=due.intent_id returning o.*`);
    for (const intent of intents) {
      if (intent.expires_at.getTime() <= Date.now()) {
        await this.done(intent, 'expired');
        continue;
      }
      const devices = await this.db.query<{
        device_id: string;
        token_encrypted: string;
      }>(
        `select d.device_id,d.token_encrypted from krow_pilot.devices d join public.users u on u.uuid=d.actor_id
        where d.actor_id=$1 and u.is_active is distinct from false and u.deleted_at is null and
        ($2!='proximity' or exists(select 1 from public.bookings b join public.rides r using(ride_id) join public.driver_profiles dp using(driver_id) where b.booking_id=$3 and r.status='in_progress' and b.status in ('confirmed','in_progress') and (b.user_id=$1 or dp.user_id=$1)))`,
        [intent.recipient_id, intent.kind, intent.booking_id],
      );
      try {
        for (const device of devices) {
          try {
            await this.provider.push(
              'android',
              this.open(device.token_encrypted),
              {
                intentId: intent.intent_id,
                rideId: intent.ride_id,
                kind: intent.kind,
                recipientId: intent.recipient_id,
                expiresAt: intent.expires_at,
              },
            );
          } catch (error) {
            if (error instanceof DeliveryError && error.permanent)
              await this.db.query(
                'delete from krow_pilot.devices where device_id=$1 and actor_id=$2 and token_encrypted=$3',
                [device.device_id, intent.recipient_id, device.token_encrypted],
              );
            else throw error;
          }
        }
        // No device yet: leave retryable until expiration, enabling registration.
        if (!devices.length) throw new Error('device_unavailable');
        await this.done(intent, 'accepted');
      } catch {
        if (intent.attempts >= 8) await this.done(intent, 'failed');
        else
          await this.db.query(
            "update krow_pilot.outbox set lease_until=null,next_at=now()+($2::integer*interval '1 second') where intent_id=$1",
            [intent.intent_id, Math.min(120, 2 ** intent.attempts)],
          );
      }
    }
  }
  private async done(intent: Intent, status: string) {
    await this.db.query(
      'update krow_pilot.outbox set status=$2,lease_until=null where intent_id=$1',
      [intent.intent_id, status],
    );
  }
  onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
  }
}
