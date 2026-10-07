import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  HttpException,
} from '@nestjs/common';
import { RuntimeService } from './runtime.service.js';
import { RuntimeStreams } from '../infrastructure/runtime-streams.js';
import { assessSample } from '../domain/geospatial.js';
import type { LocationSample, VehiclePosition } from '../domain/protocol.js';

export interface LocationBatch {
  rideId: string;
  actorId: string;
  receivedAt: string;
  samples: LocationSample[];
}

@Injectable()
export class TrackingService {
  constructor(
    private readonly runtime: RuntimeService,
    private readonly streams: RuntimeStreams,
  ) {}
  async ingest(actor: string, rideId: string, samples: LocationSample[]) {
    if (!samples.length || samples.length > 100)
      throw new BadRequestException('Lote de ubicación inválido');
    const sessionId = samples[0].sessionId;
    if (samples.some((s) => s.sessionId !== sessionId))
      throw new BadRequestException('No mezcles sesiones');
    const allowed = await this.runtime.db.query(
      `select 1 from krow_runtime.location_sessions s join krow_runtime.rides r using(ride_id)
      where s.session_id=$1 and s.ride_id=$2 and s.actor_id=$3 and s.revoked_at is null and r.state in ('scheduled','in_progress')`,
      [sessionId, rideId, actor],
    );
    if (!allowed.length)
      throw new ForbiddenException('Sesión de ubicación revocada');
    const redis = await this.streams.redis();
    const rateKey = `krow:ingest:${sessionId}:${Math.floor(Date.now() / 1000)}`;
    const rate = await redis.incrBy(rateKey, samples.length);
    await redis.expire(rateKey, 2);
    if (rate > 100) throw new HttpException('Demasiadas ubicaciones', 429);
    const now = Date.now();
    if (samples.some((s) => assessSample(s, null, now) === 'reject'))
      throw new BadRequestException('Coordenadas o instantes inválidos');
    const batch: LocationBatch = {
      rideId,
      actorId: actor,
      receivedAt: new Date(now).toISOString(),
      samples: samples.map((sample) => ({
        ...sample,
        capturedAt: new Date(sample.capturedAt).toISOString(),
      })),
    };
    await this.streams.publish('locations', rideId, batch);
    return { accepted: samples.length, durable: true };
  }
  async latest(rideId: string): Promise<VehiclePosition | null> {
    const value = await (
      await this.streams.redis()
    ).get(`krow:position:${rideId}`);
    return value ? (JSON.parse(value) as VehiclePosition) : null;
  }
  async process(batch: LocationBatch) {
    const redis = await this.streams.redis();
    const active = await this.runtime.db.query(
      `select 1 from krow_runtime.location_sessions s join krow_runtime.rides r using(ride_id)
      where s.session_id=$1 and s.ride_id=$2 and s.revoked_at is null and r.state in ('scheduled','in_progress')`,
      [batch.samples[0]?.sessionId, batch.rideId],
    );
    if (!active.length) return;
    let previous = await this.latest(batch.rideId);
    if (previous?.sessionId !== batch.samples[0].sessionId) previous = null;
    for (const sample of [...batch.samples].sort(
      (a, b) => a.sequence - b.sequence,
    )) {
      if (assessSample(sample, previous, Date.now()) !== 'accept') continue;
      const position: VehiclePosition = {
        ...sample,
        receivedAt: batch.receivedAt,
        quality: sample.accuracyMeters <= 30 ? 'observed' : 'uncertain',
      };
      // Kafka partitions serialize rides; Lua also protects against replays/rebalances.
      const changed = await redis.eval(
        `local current=redis.call('GET',KEYS[1]); if current then local p=cjson.decode(current); if p.sessionId==ARGV[1] and (p.sequence>=tonumber(ARGV[2]) or p.capturedAt>=ARGV[3]) then return 0 end end; redis.call('SET',KEYS[1],ARGV[4],'EX',86400); return 1`,
        {
          keys: [`krow:position:${batch.rideId}`],
          arguments: [
            sample.sessionId,
            String(sample.sequence),
            sample.capturedAt,
            JSON.stringify(position),
          ],
        },
      );
      if (changed === 1) {
        previous = position;
        await redis.publish(
          'krow:positions',
          JSON.stringify({ rideId: batch.rideId, position }),
        );
        await redis.zAdd(
          'krow:geo:due',
          { score: Date.now(), value: batch.rideId },
          { NX: true },
        );
      }
    }
  }
}
