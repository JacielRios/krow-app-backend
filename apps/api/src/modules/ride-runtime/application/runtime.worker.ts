import {
  Injectable,
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RuntimeDatabase } from '../infrastructure/runtime-database.js';
import { RuntimeStreams } from '../infrastructure/runtime-streams.js';
import { TrackingService, type LocationBatch } from './tracking.service.js';
import type { RuntimeEvent } from '../domain/protocol.js';

@Injectable()
export class RuntimeWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RuntimeWorker.name);
  private readonly owner = randomUUID();
  private timer?: ReturnType<typeof setTimeout>;
  private stopping = false;
  constructor(
    private readonly db: RuntimeDatabase,
    private readonly streams: RuntimeStreams,
    private readonly tracking: TrackingService,
  ) {}
  async onModuleInit() {
    if (!this.streams.enabled || !this.streams.worker) return;
    await this.streams.consume('locations', (value) =>
      this.tracking.process(value as LocationBatch),
    );
    await this.streams.consume('business', (value) =>
      this.project(value as RuntimeEvent),
    );
    this.schedule();
  }
  private schedule() {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      void this.flush()
        .catch(() => this.logger.error('outbox_dispatch_failed'))
        .finally(() => this.schedule());
    }, 250);
  }
  async flush() {
    const events = await this.db.query<RuntimeEvent & { id: string }>(
      `with candidates as (
      select e.id from krow_runtime.outbox_events e where e.published_at is null and (e.lease_until is null or e.lease_until<now())
      and not exists(select 1 from krow_runtime.outbox_events older where older.ride_id=e.ride_id and older.version<e.version and older.published_at is null)
      order by e.id limit 100 for update skip locked
    ) update krow_runtime.outbox_events e set lease_until=now()+interval '30 seconds',lease_owner=$1,attempts=attempts+1 from candidates c where e.id=c.id
      returning e.id,e.event_id "eventId",e.ride_id "rideId",e.version,e.type,e.occurred_at "occurredAt"`,
      [this.owner],
    );
    await Promise.all(
      events.map(async (event) => {
        await this.streams.publish('business', event.rideId, event);
        await this.db.query(
          'update krow_runtime.outbox_events set published_at=now(),lease_until=null where id=$1 and lease_owner=$2',
          [event.id, this.owner],
        );
      }),
    );
  }
  async project(event: RuntimeEvent) {
    // Business projections are idempotent; only a key to the private event is broadcast.
    if (
      ['route.changed', 'ride.cancel', 'ride.interrupt'].includes(event.type)
    ) {
      const kind =
        event.type === 'route.changed' ? 'route_changed' : 'cancelled';
      await this.db.query(
        `insert into krow_runtime.notification_intents(ride_id,recipient_id,event_key,kind,expires_at)
        select e.ride_id,recipient,$2::text,$3::text,e.occurred_at+interval '10 minutes'
        from krow_runtime.outbox_events e cross join lateral unnest(e.recipient_ids) recipient
        join krow_runtime.rides r on r.ride_id=e.ride_id
        where e.ride_id=$1 and e.event_id=$2::uuid and e.occurred_at>now()-interval '10 minutes'
        and ($3<>'route_changed' or (r.state in ('scheduled','in_progress') and e.version=(select max(version) from krow_runtime.outbox_events where ride_id=$1 and type='route.changed')))
        on conflict(recipient_id,event_key) do nothing`,
        [event.rideId, event.eventId, kind],
      );
    }
    await (
      await this.streams.redis()
    ).publish('krow:business', JSON.stringify(event));
  }
  onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
  }
}
