import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RuntimeService } from './runtime.service.js';
import { TrackingService } from './tracking.service.js';
import { RuntimeStreams } from '../infrastructure/runtime-streams.js';
import { MapboxRouting } from '../infrastructure/mapbox-routing.js';
import {
  detectDeviation,
  progressToStop,
  routeProgress,
  shouldReroute,
} from '../domain/geospatial.js';

/** Coalesces fixes into one bounded job per ride; provider latency never blocks GPS ingestion. */
@Injectable()
export class GeospatialWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private readonly logger = new Logger(GeospatialWorker.name);
  constructor(
    private readonly runtime: RuntimeService,
    private readonly tracking: TrackingService,
    private readonly streams: RuntimeStreams,
    private readonly maps: MapboxRouting,
  ) {}
  onModuleInit() {
    if (this.streams.enabled && this.streams.worker) this.schedule();
  }
  private schedule() {
    if (!this.stopped)
      this.timer = setTimeout(() => {
        void this.tick()
          .catch(() => this.logger.error('geo_processing_failed'))
          .finally(() => this.schedule());
      }, 250);
  }
  async tick() {
    const redis = await this.streams.redis();
    const rides = await redis.zRangeByScore('krow:geo:due', 0, Date.now(), {
      LIMIT: { offset: 0, count: 32 },
    });
    const results = await Promise.allSettled(
      rides.map(async (rideId) => {
        const owner = randomUUID(),
          key = `krow:geo:lease:${rideId}`;
        if (!(await redis.set(key, owner, { NX: true, PX: 30000 }))) return;
        try {
          await redis.zAdd('krow:geo:due', {
            score: Date.now() + 5000,
            value: rideId,
          });
          await this.process(rideId);
        } finally {
          await redis.eval(
            "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0",
            { keys: [key], arguments: [owner] },
          );
        }
      }),
    );
    const failed = results.filter(
      (result) => result.status === 'rejected',
    ).length;
    if (failed) this.logger.error(`geo_jobs_failed count=${failed}`);
  }
  async process(rideId: string) {
    const redis = await this.streams.redis();
    const drivers = await this.runtime.db.query<{ user_id: string }>(
      `select d.user_id from krow_runtime.rides rt join public.rides r using(ride_id) join public.driver_profiles d using(driver_id) where rt.ride_id=$1 and rt.state='in_progress'`,
      [rideId],
    );
    const position = await this.tracking.latest(rideId);
    if (
      !drivers.length ||
      !position ||
      Date.now() - Date.parse(position.capturedAt) > 30000
    ) {
      await redis.zRem('krow:geo:due', rideId);
      return;
    }
    const snapshot = await this.runtime.snapshot(drivers[0].user_id, rideId);
    if (!snapshot.route || !snapshot.nextStopId || position.accuracyMeters > 50)
      return;
    const route = snapshot.route;
    const progress = progressToStop(position, route, snapshot.nextStopId);
    if (
      progress &&
      progress.offRouteMeters < Math.max(30, position.accuracyMeters * 2)
    ) {
      // Server notices complement native voice; arrival and service remain explicit commands.
      if (progress.remainingMeters <= 500 || progress.etaSeconds <= 120) {
        await this.runtime.db.query(
          `insert into krow_runtime.notification_intents(ride_id,recipient_id,event_key,kind,expires_at)
          select b.ride_id,b.user_id,concat($1::text,':',$2::text,':',case when b.status='confirmed' then 'pickup' else 'dropoff' end),'proximity',now()+interval '60 seconds'
          from public.bookings b join krow_runtime.stop_visits v on v.ride_id=b.ride_id and v.stop_id=$2::uuid
          where b.ride_id=$1::uuid and v.state in ('pending','approaching') and ((b.status='confirmed' and b.pickup_stop_id=$2::uuid) or (b.status='in_progress' and b.dropoff_stop_id=$2::uuid and ($3::float8<=500 or $4::float8<=60)))
          on conflict(recipient_id,event_key) do nothing`,
          [
            rideId,
            snapshot.nextStopId,
            progress.remainingMeters,
            progress.etaSeconds,
          ],
        );
      }
    }
    const key = `krow:geo:observations:${rideId}:${snapshot.routeVersion}`;
    const observations = JSON.parse((await redis.get(key)) ?? '[]') as Array<{
      at: number;
      distance: number;
      accuracy: number;
    }>;
    const at = Date.parse(position.capturedAt);
    if (!observations.some((o) => o.at === at))
      observations.push({
        at,
        distance: routeProgress(position, route).offRouteMeters,
        accuracy: position.accuracyMeters,
      });
    const recent = observations.filter((o) => at - o.at <= 20000).slice(-3);
    await redis.set(key, JSON.stringify(recent), { EX: 60 });
    const deviation = detectDeviation(recent);
    if (
      !deviation &&
      !(await redis.set(`krow:geo:traffic:${rideId}`, '1', {
        NX: true,
        EX: 60 + Math.floor(Math.random() * 15),
      }))
    )
      return;
    if (
      deviation &&
      !(await redis.set(`krow:geo:reroute:${rideId}`, '1', {
        NX: true,
        EX: 15,
      }))
    )
      return;
    const stops = snapshot.stops.filter(
      (s) => !['departed', 'skipped'].includes(s.state),
    );
    const alternative = await this.maps.calculate(position, stops);
    const reason = deviation ? 'deviation' : 'traffic';
    // Compare routes from the same current position, never the original total duration.
    if (
      !shouldReroute(
        routeProgress(position, route).etaSeconds,
        alternative.durationSeconds,
        reason,
      )
    )
      return;
    await this.runtime.saveRoute(
      drivers[0].user_id,
      rideId,
      snapshot.version,
      alternative,
      reason,
    );
  }
  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }
}
