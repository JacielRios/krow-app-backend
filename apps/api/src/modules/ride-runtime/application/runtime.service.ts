import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { RuntimeDatabase } from '../infrastructure/runtime-database.js';
import type {
  NavigationRoute,
  RuntimeBooking,
  RuntimeCommand,
  RuntimeEvent,
  RuntimeSnapshot,
  RuntimeStop,
} from '../domain/protocol.js';

interface RideRow {
  ride_id: string;
  driver_user_id: string;
  state: RuntimeSnapshot['state'];
  version: number;
  route_version: number;
  capacity: number;
  route_polyline: string | null;
  route_provider: string | null;
}
interface BookingRow {
  booking_id: string;
  user_id: string;
  pickup_stop_id: string;
  dropoff_stop_id: string;
  seats_reserved: number;
  status: RuntimeBooking['status'];
}

@Injectable()
export class RuntimeService {
  constructor(readonly db: RuntimeDatabase) {}

  async enroll(actor: string, rideId: string) {
    return this.db.transaction(async (client) => {
      const { rows } = await client.query<{
        user_id: string;
        status: string;
        available_seats: number;
      }>(
        'select d.user_id,r.status,r.available_seats from public.rides r join public.driver_profiles d using(driver_id) where r.ride_id=$1 for update of r',
        [rideId],
      );
      if (!rows[0]) throw new NotFoundException('Viaje no encontrado');
      if (rows[0].user_id !== actor) throw new ForbiddenException();
      const existing = await client.query(
        'select 1 from krow_runtime.rides where ride_id=$1',
        [rideId],
      );
      if (existing.rowCount) return { rideId };
      if (!['scheduled', 'full'].includes(rows[0].status))
        throw new ConflictException(
          'Solo se pueden migrar viajes que no han iniciado',
        );
      // Legacy accepted reservations consumed the entire ride. Recover offered capacity,
      // not vehicle capacity, so migration cannot silently offer additional seats.
      await client.query(
        `insert into krow_runtime.rides(ride_id,capacity)
        select r.ride_id,r.available_seats+coalesce((select sum(b.seats_reserved) from public.bookings b where b.ride_id=r.ride_id and b.status='confirmed'),0)
        from public.rides r where r.ride_id=$1`,
        [rideId],
      );
      await client.query("select set_config('krow.runtime_ride',$1,true)", [
        rideId,
      ]);
      await client.query(
        `insert into krow_runtime.stop_visits(ride_id,stop_id) select ride_id,stop_id from public.ride_stops where ride_id=$1 and is_active`,
        [rideId],
      );
      const stops = await client.query(
        'select 1 from krow_runtime.stop_visits where ride_id=$1',
        [rideId],
      );
      if ((stops.rowCount ?? 0) < 2)
        throw new ConflictException('Se requieren al menos dos paradas');
      await this.emit(client, rideId, 1, 'ride.enrolled');
      return { rideId };
    });
  }

  private async ride(client: PoolClient, rideId: string): Promise<RideRow> {
    // Always lock the public ride before the runtime row to match legacy lock order.
    await client.query(
      'select ride_id from public.rides where ride_id=$1 for update',
      [rideId],
    );
    const { rows } = await client.query<RideRow>(
      `select rt.*,d.user_id driver_user_id,r.route_polyline,r.route_provider
      from krow_runtime.rides rt join public.rides r using(ride_id) join public.driver_profiles d using(driver_id)
      where rt.ride_id=$1 for update of rt`,
      [rideId],
    );
    if (!rows[0]) throw new NotFoundException('Viaje sin sesión v2');
    await client.query("select set_config('krow.runtime_ride',$1,true)", [
      rideId,
    ]);
    return rows[0];
  }
  async authorize(
    actor: string,
    rideId: string,
    driverOnly = false,
  ): Promise<'driver' | 'passenger'> {
    const rows = await this.db.query<{
      driver: boolean;
      participant: boolean;
      state: string;
    }>(
      `select d.user_id=$2 as driver, rt.state,
      exists(select 1 from public.bookings b where b.ride_id=r.ride_id and b.user_id=$2 and b.status in ('confirmed','in_progress')) as participant
      from krow_runtime.rides rt join public.rides r using(ride_id) join public.driver_profiles d using(driver_id) where r.ride_id=$1`,
      [rideId, actor],
    );
    const row = rows[0];
    if (
      !row ||
      !['scheduled', 'in_progress'].includes(row.state) ||
      (!row.driver && (driverOnly || !row.participant))
    )
      throw new ForbiddenException('Seguimiento no autorizado');
    return row.driver ? 'driver' : 'passenger';
  }
  async snapshot(actor: string, rideId: string): Promise<RuntimeSnapshot> {
    return this.db.transaction(async (client) => {
      await client.query('set transaction isolation level repeatable read');
      const { rows } = await client.query<RideRow>(
        `select rt.*,d.user_id driver_user_id,r.route_polyline,r.route_provider from krow_runtime.rides rt join public.rides r using(ride_id) join public.driver_profiles d using(driver_id) where rt.ride_id=$1`,
        [rideId],
      );
      const ride = rows[0];
      if (!ride) throw new NotFoundException('Viaje sin sesión v2');
      const driver = ride.driver_user_id === actor;
      const bookings = (
        await client.query<BookingRow>(
          'select * from public.bookings where ride_id=$1 and ($2::boolean or user_id=$3)',
          [rideId, driver, actor],
        )
      ).rows;
      if (!driver && !bookings.length) throw new ForbiddenException();
      const stops = (
        await client.query<RuntimeStop>(
          `select s.stop_id as "stopId",s.stop_order as "order",s.address,s.lat::float8,s.lng::float8,v.state,
        0::int pickups,0::int dropoffs from public.ride_stops s join krow_runtime.stop_visits v using(ride_id,stop_id) where s.ride_id=$1 order by s.stop_order`,
          [rideId],
        )
      ).rows;
      for (const stop of stops) {
        stop.pickups = bookings
          .filter(
            (b) => b.pickup_stop_id === stop.stopId && b.status === 'confirmed',
          )
          .reduce((n, b) => n + b.seats_reserved, 0);
        stop.dropoffs = bookings
          .filter(
            (b) =>
              b.dropoff_stop_id === stop.stopId &&
              ['confirmed', 'in_progress'].includes(b.status),
          )
          .reduce((n, b) => n + b.seats_reserved, 0);
      }
      const routeRows = await client.query<{ route: NavigationRoute }>(
        'select route from krow_runtime.route_versions where ride_id=$1 and version=$2',
        [rideId, ride.route_version],
      );
      return {
        rideId,
        version: ride.version,
        role: driver ? 'driver' : 'passenger',
        state: ride.state,
        route: routeRows.rows[0]?.route ?? null,
        routeVersion: ride.route_version,
        committedPolyline: ride.route_polyline,
        committedProvider: ride.route_provider,
        stops,
        bookings: bookings.map((b) => ({
          bookingId: b.booking_id,
          pickupStopId: b.pickup_stop_id,
          dropoffStopId: b.dropoff_stop_id,
          seats: b.seats_reserved,
          status: b.status,
        })),
        position: null,
        tracking: 'unavailable',
        generatedAt: new Date().toISOString(),
        nextStopId:
          stops.find((s) => !['departed', 'skipped'].includes(s.state))
            ?.stopId ?? null,
        remainingMeters: null,
        etaSeconds: null,
        etaConfidence: 'low',
      };
    });
  }

  async requestBooking(
    actor: string,
    rideId: string,
    input: {
      commandId: string;
      pickupStopId: string;
      dropoffStopId: string;
      seats: number;
    },
  ) {
    return this.db.transaction(async (client) => {
      await client.query(
        'select pg_advisory_xact_lock(hashtextextended($1,0))',
        [actor],
      );
      const ride = await this.ride(client, rideId);
      const hash = this.hash({ rideId, ...input });
      const replay = await this.replay(client, actor, input.commandId, hash);
      if (replay) return replay;
      if (ride.driver_user_id === actor || ride.state !== 'scheduled')
        throw new ConflictException('El viaje no admite esta solicitud');
      const active = await client.query(
        "select 1 from public.bookings where user_id=$1 and status in ('pending','confirmed','in_progress')",
        [actor],
      );
      if (active.rowCount)
        throw new ConflictException('Ya tienes una reserva activa');
      await this.checkCapacity(
        client,
        rideId,
        input.pickupStopId,
        input.dropoffStopId,
        input.seats,
      );
      const bookingId = randomUUID();
      await client.query(
        `insert into public.bookings(booking_id,ride_id,user_id,pickup_stop_id,dropoff_stop_id,seats_reserved,status) values($1,$2,$3,$4,$5,$6,'pending')`,
        [
          bookingId,
          rideId,
          actor,
          input.pickupStopId,
          input.dropoffStopId,
          input.seats,
        ],
      );
      const version = await this.bump(client, rideId, 'booking.requested');
      const result = { bookingId, rideId, version };
      await this.record(
        client,
        actor,
        input.commandId,
        rideId,
        hash,
        result,
        input,
      );
      return result;
    });
  }

  async command(actor: string, rideId: string, command: RuntimeCommand) {
    return this.db.transaction(async (client) => {
      await client.query(
        'select pg_advisory_xact_lock(hashtextextended($1,0))',
        [actor],
      );
      const ride = await this.ride(client, rideId);
      const hash = this.hash({ rideId, ...command });
      const replay = await this.replay(client, actor, command.commandId, hash);
      if (replay) return replay;
      if (ride.version !== command.expectedVersion)
        throw new ConflictException(
          'El viaje cambió; actualiza antes de confirmar',
        );
      const driver = ride.driver_user_id === actor;
      if (!driver && command.action !== 'cancel_booking')
        throw new ForbiddenException();
      if (['completed', 'cancelled', 'interrupted'].includes(ride.state))
        throw new ConflictException('Viaje finalizado');
      const recipients = (
        await client.query<{ user_id: string }>(
          "select distinct user_id from public.bookings where ride_id=$1 and status in ('pending','confirmed','in_progress')",
          [rideId],
        )
      ).rows.map((row) => row.user_id);
      if (
        ['start', 'cancel', 'complete', 'interrupt'].includes(command.action)
      ) {
        const target = {
          start: 'in_progress',
          cancel: 'cancelled',
          complete: 'completed',
          interrupt: 'interrupted',
        }[command.action as 'start' | 'cancel' | 'complete' | 'interrupt'];
        if (
          ['start', 'cancel'].includes(command.action) &&
          ride.state !== 'scheduled'
        )
          throw new ConflictException('El viaje ya inició');
        if (
          ['complete', 'interrupt'].includes(command.action) &&
          ride.state !== 'in_progress'
        )
          throw new ConflictException('El viaje no ha iniciado');
        if (command.action === 'start') {
          if (!ride.route_version)
            throw new ConflictException('Primero prepara la ruta');
          const accepted = await client.query(
            "select 1 from public.bookings where ride_id=$1 and status='confirmed'",
            [rideId],
          );
          if (!accepted.rowCount)
            throw new ConflictException('Se requiere una reserva confirmada');
          await client.query(
            "update public.bookings set status='rejected' where ride_id=$1 and status='pending'",
            [rideId],
          );
        }
        if (command.action === 'complete') {
          const unresolved = await client.query(
            "select 1 from public.bookings where ride_id=$1 and status in ('confirmed','in_progress')",
            [rideId],
          );
          if (unresolved.rowCount)
            throw new ConflictException('Hay pasajeros pendientes de atender');
        }
        if (command.action === 'interrupt' && !command.reason?.trim())
          throw new BadRequestException('Indica el motivo de interrupción');
        if (['cancel', 'interrupt'].includes(command.action))
          await client.query(
            "update public.bookings set status=$2 where ride_id=$1 and status in ('pending','confirmed','in_progress')",
            [rideId, command.action === 'cancel' ? 'cancelled' : 'interrupted'],
          );
        await client.query(
          'update krow_runtime.rides set state=$2 where ride_id=$1',
          [rideId, target],
        );
        // interrupted is represented as cancelled in legacy views; v2 retains its exact state.
        await client.query(
          'update public.rides set status=$2 where ride_id=$1',
          [rideId, target === 'interrupted' ? 'cancelled' : target],
        );
        if (target !== 'in_progress')
          await client.query(
            'update krow_runtime.location_sessions set revoked_at=now() where ride_id=$1 and revoked_at is null',
            [rideId],
          );
        await client.query(
          'insert into public.ride_status_history(ride_id,status,previous_status,actor_id,reason) values($1,$2,$3,$4,$5)',
          [
            rideId,
            target === 'interrupted' ? 'cancelled' : target,
            ride.state,
            actor,
            command.reason ?? command.action,
          ],
        );
      } else if (command.action === 'arrive' || command.action === 'depart') {
        if (ride.state !== 'in_progress')
          throw new ConflictException('El viaje no ha iniciado');
        const next = await client.query<{ stop_id: string; state: string }>(
          `select v.stop_id,v.state from krow_runtime.stop_visits v join public.ride_stops s using(stop_id) where v.ride_id=$1 and v.state not in ('departed','skipped') order by s.stop_order limit 1`,
          [rideId],
        );
        if (next.rows[0]?.stop_id !== command.stopId)
          throw new ConflictException('Respeta el orden de paradas');
        if (
          command.action === 'arrive' &&
          !['pending', 'approaching'].includes(next.rows[0].state)
        )
          throw new ConflictException('La llegada ya fue confirmada');
        if (command.action === 'depart') {
          if (!['arrived', 'servicing'].includes(next.rows[0].state))
            throw new ConflictException('Confirma la llegada primero');
          const remaining = await client.query(
            "select 1 from public.bookings where ride_id=$1 and ((pickup_stop_id=$2 and status='confirmed') or (dropoff_stop_id=$2 and status='in_progress'))",
            [rideId, command.stopId],
          );
          if (remaining.rowCount)
            throw new ConflictException(
              'Hay pasajeros pendientes en esta parada',
            );
        }
        await client.query(
          `update krow_runtime.stop_visits set state=$3,arrived_at=case when $3='arrived' then coalesce(arrived_at,now()) else arrived_at end,departed_at=case when $3='departed' then now() else departed_at end where ride_id=$1 and stop_id=$2`,
          [
            rideId,
            command.stopId,
            command.action === 'arrive' ? 'arrived' : 'departed',
          ],
        );
      } else {
        const { rows } = await client.query<BookingRow>(
          'select * from public.bookings where ride_id=$1 and booking_id=$2 for update',
          [rideId, command.bookingId],
        );
        const booking = rows[0];
        if (!booking) throw new NotFoundException('Reserva no encontrada');
        let target: RuntimeBooking['status'];
        if (['accept_booking', 'reject_booking'].includes(command.action)) {
          if (ride.state !== 'scheduled' || booking.status !== 'pending')
            throw new ConflictException('La reserva no está pendiente');
          target =
            command.action === 'accept_booking' ? 'confirmed' : 'rejected';
          if (target === 'confirmed')
            await this.checkCapacity(
              client,
              rideId,
              booking.pickup_stop_id,
              booking.dropoff_stop_id,
              booking.seats_reserved,
            );
        } else if (command.action === 'cancel_booking') {
          if (
            booking.user_id !== actor ||
            !['pending', 'confirmed'].includes(booking.status)
          )
            throw new ForbiddenException('No puedes cancelar esta reserva');
          target = 'cancelled';
        } else {
          if (ride.state !== 'in_progress')
            throw new ConflictException('El viaje no ha iniciado');
          const stopId =
            command.action === 'dropoff'
              ? booking.dropoff_stop_id
              : booking.pickup_stop_id;
          const visits = await client.query<{ state: string }>(
            'select state from krow_runtime.stop_visits where ride_id=$1 and stop_id=$2',
            [rideId, stopId],
          );
          if (!['arrived', 'servicing'].includes(visits.rows[0]?.state))
            throw new ConflictException('Confirma la llegada a la parada');
          if (command.action === 'dropoff' && booking.status === 'in_progress')
            target = 'completed';
          else if (command.action === 'board' && booking.status === 'confirmed')
            target = 'in_progress';
          else if (
            command.action === 'no_show' &&
            booking.status === 'confirmed' &&
            command.reason?.trim()
          )
            target = 'no_show';
          else throw new ConflictException('Transición de reserva inválida');
          await client.query(
            "update krow_runtime.stop_visits set state='servicing' where ride_id=$1 and stop_id=$2",
            [rideId, stopId],
          );
        }
        await client.query(
          'update public.bookings set status=$2 where booking_id=$1',
          [booking.booking_id, target],
        );
      }
      const version = await this.bump(
        client,
        rideId,
        `ride.${command.action}`,
        recipients,
      );
      const result = { rideId, version, commandId: command.commandId };
      await this.record(
        client,
        actor,
        command.commandId,
        rideId,
        hash,
        result,
        command,
      );
      return result;
    });
  }

  async saveRoute(
    actor: string,
    rideId: string,
    expectedVersion: number,
    route: NavigationRoute,
    reason: string,
  ) {
    return this.db.transaction(async (client) => {
      const ride = await this.ride(client, rideId);
      if (ride.driver_user_id !== actor) throw new ForbiddenException();
      if (
        ride.version !== expectedVersion ||
        !['scheduled', 'in_progress'].includes(ride.state)
      )
        throw new ConflictException('El viaje cambió durante el cálculo');
      const stops = await client.query<{ stop_id: string }>(
        `select s.stop_id from krow_runtime.stop_visits v join public.ride_stops s using(stop_id) where v.ride_id=$1 and v.state not in ('departed','skipped') order by s.stop_order`,
        [rideId],
      );
      if (
        JSON.stringify(stops.rows.map((s) => s.stop_id)) !==
        JSON.stringify(route.stopIds)
      )
        throw new ConflictException(
          'La ruta no conserva las paradas pendientes',
        );
      const routeVersion = ride.route_version + 1;
      await client.query(
        'insert into krow_runtime.route_versions(ride_id,version,reason,route) values($1,$2,$3,$4)',
        [rideId, routeVersion, reason, JSON.stringify(route)],
      );
      await client.query(
        'update krow_runtime.rides set route_version=$2 where ride_id=$1',
        [rideId, routeVersion],
      );
      return {
        rideId,
        version: await this.bump(client, rideId, 'route.changed'),
        routeVersion,
      };
    });
  }

  async openLocationSession(actor: string, rideId: string, deviceId: string) {
    return this.db.transaction(async (client) => {
      const ride = await this.ride(client, rideId);
      if (
        ride.driver_user_id !== actor ||
        !['scheduled', 'in_progress'].includes(ride.state)
      )
        throw new ForbiddenException();
      const existing = await client.query<{
        session_id: string;
        device_id: string;
      }>(
        'select session_id,device_id from krow_runtime.location_sessions where ride_id=$1 and revoked_at is null',
        [rideId],
      );
      if (existing.rows[0]?.device_id === deviceId)
        return { sessionId: existing.rows[0].session_id };
      if (existing.rowCount)
        throw new ConflictException(
          'Otro dispositivo controla la ubicación; cierra esa sesión primero',
        );
      const sessionId = randomUUID();
      await client.query(
        'insert into krow_runtime.location_sessions(session_id,ride_id,actor_id,device_id) values($1,$2,$3,$4)',
        [sessionId, rideId, actor, deviceId],
      );
      return { sessionId };
    });
  }
  async replayEvents(actor: string, rideId: string, after: number) {
    await this.authorize(actor, rideId);
    const events = await this.db.query<RuntimeEvent>(
      `select event_id "eventId",ride_id "rideId",version,type,occurred_at "occurredAt" from krow_runtime.outbox_events where ride_id=$1 and version>$2 order by version limit 201`,
      [rideId, after],
    );
    return {
      snapshotRequired:
        events.length > 200 ||
        Boolean(events[0] && events[0].version !== after + 1),
      events: events.slice(0, 200),
    };
  }
  async closeLocationSession(actor: string, rideId: string, sessionId: string) {
    return this.db.transaction(async (client) => {
      const ride = await this.ride(client, rideId);
      if (ride.driver_user_id !== actor) throw new ForbiddenException();
      await client.query(
        'update krow_runtime.location_sessions set revoked_at=coalesce(revoked_at,now()) where ride_id=$1 and session_id=$2 and actor_id=$3',
        [rideId, sessionId, actor],
      );
      return { revoked: true };
    });
  }
  private async checkCapacity(
    client: PoolClient,
    rideId: string,
    pickup: string,
    dropoff: string,
    seats: number,
  ) {
    if (!Number.isInteger(seats) || seats < 1)
      throw new BadRequestException('Asientos inválidos');
    const stops = await client.query<{ stop_id: string; stop_order: number }>(
      `select s.stop_id,s.stop_order from public.ride_stops s join public.transport_stops t on t.stop_id=s.transport_stop_id where s.ride_id=$1 and s.stop_id=any($2::uuid[]) and s.is_active and t.active`,
      [rideId, [pickup, dropoff]],
    );
    const p = stops.rows.find((s) => s.stop_id === pickup),
      d = stops.rows.find((s) => s.stop_id === dropoff);
    if (!p || !d || p.stop_order >= d.stop_order)
      throw new BadRequestException('Paradas inválidas');
    const segments = await client.query<{ available: number }>(
      'select available from krow_runtime.ride_segments where ride_id=$1 and stop_order>=$2 and stop_order<$3',
      [rideId, p.stop_order, d.stop_order],
    );
    if (!segments.rowCount || segments.rows.some((s) => s.available < seats))
      throw new ConflictException('No hay cupo en todos los tramos');
  }
  private hash(value: object) {
    return createHash('sha256')
      .update(JSON.stringify(value, Object.keys(value).sort()))
      .digest('hex');
  }
  private async replay(
    client: PoolClient,
    actor: string,
    id: string,
    hash: string,
  ): Promise<Record<string, unknown> | null> {
    const { rows } = await client.query<{
      request_hash: string;
      result: Record<string, unknown>;
    }>(
      'select request_hash,result from krow_runtime.commands where actor_id=$1 and command_id=$2',
      [actor, id],
    );
    if (rows[0] && rows[0].request_hash !== hash)
      throw new ConflictException('commandId reutilizado con otra operación');
    return rows[0]?.result ?? null;
  }
  private async record(
    client: PoolClient,
    actor: string,
    id: string,
    rideId: string,
    hash: string,
    result: object,
    request: object,
  ) {
    await client.query(
      'insert into krow_runtime.commands(actor_id,command_id,ride_id,request_hash,result,request) values($1,$2,$3,$4,$5,$6)',
      [
        actor,
        id,
        rideId,
        hash,
        JSON.stringify(result),
        JSON.stringify(request),
      ],
    );
  }
  private async bump(
    client: PoolClient,
    rideId: string,
    type: string,
    recipients?: string[],
  ) {
    const { rows } = await client.query<{ version: number }>(
      'update krow_runtime.rides set version=version+1,updated_at=now() where ride_id=$1 returning version',
      [rideId],
    );
    await this.emit(client, rideId, rows[0].version, type, recipients);
    return rows[0].version;
  }
  private async emit(
    client: PoolClient,
    rideId: string,
    version: number,
    type: string,
    recipients?: string[],
  ) {
    await client.query(
      "insert into krow_runtime.outbox_events(ride_id,version,type,recipient_ids) values($1,$2,$3,coalesce($4::uuid[],array(select distinct user_id from public.bookings where ride_id=$1 and status in ('confirmed','in_progress'))))",
      [rideId, version, type, recipients ?? null],
    );
  }
}
