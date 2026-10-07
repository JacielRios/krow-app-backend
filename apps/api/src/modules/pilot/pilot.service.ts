/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- Private SQL joins are normalized at this boundary. */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { AuthenticatedUser } from '../auth/domain/authenticated-user.js';
import { GoogleMapsService } from '../maps/infrastructure/google-maps.service.js';
import { PilotDatabase } from './pilot.database.js';
import { approximateEta } from './pilot.eta.js';
import {
  nextBookingState,
  trackingFreshness,
  validateSample,
  type LocationSample,
} from './pilot.domain.js';

export interface RideRow {
  ride_id: string;
  driver_user: string;
  status: string;
  origin_lat: number;
  origin_lng: number;
  destination_lat: number;
  destination_lng: number;
  route_polyline: string;
  version: number;
  available_seats: number;
  driver_id: string;
  vehicle_id: string;
  departure_time: Date;
  origin_address: string;
  destination_address: string;
  price_per_seat: string;
  driver_name: string | null;
  driver_photo: string | null;
  driver_rating: string | null;
  vehicle_brand: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  license_plate: string | null;
}
interface BookingRow {
  booking_id: string;
  user_id: string;
  status: string;
  amount_cents: number;
  full_name: string;
  profile_photo: string | null;
  passenger_rating: string | null;
  seats_reserved: number;
  created_at: Date;
  pickup_id: string;
  pickup_order: number;
  pickup_lat: number;
  pickup_lng: number;
  pickup_address: string;
  dropoff_id: string;
  dropoff_order: number;
  dropoff_lat: number;
  dropoff_lng: number;
  dropoff_address: string;
}
interface SessionRow {
  session_id: string;
  token_hash: string;
  device_id: string;
  last_seq: string;
  position: LocationSample | null;
  expires_at: Date;
}
const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');

@Injectable()
export class PilotService {
  private readonly routeCache = new Map<
    string,
    {
      expires: number;
      value: {
        polyline: string;
        durationSeconds: number;
        calculatedAt: string;
        error?: string;
      };
    }
  >();
  constructor(
    readonly db: PilotDatabase,
    private readonly maps: GoogleMapsService,
  ) {}

  private async ride(
    rideId: string,
    actorId: string,
    client?: PoolClient,
    driverOnly = false,
    live = false,
  ) {
    const sql = `select r.*, d.user_id as driver_user, du.full_name as driver_name, du.profile_photo as driver_photo, coalesce(d.rating,du.rating) as driver_rating, v.brand as vehicle_brand, v.model as vehicle_model, v.car_color as vehicle_color, v.license_plate
      from public.rides r join public.driver_profiles d using(driver_id) join public.users du on du.uuid=d.user_id join public.vehicles v using(vehicle_id)
      join public.users u on u.uuid=$2 where r.ride_id=$1 and u.is_active is distinct from false and u.deleted_at is null`;
    const rows = client
      ? (await client.query<RideRow>(sql, [rideId, actorId])).rows
      : await this.db.query<RideRow>(sql, [rideId, actorId]);
    const ride = rows[0];
    if (!ride) throw new NotFoundException('Viaje no disponible');
    if (live && ride.status !== 'in_progress')
      throw new ForbiddenException(
        'El seguimiento solo está disponible durante el viaje',
      );
    if (ride.driver_user === actorId) return ride;
    if (driverOnly)
      throw new ForbiddenException(
        'Solo el conductor puede realizar esta acción',
      );
    const bookingSql = `select booking_id from public.bookings where ride_id=$1 and user_id=$2 ${live ? "and status in ('confirmed','in_progress')" : ''}`;
    const bookings = client
      ? (await client.query(bookingSql, [rideId, actorId])).rows
      : await this.db.query(bookingSql, [rideId, actorId]);
    if (!bookings.length)
      throw new ForbiddenException('No participas en este viaje');
    return ride;
  }
  private async roster(rideId: string) {
    return this.db.query<BookingRow>(
      `select b.*, u.full_name, u.profile_photo, u.rating as passenger_rating, p.amount_cents,
      s.stop_id as pickup_id, s.stop_order as pickup_order, s.lat as pickup_lat, s.lng as pickup_lng, s.address as pickup_address,
      t.stop_id as dropoff_id, t.stop_order as dropoff_order, t.lat as dropoff_lat, t.lng as dropoff_lng, t.address as dropoff_address
      from public.bookings b join public.users u on u.uuid=b.user_id
      join krow_pilot.booking_prices p using(booking_id)
      join public.ride_stops s on s.stop_id=b.pickup_stop_id join public.ride_stops t on t.stop_id=b.dropoff_stop_id
      where b.ride_id=$1 order by s.stop_order, b.created_at`,
      [rideId],
    );
  }
  // Participant cards use the private connection after explicit ownership /
  // participation checks. Driver profiles are deliberately own-only in RLS.
  async rideView(user: AuthenticatedUser, rideId: string, active: boolean) {
    const ride = await this.ride(rideId, user.id);
    const driver = ride.driver_user === user.id;
    const roster = await this.roster(rideId);
    const header = {
      rideId,
      driverId: ride.driver_id,
      departureTime: ride.departure_time,
      availableSeats: ride.available_seats,
      pricePerSeat: Number(ride.price_per_seat),
      status: ride.status,
      originAddress: ride.origin_address,
      destinationAddress: ride.destination_address,
      ...(active
        ? {
            originLat: Number(ride.origin_lat),
            originLng: Number(ride.origin_lng),
            destinationLat: Number(ride.destination_lat),
            destinationLng: Number(ride.destination_lng),
            routePolyline: ride.route_polyline,
          }
        : {}),
    };
    if (driver) {
      if (active)
        return {
          role: 'conductor',
          ride: header,
          canComplete:
            ride.status === 'in_progress' &&
            !roster.some((b) =>
              ['pending', 'confirmed', 'in_progress'].includes(b.status),
            ),
          passengers: roster
            .filter((b) =>
              ['confirmed', 'in_progress', 'completed', 'no_show'].includes(
                b.status,
              ),
            )
            .map((b) => ({
              bookingId: b.booking_id,
              bookingStatus: b.status,
              userId: b.user_id,
              fullName: b.full_name,
              profilePhoto: b.profile_photo,
              rating:
                b.passenger_rating == null ? null : Number(b.passenger_rating),
              seatsReserved: b.seats_reserved,
              pickupLat: Number(b.pickup_lat),
              pickupLng: Number(b.pickup_lng),
              pickupAddress: b.pickup_address,
              pickupOrder: b.pickup_order,
              dropoffLat: Number(b.dropoff_lat),
              dropoffLng: Number(b.dropoff_lng),
              dropoffAddress: b.dropoff_address,
              dropoffOrder: b.dropoff_order,
            })),
        };
      const requests = roster.map((b) => ({
        bookingId: b.booking_id,
        rideId,
        status: b.status,
        seatsReserved: b.seats_reserved,
        createdAt: b.created_at,
        passenger: {
          userId: b.user_id,
          fullName: b.full_name,
          profilePhoto: b.profile_photo,
          rating:
            b.passenger_rating == null ? null : Number(b.passenger_rating),
        },
      }));
      return {
        role: 'conductor',
        ride: header,
        pendingBookings: requests.filter((b) => b.status === 'pending'),
        confirmedBookings: requests.filter((b) => b.status === 'confirmed'),
      };
    }
    const [latest] = await this.db.query<{ booking_id: string }>(
      'select booking_id from public.bookings where ride_id=$1 and user_id=$2 order by created_at desc,booking_id desc limit 1',
      [rideId, user.id],
    );
    const own = roster.find((b) => b.booking_id === latest?.booking_id);
    if (!own)
      throw new NotFoundException('No tienes una reserva en este viaje');
    const myBooking = {
      bookingId: own.booking_id,
      status: own.status,
      seatsReserved: own.seats_reserved,
      createdAt: own.created_at,
      pickupLat: Number(own.pickup_lat),
      pickupLng: Number(own.pickup_lng),
      pickupAddress: own.pickup_address,
      dropoffLat: Number(own.dropoff_lat),
      dropoffLng: Number(own.dropoff_lng),
      dropoffAddress: own.dropoff_address,
    };
    const person = {
      userId: ride.driver_user,
      fullName: ride.driver_name,
      profilePhoto: ride.driver_photo,
      rating: ride.driver_rating == null ? null : Number(ride.driver_rating),
    };
    return active
      ? {
          role: 'pasajero',
          ride: header,
          myBooking,
          driver: {
            ...person,
            vehicleBrand: ride.vehicle_brand,
            vehicleModel: ride.vehicle_model,
            vehicleColor: ride.vehicle_color,
            vehicleLicensePlate: ride.license_plate,
          },
        }
      : {
          role: 'pasajero',
          ride: header,
          myBooking,
          conductorInfo: person,
          vehicleInfo: {
            vehicleId: ride.vehicle_id,
            brand: ride.vehicle_brand,
            model: ride.vehicle_model,
            color: ride.vehicle_color,
            licensePlate: ride.license_plate,
          },
        };
  }
  async requestClosure(user: AuthenticatedUser) {
    if (!this.db.closureEnabled)
      throw new ServiceUnavailableException(
        'El cierre de cuenta aún no está disponible',
      );
    return this.db.transaction(async (client) => {
      await client.query(
        'select uuid from public.users where uuid=$1 for update',
        [user.id],
      );
      const { rows } = await client.query(
        `select 1 from public.rides r join public.driver_profiles d using(driver_id) where r.status in ('scheduled','full','in_progress') and (d.user_id=$1 or exists(select 1 from public.bookings b where b.ride_id=r.ride_id and b.user_id=$1 and b.status in ('pending','confirmed','in_progress'))) limit 1`,
        [user.id],
      );
      if (rows.length)
        throw new ConflictException(
          'Termina o cancela tus viajes y reservas antes de cerrar la cuenta',
        );
      await client.query(
        'insert into krow_pilot.account_closure_requests(actor_id) values($1) on conflict do nothing',
        [user.id],
      );
      await client.query(
        'update public.users set is_active=false where uuid=$1',
        [user.id],
      );
      await client.query(
        'delete from krow_pilot.tracking_sessions where actor_id=$1',
        [user.id],
      );
      await client.query('delete from krow_pilot.devices where actor_id=$1', [
        user.id,
      ]);
      return { status: 'access_closed', dataProcessing: 'pending_policy' };
    });
  }
  async lifecycle(
    user: AuthenticatedUser,
    rideId: string,
    action: 'start' | 'complete' | 'cancel',
  ) {
    return this.db.transaction(async (client) => {
      await client.query(
        'select ride_id from public.rides where ride_id=$1 for update',
        [rideId],
      );
      const ride = await this.ride(rideId, user.id, client, true);
      const target =
        action === 'start'
          ? 'in_progress'
          : action === 'complete'
            ? 'completed'
            : 'cancelled';
      if (ride.status === target) return { success: true };
      if (action === 'start' && !['scheduled', 'full'].includes(ride.status))
        throw new ConflictException('Este viaje no puede iniciarse');
      if (action === 'start') {
        // Two different rides share this driver lock. Locking only ride_id
        // would allow concurrent starts on both trips and strand one GPS feed.
        const approval = await client.query<{ status: string }>(
          'select status from public.driver_profiles where driver_id=$1 for update',
          [ride.driver_id],
        );
        const another = await client.query(
          "select 1 from public.rides where driver_id=$1 and ride_id<>$2 and status='in_progress' limit 1",
          [ride.driver_id, rideId],
        );
        if (another.rows.length)
          throw new ConflictException(
            'Termina el viaje en curso antes de comenzar otro.',
          );
        if (approval.rows[0]?.status !== 'approved')
          throw new ForbiddenException(
            'Tu perfil de conductor debe estar aprobado para comenzar un viaje.',
          );
        const vehicle = await client.query<{ is_active: boolean }>(
          'select is_active from public.vehicles where vehicle_id=$1',
          [ride.vehicle_id],
        );
        if (!vehicle.rows[0]?.is_active)
          throw new ConflictException(
            'El vehículo ya no está disponible. Contacta al equipo de KROW.',
          );
        const remaining = await client.query(
          "select 1 from public.bookings where ride_id=$1 and status='pending' limit 1",
          [rideId],
        );
        if (remaining.rows.length)
          throw new ConflictException(
            'Acepta o rechaza las solicitudes pendientes antes de comenzar',
          );
      }
      if (action === 'complete') {
        if (ride.status !== 'in_progress')
          throw new ConflictException('El viaje no está en curso');
        const remaining = await client.query(
          "select 1 from public.bookings where ride_id=$1 and status in ('pending','confirmed','in_progress') limit 1",
          [rideId],
        );
        if (remaining.rows.length)
          throw new ConflictException(
            'Atiende las paradas pendientes antes de finalizar',
          );
      }
      if (
        action === 'cancel' &&
        ['completed', 'cancelled', 'interrupted'].includes(ride.status)
      )
        throw new ConflictException('El viaje ya terminó');
      if (action === 'cancel')
        await client.query(
          "update public.bookings set status='cancelled' where ride_id=$1 and status in ('pending','confirmed','in_progress')",
          [rideId],
        );
      await client.query(
        'update public.rides set status=$2, version=version+1, updated_at=now() where ride_id=$1',
        [rideId, target],
      );
      await client.query(
        'insert into public.ride_status_history(ride_id,status,previous_status,actor_id,reason) values($1,$2,$3,$4,$5)',
        [rideId, target, ride.status, user.id, 'pilot_' + action],
      );
      if (action !== 'start')
        await client.query(
          'delete from krow_pilot.tracking_sessions where ride_id=$1',
          [rideId],
        );
      return { success: true };
    });
  }
  async updateBooking(
    user: AuthenticatedUser,
    bookingId: string,
    target: string,
    reason?: string,
  ) {
    return this.db.transaction(async (client) => {
      const first = await this.conversation(user, bookingId, client);
      await client.query(
        'select ride_id from public.rides where ride_id=$1 for update',
        [first.ride_id],
      );
      const ride = await this.ride(first.ride_id as string, user.id, client);
      const { rows } = await client.query<{
        status: string;
        user_id: string;
        seats_reserved: number;
      }>(
        'select status,user_id,seats_reserved from public.bookings where booking_id=$1 for update',
        [bookingId],
      );
      const b = rows[0];
      const driver = ride.driver_user === user.id;
      if (
        !(
          (['confirmed', 'rejected'].includes(target) && driver) ||
          (target === 'cancelled' && b.user_id === user.id)
        )
      )
        throw new ForbiddenException(
          'No puedes realizar esta acción sobre la reserva',
        );
      if (b.status === target) return { success: true };
      if (!['scheduled', 'full'].includes(ride.status))
        throw new ConflictException(
          'La reserva solo puede modificarse antes del inicio',
        );
      if (target === 'confirmed' || target === 'rejected') {
        if (b.status !== 'pending')
          throw new ConflictException('La solicitud ya fue atendida');
      } else if (!['pending', 'confirmed'].includes(b.status))
        throw new ConflictException('La reserva ya terminó');
      let seats = Number(ride.available_seats);
      if (target === 'confirmed') {
        if (seats < b.seats_reserved)
          throw new ConflictException('Ya no hay suficientes asientos');
        seats -= b.seats_reserved;
      }
      if (target === 'cancelled' && b.status === 'confirmed')
        seats += b.seats_reserved;
      const status = seats === 0 ? 'full' : 'scheduled';
      await client.query(
        'update public.bookings set status=$2 where booking_id=$1',
        [bookingId, target],
      );
      await client.query(
        'update public.rides set available_seats=$2,status=$3,updated_at=now() where ride_id=$1',
        [ride.ride_id, seats, status],
      );
      if (status !== ride.status)
        await client.query(
          'insert into public.ride_status_history(ride_id,status,previous_status,actor_id,reason) values($1,$2,$3,$4,$5)',
          [
            ride.ride_id,
            status,
            ride.status,
            user.id,
            reason ?? 'pilot_booking_' + target,
          ],
        );
      return { success: true };
    });
  }
  async attend(
    user: AuthenticatedUser,
    rideId: string,
    bookingId: string,
    action: 'board' | 'dropoff' | 'no-show',
  ) {
    return this.db.transaction(async (client) => {
      await client.query(
        'select ride_id from public.rides where ride_id=$1 for update',
        [rideId],
      );
      await this.ride(rideId, user.id, client, true, true);
      const { rows } = await client.query<{ status: string }>(
        'select status from public.bookings where booking_id=$1 and ride_id=$2 for update',
        [bookingId, rideId],
      );
      if (!rows[0]) throw new NotFoundException('Reserva no encontrada');
      const target = nextBookingState(rows[0].status, action);
      if (target !== rows[0].status)
        await client.query(
          'update public.bookings set status=$2 where booking_id=$1',
          [bookingId, target],
        );
      return { success: true, status: target };
    });
  }
  async activity(
    user: AuthenticatedUser,
    context: 'driver' | 'passenger',
    group: 'upcoming' | 'active' | 'history',
    offset: number,
    limit: number,
  ) {
    const rows = await this.db.query(
      `select r.ride_id as "rideId", r.status, r.departure_time as "departureTime",
      r.origin_address as "originAddress", r.destination_address as "destinationAddress",
      r.available_seats as "availableSeats", round(r.price_per_seat*100)::int as "pricePerSeatCents", r.version,
      b.booking_id as "bookingId", b.status as "bookingStatus", p.amount_cents as "amountCents"
      from public.rides r join public.driver_profiles d using(driver_id)
      left join lateral (select own.* from public.bookings own where own.ride_id=r.ride_id and own.user_id=$1 order by own.created_at desc,own.booking_id desc limit 1) b on true
      left join krow_pilot.booking_prices p on p.booking_id=b.booking_id
      where ${context === 'driver' ? 'd.user_id=$1' : 'b.user_id=$1'} and
      ${group === 'upcoming' ? "r.status in ('scheduled','full')" : group === 'active' ? "r.status='in_progress'" : context === 'passenger' ? "(r.status in ('completed','cancelled','interrupted') or b.status in ('completed','cancelled','rejected','no_show','interrupted'))" : "r.status in ('completed','cancelled','interrupted')"}
      ${context === 'passenger' && group !== 'history' ? "and b.status in ('pending','confirmed','in_progress')" : ''}
      order by r.departure_time ${group === 'upcoming' ? 'asc' : 'desc'}, r.ride_id limit $2 offset $3`,
      [user.id, limit, offset],
    );
    return rows;
  }
  async activeRide(user: AuthenticatedUser, context?: 'driver' | 'passenger') {
    const profiles = await this.db.query<{ driver_id: string }>(
      'select driver_id from public.driver_profiles where user_id=$1',
      [user.id],
    );
    const driver = !!profiles[0] && context !== 'passenger';
    const rows = await this.db.query<{
      rideId: string;
      status: string;
      departureTime: Date;
      originAddress: string | null;
      destinationAddress: string | null;
      bookingStatus: string | null;
    }>(
      `select r.ride_id as "rideId",r.status,r.departure_time as "departureTime",r.origin_address as "originAddress",r.destination_address as "destinationAddress",b.status as "bookingStatus"
       from public.rides r join public.driver_profiles d using(driver_id)
       left join lateral(select own.status from public.bookings own where own.ride_id=r.ride_id and own.user_id=$1 order by own.created_at desc,own.booking_id desc limit 1)b on true
       where ${driver ? 'd.user_id=$1' : "b.status in('pending','confirmed','in_progress')"} and r.status in('scheduled','full','in_progress')
       order by (r.status='in_progress') desc,r.departure_time asc,r.ride_id limit 1`,
      [user.id],
    );
    return rows[0]
      ? { ...rows[0], role: driver ? 'driver' : 'passenger' }
      : null;
  }
  private assertTracking() {
    if (!this.db.trackingEnabled)
      throw new ServiceUnavailableException('Seguimiento GPS no habilitado');
  }
  async openSession(user: AuthenticatedUser, rideId: string, deviceId: string) {
    this.assertTracking();
    return this.db.transaction(async (client) => {
      await client.query(
        'select ride_id from public.rides where ride_id=$1 for update',
        [rideId],
      );
      await this.ride(rideId, user.id, client, true, true);
      const existing = await client.query<SessionRow>(
        'select * from krow_pilot.tracking_sessions where ride_id=$1',
        [rideId],
      );
      if (
        existing.rows[0] &&
        existing.rows[0].device_id !== deviceId &&
        existing.rows[0].expires_at.getTime() > Date.now()
      )
        throw new ConflictException(
          'El GPS ya está activo en otro dispositivo. Detén esa sesión primero.',
        );
      const token = randomBytes(32).toString('base64url');
      const result = await client.query<SessionRow>(
        `insert into krow_pilot.tracking_sessions(ride_id,actor_id,device_id,token_hash,expires_at)
        values($1,$2,$3,$4,now()+interval '6 hours') on conflict(ride_id) do update set session_id=gen_random_uuid(), token_hash=excluded.token_hash,
        expires_at=excluded.expires_at, device_id=excluded.device_id, last_seq=-1, position=null, updated_at=now() returning *`,
        [rideId, user.id, deviceId, hash(token)],
      );
      return {
        sessionId: result.rows[0].session_id,
        uploadToken: token,
        expiresAt: result.rows[0].expires_at,
      };
    });
  }
  async upload(
    rideId: string,
    sessionId: string,
    token: string,
    samples: LocationSample[],
  ) {
    this.assertTracking();
    if (!samples.length || samples.length > 100)
      throw new BadRequestException(
        'El lote debe contener entre 1 y 100 posiciones',
      );
    return this.db.transaction(async (client) => {
      // Lock ride first, the same order as terminal commands: completion cannot
      // race with an upload and resurrect private tracking data.
      await client.query(
        'select ride_id from public.rides where ride_id=$1 for update',
        [rideId],
      );
      const { rows } = await client.query<SessionRow & { actor_id: string }>(
        `select * from krow_pilot.tracking_sessions where ride_id=$1 and session_id=$2 and token_hash=$3 and expires_at>now() for update`,
        [rideId, sessionId, hash(token)],
      );
      const session = rows[0];
      if (!session)
        throw new ForbiddenException('Sesión GPS expirada o revocada');
      await this.ride(rideId, session.actor_id, client, true, true);
      let seq = Number(session.last_seq);
      let position = session.position;
      for (const sample of samples) {
        if (validateSample(sample, seq, position?.capturedAt))
          position = sample;
        // A valid but older fix must be consumed without moving the vehicle
        // backwards or trapping the native queue in endless retransmissions.
        seq = Math.max(seq, sample.seq);
      }
      await client.query(
        'update krow_pilot.tracking_sessions set last_seq=$2, position=$3, updated_at=now() where ride_id=$1',
        [rideId, seq, position],
      );
      if (
        position &&
        trackingFreshness(position).state === 'live' &&
        position.accuracy <= 100
      ) {
        await client.query(
          `insert into krow_pilot.outbox(event_key,ride_id,booking_id,recipient_id,kind,expires_at)
          select 'proximity:'||b.booking_id::text||':'||b.status,b.ride_id,b.booking_id,recipient,'proximity',now()+interval '1 minute'
          from public.bookings b join public.rides r using(ride_id) join public.driver_profiles d using(driver_id)
          join public.ride_stops s on s.stop_id=case when b.status='confirmed' then b.pickup_stop_id else b.dropoff_stop_id end
          cross join lateral (values(b.user_id),(d.user_id)) recipients(recipient)
          where b.ride_id=$1 and b.status in('confirmed','in_progress') and
          power((s.lat::double precision-$2)*111320,2)+power((s.lng::double precision-$3)*111320*cos(radians($2)),2)<22500
          on conflict(event_key,recipient_id) do nothing`,
          [rideId, position.lat, position.lng],
        );
      }
      return { acknowledgedSeq: seq };
    });
  }
  async closeSession(user: AuthenticatedUser, rideId: string) {
    await this.ride(rideId, user.id, undefined, true);
    await this.db.query(
      'delete from krow_pilot.tracking_sessions where ride_id=$1',
      [rideId],
    );
    return { success: true };
  }
  async revokeUpload(rideId: string, sessionId: string, token: string) {
    await this.db.query(
      'delete from krow_pilot.tracking_sessions where ride_id=$1 and session_id=$2 and token_hash=$3',
      [rideId, sessionId, hash(token)],
    );
    return { success: true };
  }
  async snapshot(user: AuthenticatedUser, rideId: string) {
    // Ordering belongs to the complete snapshot, not only its GPS fix. A slow
    // REST response must not overwrite newer socket stop/boarding state.
    const observedAt = new Date().toISOString();
    this.assertTracking();
    const ride = await this.ride(rideId, user.id, undefined, false, true);
    const driver = ride.driver_user === user.id;
    const roster = await this.roster(rideId);
    const [{ position = null } = {}] = await this.db.query<{
      position: LocationSample | null;
    }>(
      'select position from krow_pilot.tracking_sessions where ride_id=$1 and expires_at>now()',
      [rideId],
    );
    const pending = roster.filter((b) =>
      ['confirmed', 'in_progress'].includes(b.status),
    );
    const stops = new Map<
      string,
      {
        stopId: string;
        order: number;
        lat: number;
        lng: number;
        address: string;
        pickups: Array<{ bookingId: string; name: string }>;
        dropoffs: Array<{ bookingId: string; name: string }>;
      }
    >();
    // Preserve each confirmed pickup AND its later dropoff in the operational
    // geometry. Only actions currently eligible appear in the driver panel.
    for (const b of pending) {
      for (const kind of (b.status === 'confirmed'
        ? ['pickup', 'dropoff']
        : ['dropoff']) as Array<'pickup' | 'dropoff'>) {
        const id = b[`${kind}_id`];
        if (!stops.has(id))
          stops.set(id, {
            stopId: id,
            order: b[`${kind}_order`],
            lat: Number(b[`${kind}_lat`]),
            lng: Number(b[`${kind}_lng`]),
            address: b[`${kind}_address`],
            pickups: [],
            dropoffs: [],
          });
        if (driver && (kind === 'pickup' || b.status === 'in_progress'))
          stops
            .get(id)!
            [
              kind === 'pickup' ? 'pickups' : 'dropoffs'
            ].push({ bookingId: b.booking_id, name: b.full_name || 'Pasajero' });
      }
    }
    const ordered = [...stops.values()].sort((a, b) => a.order - b.order);
    const liveOrigin =
      position &&
      trackingFreshness(position).state === 'live' &&
      position.accuracy <= 100
        ? position
        : null;
    const key = `${rideId}:${ride.version}:${pending.map((b) => `${b.booking_id}:${b.status}`).join(',')}:${liveOrigin ? 'gps' : 'published'}`;
    let route = this.routeCache.get(key)?.value;
    let routeError: string | null = route?.error ?? null;
    if (!route || this.routeCache.get(key)!.expires < Date.now()) {
      try {
        const computed = await this.maps.routePreview(
          liveOrigin ?? {
            lat: Number(ride.origin_lat),
            lng: Number(ride.origin_lng),
          },
          {
            lat: Number(ride.destination_lat),
            lng: Number(ride.destination_lng),
          },
          undefined,
          ordered.map((s) => ({ lat: s.lat, lng: s.lng })),
        );
        if (!computed) throw new Error('Sin ruta disponible');
        routeError = null;
        route = {
          polyline: computed.encodedPolyline,
          durationSeconds: computed.durationSeconds,
          calculatedAt: computed.calculatedAt,
        };
        if (this.routeCache.size >= 100)
          this.routeCache.delete(String(this.routeCache.keys().next().value));
        this.routeCache.set(key, {
          expires: Date.now() + 600_000,
          value: route,
        });
      } catch {
        routeError =
          'No pudimos actualizar el recorrido. Se muestra la ruta publicada.';
        route = {
          polyline: ride.route_polyline,
          durationSeconds: 0,
          calculatedAt: '',
          error: routeError,
        };
        if (this.routeCache.size >= 100)
          this.routeCache.delete(String(this.routeCache.keys().next().value));
        this.routeCache.set(key, { expires: Date.now() + 15000, value: route });
      }
    }
    // Google requests may outlive cancellation/boarding. Recheck access before
    // distribution and discard this snapshot if the roster changed mid-flight.
    await this.ride(rideId, user.id, undefined, false, true);
    const freshRoster = await this.roster(rideId);
    if (
      freshRoster.map((b) => `${b.booking_id}:${b.status}`).join(',') !==
      roster.map((b) => `${b.booking_id}:${b.status}`).join(',')
    )
      throw new ConflictException('El viaje cambió. Actualiza el seguimiento.');
    const freshness = trackingFreshness(position);
    const own = pending.find((b) => b.user_id === user.id);
    return {
      rideId,
      observedAt,
      role: driver ? 'driver' : 'passenger',
      position,
      ...freshness,
      route: { ...route, version: key, error: routeError },
      stops: driver ? ordered : [],
      nextStop: driver
        ? (ordered.find((s) => s.pickups.length || s.dropoffs.length) ?? null)
        : null,
      myStop:
        !driver && own
          ? {
              lat: Number(own.dropoff_lat),
              lng: Number(own.dropoff_lng),
              address: own.dropoff_address,
            }
          : null,
      myPickup:
        !driver && own
          ? {
              lat: Number(own.pickup_lat),
              lng: Number(own.pickup_lng),
              address: own.pickup_address,
            }
          : null,
      nextAction:
        !driver && own
          ? own.status === 'confirmed'
            ? 'pickup'
            : 'dropoff'
          : null,
      etaSeconds: routeError
        ? null
        : approximateEta(
            route.polyline,
            route.durationSeconds,
            position,
            driver
              ? (ordered[0] ?? {
                  lat: Number(ride.destination_lat),
                  lng: Number(ride.destination_lng),
                })
              : {
                  lat: Number(
                    own?.status === 'confirmed'
                      ? own.pickup_lat
                      : own?.dropoff_lat,
                  ),
                  lng: Number(
                    own?.status === 'confirmed'
                      ? own.pickup_lng
                      : own?.dropoff_lng,
                  ),
                },
          ),
      canComplete:
        driver &&
        !roster.some((b) =>
          ['pending', 'confirmed', 'in_progress'].includes(b.status),
        ),
    };
  }
  private async conversation(
    user: AuthenticatedUser,
    bookingId: string,
    client?: PoolClient,
  ) {
    const sql =
      'select b.ride_id, b.status, b.user_id, r.status as ride_status, d.user_id as driver_user from public.bookings b join public.rides r using(ride_id) join public.driver_profiles d using(driver_id) where b.booking_id=$1';
    const rows = client
      ? (await client.query(sql, [bookingId])).rows
      : await this.db.query(sql, [bookingId]);
    const booking = rows[0];
    if (!booking) throw new NotFoundException('Reserva no disponible');
    await this.ride(booking.ride_id as string, user.id, client);
    if (user.id !== booking.user_id && user.id !== booking.driver_user)
      throw new ForbiddenException('Conversación privada');
    return booking;
  }
  async messages(user: AuthenticatedUser, bookingId: string, cursor?: string) {
    const b = await this.conversation(user, bookingId);
    let at: string | null = null,
      id: string | null = null;
    if (cursor) {
      try {
        const decoded: unknown = JSON.parse(
          Buffer.from(cursor, 'base64url').toString('utf8'),
        );
        if (typeof decoded !== 'object' || decoded === null) throw new Error();
        const v = decoded as { at?: unknown; id?: unknown };
        if (
          typeof v.at !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(v.at) ||
          !Number.isFinite(Date.parse(v.at)) ||
          new Date(v.at).toISOString().slice(0, 19) !== v.at.slice(0, 19) ||
          typeof v.id !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            v.id,
          )
        )
          throw new Error();
        at = v.at;
        id = v.id;
      } catch {
        throw new BadRequestException('Cursor de conversación inválido');
      }
    }
    const messages = await this.db.query(
      `select message_id as "messageId",sender_id as "senderId",client_id as "clientId",body,to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt" from krow_pilot.messages
      where booking_id=$1 and ($2::timestamptz is null or (created_at,message_id)<($2::timestamptz,$3::uuid)) order by created_at desc,message_id desc limit 40`,
      [bookingId, at, id],
    );
    return {
      messages,
      nextCursor:
        messages.length === 40
          ? Buffer.from(
              JSON.stringify({
                at: messages.at(-1)!.createdAt,
                id: messages.at(-1)!.messageId,
              }),
            ).toString('base64url')
          : null,
      canWrite:
        ['confirmed', 'in_progress'].includes(b.status as string) &&
        ['scheduled', 'full', 'in_progress'].includes(b.ride_status as string),
    };
  }
  async send(
    user: AuthenticatedUser,
    bookingId: string,
    clientId: string,
    body: string,
  ) {
    if (!body.trim() || body.trim().length > 2000)
      throw new BadRequestException(
        'Escribe un mensaje de hasta 2000 caracteres',
      );
    return this.db.transaction(async (client) => {
      const first = await this.conversation(user, bookingId, client);
      await client.query(
        'select ride_id from public.rides where ride_id=$1 for update',
        [first.ride_id],
      );
      await client.query(
        'select booking_id from public.bookings where booking_id=$1 for update',
        [bookingId],
      );
      const b = await this.conversation(user, bookingId, client);
      const existing = await client.query(
        'select message_id from krow_pilot.messages where booking_id=$1 and sender_id=$2 and client_id=$3',
        [bookingId, user.id, clientId],
      );
      if (existing.rows[0])
        return { messageId: existing.rows[0].message_id as string };
      if (
        !['confirmed', 'in_progress'].includes(b.status as string) ||
        !['scheduled', 'full', 'in_progress'].includes(b.ride_status as string)
      )
        throw new ConflictException(
          'La conversación está disponible solo para lectura',
        );
      const { rows } = await client.query(
        'insert into krow_pilot.messages(booking_id,sender_id,client_id,body) values($1,$2,$3,$4) returning message_id',
        [bookingId, user.id, clientId, body.trim()],
      );
      return { messageId: rows[0].message_id as string };
    });
  }
  async cash(user: AuthenticatedUser, bookingId: string) {
    await this.conversation(user, bookingId);
    const [row] = await this.db.query(
      `select p.amount_cents as "amountCents",coalesce(c.status,case when b.status in ('cancelled','rejected','no_show') then 'void' else 'pending' end) as status
      from krow_pilot.booking_prices p join public.bookings b using(booking_id) left join krow_pilot.cash c using(booking_id) where p.booking_id=$1`,
      [bookingId],
    );
    return row;
  }
  async collect(user: AuthenticatedUser, bookingId: string) {
    return this.db.transaction(async (client) => {
      await client.query(
        'select booking_id from public.bookings where booking_id=$1 for update',
        [bookingId],
      );
      const b = await this.conversation(user, bookingId, client);
      if (b.driver_user !== user.id)
        throw new ForbiddenException(
          'Solo el conductor puede registrar el efectivo',
        );
      if (!['in_progress', 'completed'].includes(b.status as string))
        throw new ConflictException('Esta reserva no admite cobro');
      await client.query(
        `insert into krow_pilot.cash(booking_id,amount_cents,status,collected_by) select booking_id,amount_cents,'collected',$2 from krow_pilot.booking_prices where booking_id=$1
        on conflict(booking_id) do update set status='collected', collected_by=$2,updated_at=now()`,
        [bookingId, user.id],
      );
      return { success: true };
    });
  }
  async review(
    user: AuthenticatedUser,
    bookingId: string,
    stars: number,
    comment: string,
  ) {
    const b = await this.conversation(user, bookingId);
    if (b.status !== 'completed')
      throw new ConflictException(
        'Solo puedes calificar una reserva completada',
      );
    const subject = b.driver_user === user.id ? b.user_id : b.driver_user;
    return this.db.transaction(async (client) => {
      await client.query(
        'select uuid from public.users where uuid=$1 for update',
        [subject],
      );
      const { rows } = await client.query(
        `insert into public.ride_reviews(ride_id,reviewer_id,reviewee_id,rating,comment) values($1,$2,$3,$4,$5) on conflict do nothing returning review_id`,
        [b.ride_id, user.id, subject, stars, comment.trim()],
      );
      if (!rows.length)
        throw new ConflictException('Ya calificaste esta reserva');
      await client.query(
        'insert into krow_pilot.reviews(booking_id,author_id,review_id) values($1,$2,$3)',
        [bookingId, user.id, rows[0].review_id],
      );
      return { success: true };
    });
  }
  async history(user: AuthenticatedUser, rideId: string) {
    const ride = await this.ride(rideId, user.id);
    const driver = ride.driver_user === user.id;
    const rows = await this.db.query(
      `select b.booking_id as "bookingId",b.status,u.full_name as name,p.amount_cents as "amountCents",
      coalesce(c.status,case when b.status in ('cancelled','rejected','no_show') then 'void' else 'pending' end) as "cashStatus",
      s.address as "pickupAddress",t.address as "dropoffAddress",s.stop_order as "pickupOrder",t.stop_order as "dropoffOrder",rv.rating as "myReview"
      from public.bookings b join public.users u on u.uuid=b.user_id join krow_pilot.booking_prices p using(booking_id)
      join public.ride_stops s on s.stop_id=b.pickup_stop_id join public.ride_stops t on t.stop_id=b.dropoff_stop_id
      left join krow_pilot.cash c using(booking_id) left join public.ride_reviews rv on rv.ride_id=b.ride_id and rv.reviewer_id=$2 and rv.reviewee_id=case when $3::boolean then b.user_id else $4::uuid end
      where b.ride_id=$1 and ($3::boolean or b.booking_id=(select own.booking_id from public.bookings own where own.ride_id=$1 and own.user_id=$2 order by own.created_at desc,own.booking_id desc limit 1)) order by b.created_at,b.booking_id`,
      [rideId, user.id, driver, ride.driver_user],
    );
    return {
      role: driver ? 'driver' : 'passenger',
      ride: {
        ride_id: ride.ride_id,
        status: ride.status,
        departure_time: ride.departure_time,
        origin_address: ride.origin_address,
        destination_address: ride.destination_address,
        driver_name: ride.driver_name,
        vehicle_brand: ride.vehicle_brand,
        vehicle_model: ride.vehicle_model,
        license_plate: ride.license_plate,
      },
      bookings: rows,
    };
  }
}
