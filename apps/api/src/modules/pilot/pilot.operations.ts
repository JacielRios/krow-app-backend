import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/domain/authenticated-user.js';
import { PilotDatabase } from './pilot.database.js';
import { PilotService } from './pilot.service.js';
import { GoogleMapsService } from '../maps/infrastructure/google-maps.service.js';

@Injectable()
export class PilotOperations {
  constructor(
    private readonly db: PilotDatabase,
    private readonly pilot: PilotService,
    private readonly maps: GoogleMapsService,
  ) {}
  async reroute(
    user: AuthenticatedUser,
    rideId: string,
    expectedVersion: string,
  ) {
    const snapshot = await this.pilot.snapshot(user, rideId);
    if (snapshot.role !== 'driver')
      throw new ForbiddenException(
        'Solo el conductor puede actualizar el recorrido',
      );
    if (snapshot.route.version !== expectedVersion)
      throw new ConflictException('El recorrido cambió. Actualiza el viaje');
    const position = snapshot.position;
    if (!position || snapshot.state !== 'live' || position.accuracy > 100)
      throw new ConflictException(
        'Se requiere GPS reciente y preciso para actualizar el recorrido',
      );
    const stateSql = `select r.version,r.destination_lat,r.destination_lng,
      coalesce((select string_agg(b.booking_id::text||':'||b.status,',' order by b.booking_id) from public.bookings b where b.ride_id=r.ride_id and b.status in('confirmed','in_progress')),'') signature
      from public.rides r where r.ride_id=$1 and r.status='in_progress'`;
    const [initial] = await this.db.query<{
      version: number;
      destination_lat: number;
      destination_lng: number;
      signature: string;
    }>(stateSql, [rideId]);
    if (!initial) throw new ConflictException('El viaje ya no está en curso');
    const pending = new Map<string, string>();
    for (const stop of snapshot.stops) {
      for (const b of stop.pickups) pending.set(b.bookingId, 'confirmed');
      for (const b of stop.dropoffs) pending.set(b.bookingId, 'in_progress');
    }
    if (
      [...pending]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, status]) => `${id}:${status}`)
        .join(',') !== initial.signature
    )
      throw new ConflictException('Las paradas cambiaron. Actualiza el viaje');
    const route = await this.maps.routePreview(
      position,
      {
        lat: Number(initial.destination_lat),
        lng: Number(initial.destination_lng),
      },
      undefined,
      snapshot.stops.map((s) => ({ lat: s.lat, lng: s.lng })),
    );
    if (!route)
      throw new BadRequestException(
        'No encontramos un recorrido alternativo que atienda tus paradas',
      );
    return this.db.transaction(async (client) => {
      await client.query(
        'select ride_id from public.rides where ride_id=$1 for update',
        [rideId],
      );
      const latest = await client.query<{ version: number; signature: string }>(
        stateSql,
        [rideId],
      );
      const current = latest.rows[0];
      const revision = await client.query<{ route_id: string }>(
        'select route_id from krow_pilot.operational_routes where ride_id=$1',
        [rideId],
      );
      if (
        (revision.rows[0]?.route_id ?? 'original') !==
        expectedVersion.split(':').at(-1)
      )
        throw new ConflictException(
          'Otro recorrido ya fue publicado. Actualiza el viaje',
        );
      if (
        !current ||
        current.version !== initial.version ||
        current.signature !== initial.signature ||
        Date.now() - Date.parse(position.capturedAt) > 30000
      )
        throw new ConflictException(
          'El viaje o sus paradas cambiaron. Reintenta actualizar el recorrido',
        );
      const access = await client.query(
        'select 1 from public.rides r join public.driver_profiles d using(driver_id) join public.users u on u.uuid=d.user_id where r.ride_id=$1 and d.user_id=$2 and u.is_active is distinct from false and u.deleted_at is null',
        [rideId, user.id],
      );
      if (!access.rows.length)
        throw new ForbiddenException('El viaje no está disponible');
      await client.query(
        `insert into krow_pilot.operational_routes(ride_id,ride_version,polyline,duration_seconds) values($1,$2,$3,$4)
        on conflict(ride_id) do update set route_id=gen_random_uuid(),ride_version=$2,polyline=$3,duration_seconds=$4,calculated_at=now()`,
        [rideId, initial.version, route.encodedPolyline, route.durationSeconds],
      );
      return { success: true };
    });
  }
  async report(
    user: AuthenticatedUser,
    rideId: string,
    clientId: string,
    kind: string,
    details: string,
  ) {
    await this.pilot.rideView(user, rideId, false);
    if (!details.trim()) throw new BadRequestException('Describe lo ocurrido');
    const rows = await this.db.query<{ incidentId: string }>(
      `insert into krow_pilot.incidents(client_id,ride_id,actor_id,kind,details) values($1,$2,$3,$4,$5)
      on conflict(actor_id,client_id) do update set client_id=excluded.client_id where incidents.ride_id=excluded.ride_id and incidents.kind=excluded.kind and incidents.details=excluded.details returning incident_id as "incidentId"`,
      [clientId, rideId, user.id, kind, details.trim()],
    );
    if (!rows[0])
      throw new ConflictException(
        'Este reporte ya se utilizó para otra solicitud',
      );
    return rows[0];
  }
}
