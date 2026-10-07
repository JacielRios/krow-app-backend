import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service.js';
import type { AuthenticatedUser } from '../auth/domain/authenticated-user.js';
import { PilotDatabase } from '../pilot/pilot.database.js';
import { adminTransaction } from './admin.database.js';
import type {
  AdminDriver,
  AdminDriverDetail,
  AdminVehicle,
  AdminDocument,
  AdminRide,
  AdminRideDetail,
  AdminRoute,
  AdminPassenger,
  AdminRideHistory,
} from './admin.types.js';
import type {
  AdminAuditListDto,
  AdminDocumentListDto,
  AdminDriverListDto,
  AdminListDto,
  AdminRideListDto,
  AdminStatusDto,
  AdminVehicleListDto,
  CreateAdminDocumentDto,
  CreateAdminDriverDto,
  CreateAdminVehicleDto,
  UpdateAdminDocumentDto,
  UpdateAdminDriverDto,
  UpdateAdminVehicleDto,
} from './admin.dto.js';

const BUCKET = 'krow-admin-documents';
type Value = Record<string, unknown>;
interface JsonRow<T = Value> extends QueryResultRow {
  value: T;
}
interface DocumentRow extends QueryResultRow {
  document_id: string;
  driver_id: string | null;
  vehicle_id: string | null;
  kind: string;
  status: string;
  upload_state: string;
  expires_on: string | null;
  storage_path: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  review_notes: string | null;
  created_at: Date;
}
const DRIVER_FROM =
  'from public.driver_profiles d join public.users u on u.uuid=d.user_id';
const DRIVER_ISSUES = `array_remove(array[
  case when u.is_active=false or u.deleted_at is not null then 'Cuenta no disponible' end,
  case when d.admin_status<>'active' then 'Conductor no activo' end,
  case when d.license_expiry<current_date then 'Licencia vencida' end,
  case when not exists(select 1 from krow_admin.documents doc where doc.driver_id=d.driver_id and doc.kind='license' and doc.status='approved' and doc.upload_state='uploaded' and (doc.expires_on is null or doc.expires_on>=current_date)) then 'Falta licencia documental aprobada y vigente' end
],null)`;
const DRIVER_VALUE = `jsonb_build_object('driverId',d.driver_id,'userId',d.user_id,'fullName',u.full_name,'email',u.email_address,'institutionalId',u.institutional_id,
  'licenseNumber',d.license_number,'licenseExpiresAt',to_char(d.license_expiry,'YYYY-MM-DD'),'approvalStatus',d.status,'status',d.admin_status,'rating',d.rating,
  'vehicleCount',(select count(*) from public.vehicles v where v.driver_id=d.driver_id),
  'compliance',jsonb_build_object('state',case when cardinality(${DRIVER_ISSUES})=0 then 'ready' else 'attention' end,'reasons',to_jsonb(${DRIVER_ISSUES})))`;
const VEHICLE_FROM =
  'from public.vehicles v join public.driver_profiles d using(driver_id) join public.users u on u.uuid=d.user_id';
const VEHICLE_ISSUES = `array_remove(array[
  case when d.admin_status<>'active' then 'Conductor no activo' end,
  case when v.admin_status<>'active' then 'Vehículo no activo' end,
  case when not exists(select 1 from krow_admin.documents doc where doc.vehicle_id=v.vehicle_id and doc.kind='registration' and doc.status='approved' and doc.upload_state='uploaded' and (doc.expires_on is null or doc.expires_on>=current_date)) then 'Falta tarjeta de circulación aprobada y vigente' end,
  case when not exists(select 1 from krow_admin.documents doc where doc.vehicle_id=v.vehicle_id and doc.kind='insurance' and doc.status='approved' and doc.upload_state='uploaded' and (doc.expires_on is null or doc.expires_on>=current_date)) then 'Falta seguro aprobado y vigente' end
],null)`;
const VEHICLE_VALUE = `jsonb_build_object('vehicleId',v.vehicle_id,'driverId',v.driver_id,'driverName',u.full_name,'plate',v.license_plate,'brand',v.brand,'model',v.model,'year',v.car_year,'color',v.car_color,'capacity',v.capacity,'status',v.admin_status,'isActive',v.is_active,
  'compliance',jsonb_build_object('state',case when cardinality(${VEHICLE_ISSUES})=0 then 'ready' else 'attention' end,'reasons',to_jsonb(${VEHICLE_ISSUES})))`;
const DOCUMENT_FROM =
  'from krow_admin.documents doc left join public.vehicles v on v.vehicle_id=doc.vehicle_id join public.driver_profiles d on d.driver_id=coalesce(doc.driver_id,v.driver_id) join public.users u on u.uuid=d.user_id';
const DOCUMENT_VALUE = `jsonb_build_object('documentId',doc.document_id,'driverId',coalesce(doc.driver_id,v.driver_id),'vehicleId',doc.vehicle_id,'driverName',u.full_name,
  'kind',doc.kind,'status',doc.status,'uploadState',doc.upload_state,'expiresAt',to_char(doc.expires_on,'YYYY-MM-DD'),'isExpired',coalesce(doc.expires_on<current_date,false),
  'fileName',doc.file_name,'contentType',doc.content_type,'sizeBytes',doc.size_bytes,'reviewNotes',doc.review_notes,'createdAt',doc.created_at)`;
const RIDE_FROM = `from public.rides r join public.driver_profiles d using(driver_id) join public.users u on u.uuid=d.user_id join public.vehicles v using(vehicle_id)
  left join lateral(select count(*) as booking_count,coalesce(sum(b.seats_reserved) filter(where b.status in('confirmed','in_progress','completed')),0) as passengers,
    coalesce(sum(b.seats_reserved) filter(where b.status='completed'),0) as transported,
    coalesce(sum(p.amount_cents) filter(where b.status in('confirmed','in_progress','completed')),0) as gross,
    coalesce(sum(c.amount_cents) filter(where c.status='collected'),0) as collected,
    coalesce(sum(p.amount_cents) filter(where b.status in('confirmed','in_progress','completed') and coalesce(c.status,'pending')='pending'),0) as pending
    from public.bookings b left join krow_pilot.booking_prices p using(booking_id) left join krow_pilot.cash c using(booking_id) where b.ride_id=r.ride_id) totals on true`;
const RIDE_VALUE = `jsonb_build_object('rideId',r.ride_id,'driverId',r.driver_id,'driverName',u.full_name,'vehicleId',r.vehicle_id,'plate',v.license_plate,
  'origin',jsonb_build_object('lat',r.origin_lat,'lng',r.origin_lng,'address',r.origin_address),'destination',jsonb_build_object('lat',r.destination_lat,'lng',r.destination_lng,'address',r.destination_address),
  'departureTime',r.departure_time,'createdAt',r.created_at,'status',r.status,'pricePerSeatCents',round(r.price_per_seat*100)::integer,'availableSeats',r.available_seats,
  'passengerCount',totals.passengers,'transportedPassengers',totals.transported,'bookingCount',totals.booking_count,'grossAmountCents',totals.gross,'collectedAmountCents',totals.collected,'pendingAmountCents',totals.pending)`;
const approval = (status: string) =>
  status === 'active'
    ? 'approved'
    : status === 'suspended'
      ? 'suspended'
      : 'pending';
const pattern = (q?: string) =>
  q ? `%${q.replace(/[\\%_]/g, '\\$&')}%` : null;
const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Monterrey',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

@Injectable()
export class AdminService {
  constructor(
    private readonly db: PilotDatabase,
    private readonly supabase: SupabaseService,
  ) {}
  private run<T>(
    user: AuthenticatedUser,
    work: (client: PoolClient) => Promise<T>,
  ) {
    return adminTransaction(this.db, user, work);
  }
  async me(user: AuthenticatedUser) {
    return this.run(user, () =>
      Promise.resolve({
        id: user.id,
        email: user.email,
        role: 'admin' as const,
      }),
    );
  }
  private async paged(
    client: PoolClient,
    dto: AdminListDto,
    value: string,
    from: string,
    where: string,
    values: unknown[],
    order: string,
  ) {
    const page = dto.page ?? 1,
      pageSize = dto.pageSize ?? 20;
    const total = (
      await client.query<{ total: string }>(
        `select count(*)::text as total ${from} where ${where}`,
        values,
      )
    ).rows[0].total;
    const { rows } = await client.query<JsonRow>(
      `select ${value} as value ${from} where ${where} order by ${order} limit $${values.length + 1} offset $${values.length + 2}`,
      [...values, pageSize, (page - 1) * pageSize],
    );
    return {
      items: rows.map((row) => row.value),
      total: Number(total),
      page,
      pageSize,
    };
  }
  async users(user: AuthenticatedUser, dto: AdminListDto) {
    return this.run(user, (client) =>
      this.paged(
        client,
        dto,
        "jsonb_build_object('userId',u.uuid,'fullName',u.full_name,'email',u.email_address,'institutionalId',u.institutional_id,'hasDriverProfile',exists(select 1 from public.driver_profiles d where d.user_id=u.uuid))",
        'from public.users u',
        'u.is_active is distinct from false and u.deleted_at is null and ($1::text is null or u.full_name ilike $1 or u.email_address ilike $1 or u.institutional_id ilike $1)',
        [pattern(dto.q)],
        'u.full_name nulls last,u.uuid',
      ),
    );
  }
  async drivers(user: AuthenticatedUser, dto: AdminDriverListDto) {
    return this.run(user, (client) =>
      this.paged(
        client,
        dto,
        DRIVER_VALUE,
        DRIVER_FROM,
        '($1::text is null or u.full_name ilike $1 or u.email_address ilike $1 or u.institutional_id ilike $1 or d.license_number ilike $1 or d.driver_id::text ilike $1) and ($2::text is null or d.admin_status=$2)',
        [pattern(dto.q), dto.status ?? null],
        'u.full_name nulls last,d.driver_id',
      ),
    );
  }
  private async driverValue(client: PoolClient, id: string) {
    const row = (
      await client.query<JsonRow<AdminDriver>>(
        `select ${DRIVER_VALUE} as value ${DRIVER_FROM} where d.driver_id=$1`,
        [id],
      )
    ).rows[0];
    if (!row) throw new NotFoundException('Conductor no encontrado');
    return row.value;
  }
  async driver(
    user: AuthenticatedUser,
    id: string,
  ): Promise<AdminDriverDetail> {
    return this.run(user, async (client) => ({
      ...(await this.driverValue(client, id)),
      vehicles: (
        await client.query<JsonRow<AdminVehicle>>(
          `select ${VEHICLE_VALUE} as value ${VEHICLE_FROM} where d.driver_id=$1 order by v.license_plate,v.vehicle_id`,
          [id],
        )
      ).rows.map((r) => r.value),
      documents: (
        await client.query<JsonRow<AdminDocument>>(
          `select ${DOCUMENT_VALUE} as value ${DOCUMENT_FROM} where d.driver_id=$1 order by doc.created_at desc,doc.document_id desc`,
          [id],
        )
      ).rows.map((r) => r.value),
    }));
  }
  private async log(
    client: PoolClient,
    user: AuthenticatedUser,
    action: string,
    entityType: string,
    entityId: string,
    before: unknown,
    after: unknown,
    reason?: string,
  ) {
    await client.query(
      'insert into krow_admin.audit_log(actor_id,action,entity_type,entity_id,changes) values($1,$2,$3,$4,$5::jsonb)',
      [
        user.id,
        action,
        entityType,
        entityId,
        JSON.stringify({ before, after, ...(reason ? { reason } : {}) }),
      ],
    );
  }
  private validLicense(expiry: string) {
    if (expiry < today())
      throw new ConflictException(
        'La licencia debe estar vigente para activar al conductor.',
      );
  }
  async createDriver(user: AuthenticatedUser, dto: CreateAdminDriverDto) {
    if (Boolean(dto.userId) === Boolean(dto.email))
      throw new BadRequestException(
        'Indica el correo o identificador de una cuenta registrada.',
      );
    if (dto.status === 'active') this.validLicense(dto.licenseExpiresAt);
    return this.run(user, async (client) => {
      const account = (
        await client.query<{ uuid: string }>(
          `select uuid from public.users where ${dto.userId ? 'uuid=$1' : 'lower(email_address)=lower($1)'} and is_active is distinct from false and deleted_at is null for update`,
          [dto.userId ?? dto.email],
        )
      ).rows[0];
      if (!account)
        throw new NotFoundException(
          'La persona debe registrarse primero en KROW. No se encontró una cuenta disponible.',
        );
      const result = await client.query<{ driver_id: string }>(
        'insert into public.driver_profiles(user_id,license_number,license_expiry,status,admin_status) values($1,$2,$3,$4,$5) returning driver_id',
        [
          account.uuid,
          dto.licenseNumber,
          dto.licenseExpiresAt,
          approval(dto.status ?? 'inactive'),
          dto.status ?? 'inactive',
        ],
      );
      const id = result.rows[0].driver_id,
        after = await this.driverValue(client, id);
      await this.log(client, user, 'created', 'driver', id, null, after);
      return after;
    });
  }
  async updateDriver(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateAdminDriverDto,
  ) {
    if (!Object.values(dto).some((v) => v !== undefined && v !== null))
      throw new BadRequestException('Indica al menos un cambio.');
    return this.run(user, async (client) => {
      const current = (
        await client.query<{
          user_id: string;
          admin_status: string;
          license_expiry: Date;
        }>(
          'select user_id,admin_status,license_expiry from public.driver_profiles where driver_id=$1 for update',
          [id],
        )
      ).rows[0];
      if (!current) throw new NotFoundException('Conductor no encontrado');
      if (dto.licenseExpiresAt && current.admin_status === 'active')
        this.validLicense(dto.licenseExpiresAt);
      const before = await this.driverValue(client, id);
      await client.query(
        'update public.driver_profiles set license_number=coalesce($2,license_number),license_expiry=coalesce($3::date,license_expiry) where driver_id=$1',
        [id, dto.licenseNumber ?? null, dto.licenseExpiresAt ?? null],
      );
      if (dto.fullName)
        await client.query(
          'update public.users set full_name=$2 where uuid=$1',
          [current.user_id, dto.fullName],
        );
      const after = await this.driverValue(client, id);
      await this.log(client, user, 'updated', 'driver', id, before, after);
      return after;
    });
  }
  async driverStatus(user: AuthenticatedUser, id: string, dto: AdminStatusDto) {
    return this.run(user, async (client) => {
      const row = (
        await client.query<{ expiry: string }>(
          "select to_char(license_expiry,'YYYY-MM-DD') as expiry from public.driver_profiles where driver_id=$1 for update",
          [id],
        )
      ).rows[0];
      if (!row) throw new NotFoundException('Conductor no encontrado');
      if (dto.status === 'active') this.validLicense(row.expiry);
      const before = await this.driverValue(client, id);
      await client.query(
        'update public.driver_profiles set admin_status=$2,status=$3 where driver_id=$1',
        [id, dto.status, approval(dto.status)],
      );
      const after = await this.driverValue(client, id);
      await this.log(
        client,
        user,
        'status_changed',
        'driver',
        id,
        before,
        after,
        dto.reason,
      );
      return after;
    });
  }
  async vehicles(user: AuthenticatedUser, dto: AdminVehicleListDto) {
    return this.run(user, (client) =>
      this.paged(
        client,
        dto,
        VEHICLE_VALUE,
        VEHICLE_FROM,
        '($1::text is null or v.license_plate ilike $1 or v.brand ilike $1 or v.model ilike $1 or u.full_name ilike $1) and ($2::text is null or v.admin_status=$2) and ($3::uuid is null or v.driver_id=$3)',
        [pattern(dto.q), dto.status ?? null, dto.driverId ?? null],
        'v.license_plate,v.vehicle_id',
      ),
    );
  }
  private async vehicleValue(client: PoolClient, id: string) {
    const row = (
      await client.query<JsonRow<AdminVehicle>>(
        `select ${VEHICLE_VALUE} as value ${VEHICLE_FROM} where v.vehicle_id=$1`,
        [id],
      )
    ).rows[0];
    if (!row) throw new NotFoundException('Vehículo no encontrado');
    return row.value;
  }
  async createVehicle(user: AuthenticatedUser, dto: CreateAdminVehicleDto) {
    return this.run(user, async (client) => {
      if (
        !(
          await client.query(
            'select driver_id from public.driver_profiles where driver_id=$1 for update',
            [dto.driverId],
          )
        ).rows.length
      )
        throw new NotFoundException('Conductor no encontrado');
      const { rows } = await client.query<{ vehicle_id: string }>(
        'insert into public.vehicles(driver_id,license_plate,brand,model,car_year,car_color,capacity,is_active,admin_status) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning vehicle_id',
        [
          dto.driverId,
          dto.plate.toUpperCase(),
          dto.brand,
          dto.model,
          dto.year,
          dto.color,
          dto.capacity,
          dto.status === 'active',
          dto.status ?? 'inactive',
        ],
      );
      const id = rows[0].vehicle_id,
        after = await this.vehicleValue(client, id);
      await this.log(client, user, 'created', 'vehicle', id, null, after);
      return after;
    });
  }
  async updateVehicle(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateAdminVehicleDto,
  ) {
    if (!Object.values(dto).some((v) => v !== undefined && v !== null))
      throw new BadRequestException('Indica al menos un cambio.');
    return this.run(user, async (client) => {
      if (
        !(
          await client.query(
            'select vehicle_id from public.vehicles where vehicle_id=$1 for update',
            [id],
          )
        ).rows.length
      )
        throw new NotFoundException('Vehículo no encontrado');
      if (dto.capacity !== undefined) {
        const tooSmall = await client.query(
          `select 1 from public.rides r where r.vehicle_id=$1 and r.status in('scheduled','full','in_progress') and $2 < r.available_seats+coalesce((select sum(b.seats_reserved) from public.bookings b where b.ride_id=r.ride_id and b.status in('confirmed','in_progress')),0) limit 1`,
          [id, dto.capacity],
        );
        if (tooSmall.rows.length)
          throw new ConflictException(
            'La capacidad no puede reducirse por debajo de los asientos comprometidos en viajes pendientes.',
          );
      }
      const before = await this.vehicleValue(client, id);
      await client.query(
        `update public.vehicles set license_plate=coalesce($2,license_plate),brand=coalesce($3,brand),model=coalesce($4,model),car_year=coalesce($5,car_year),car_color=coalesce($6,car_color),capacity=coalesce($7,capacity),admin_status=coalesce($8,admin_status),is_active=case when $8::text is null then is_active else $8='active' end where vehicle_id=$1`,
        [
          id,
          dto.plate?.toUpperCase() ?? null,
          dto.brand ?? null,
          dto.model ?? null,
          dto.year ?? null,
          dto.color ?? null,
          dto.capacity ?? null,
          dto.status ?? null,
        ],
      );
      const after = await this.vehicleValue(client, id);
      await this.log(client, user, 'updated', 'vehicle', id, before, after);
      return after;
    });
  }
  async documents(user: AuthenticatedUser, dto: AdminDocumentListDto) {
    return this.run(user, (client) =>
      this.paged(
        client,
        dto,
        DOCUMENT_VALUE,
        DOCUMENT_FROM,
        `($1::uuid is null or d.driver_id=$1) and ($2::uuid is null or doc.vehicle_id=$2) and ($3::text is null or doc.status=$3)
      and ($4::text is null or $4='all' or ($4='expired' and doc.expires_on<current_date) or ($4='valid' and doc.expires_on>=current_date) or ($4='no_expiry' and doc.expires_on is null))
      and ($5::text is null or doc.file_name ilike $5 or u.full_name ilike $5)`,
        [
          dto.driverId ?? null,
          dto.vehicleId ?? null,
          dto.status ?? null,
          dto.validity ?? null,
          pattern(dto.q),
        ],
        'doc.created_at desc,doc.document_id desc',
      ),
    );
  }
  private async documentRow(client: PoolClient, id: string, lock = false) {
    const row = (
      await client.query<DocumentRow>(
        `select *,to_char(expires_on,'YYYY-MM-DD') as expires_on from krow_admin.documents where document_id=$1 ${lock ? 'for update' : ''}`,
        [id],
      )
    ).rows[0];
    if (!row) throw new NotFoundException('Documento no encontrado');
    return row;
  }
  private async documentValue(client: PoolClient, id: string) {
    return (
      await client.query<JsonRow<AdminDocument>>(
        `select ${DOCUMENT_VALUE} as value ${DOCUMENT_FROM} where doc.document_id=$1`,
        [id],
      )
    ).rows[0].value;
  }
  async upload(user: AuthenticatedUser, dto: CreateAdminDocumentDto) {
    if (Boolean(dto.driverId) === Boolean(dto.vehicleId))
      throw new BadRequestException('Selecciona un conductor o un vehículo.');
    if (
      (dto.driverId && ['registration', 'insurance'].includes(dto.kind)) ||
      (dto.vehicleId && ['license', 'identity'].includes(dto.kind))
    )
      throw new BadRequestException(
        'El tipo de documento no corresponde a la persona o vehículo seleccionado.',
      );
    const extension: Record<string, string> = {
      'application/pdf': 'pdf',
      'image/jpeg': 'jpg',
      'image/png': 'png',
    };
    const id = randomUUID(),
      path = `documents/${id}.${extension[dto.contentType]}`;
    const document = await this.run(user, async (client) => {
      const owner = await client.query(
        dto.driverId
          ? 'select driver_id from public.driver_profiles where driver_id=$1'
          : 'select vehicle_id from public.vehicles where vehicle_id=$1',
        [dto.driverId ?? dto.vehicleId],
      );
      if (!owner.rows.length)
        throw new NotFoundException('Conductor o vehículo no encontrado');
      await client.query(
        'insert into krow_admin.documents(document_id,driver_id,vehicle_id,kind,expires_on,storage_path,file_name,content_type,size_bytes,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [
          id,
          dto.driverId ?? null,
          dto.vehicleId ?? null,
          dto.kind,
          dto.expiresAt ?? null,
          path,
          dto.fileName.replace(/[\\/]/g, '_'),
          dto.contentType,
          dto.sizeBytes,
          user.id,
        ],
      );
      const after = await this.documentValue(client, id);
      await this.log(
        client,
        user,
        'upload_requested',
        'document',
        id,
        null,
        after,
      );
      return after;
    });
    const { data, error } = await this.supabase
      .forUser(user.accessToken)
      .storage.from(BUCKET)
      .createSignedUploadUrl(path);
    if (error || !data)
      throw new ServiceUnavailableException(
        'No se pudo preparar la carga del documento. Intenta nuevamente.',
      );
    return {
      document,
      path: data.path,
      token: data.token,
      signedUrl: data.signedUrl,
    };
  }
  async completeUpload(user: AuthenticatedUser, id: string) {
    const pending = await this.run(user, (client) =>
      this.documentRow(client, id),
    );
    const { data, error } = await this.supabase
      .forUser(user.accessToken)
      .storage.from(BUCKET)
      .info(pending.storage_path);
    if (error || !data)
      throw new ConflictException(
        'El archivo todavía no está disponible. Completa la carga y vuelve a intentar.',
      );
    if (
      Number(data.size) !== pending.size_bytes ||
      data.contentType !== pending.content_type
    )
      throw new BadRequestException(
        'El archivo cargado no coincide con el tamaño o formato declarado.',
      );
    return this.run(user, async (client) => {
      const row = await this.documentRow(client, id, true),
        before = await this.documentValue(client, id);
      if (row.upload_state === 'uploaded') return before;
      await client.query(
        "update krow_admin.documents set upload_state='uploaded',updated_at=now() where document_id=$1",
        [id],
      );
      const after = await this.documentValue(client, id);
      await this.log(client, user, 'uploaded', 'document', id, before, after);
      return after;
    });
  }
  async updateDocument(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateAdminDocumentDto,
  ) {
    if (!Object.keys(dto).length)
      throw new BadRequestException('Indica al menos un cambio.');
    return this.run(user, async (client) => {
      const row = await this.documentRow(client, id, true);
      const hasExpiry = Object.hasOwn(dto, 'expiresAt');
      const expiry = hasExpiry ? dto.expiresAt : row.expires_on;
      if (dto.status === 'approved' && row.upload_state !== 'uploaded')
        throw new ConflictException(
          'Completa la carga antes de aprobar el documento.',
        );
      if (dto.status === 'approved' && expiry && expiry < today())
        throw new ConflictException(
          'No se puede aprobar un documento vencido.',
        );
      const before = await this.documentValue(client, id);
      await client.query(
        'update krow_admin.documents set status=coalesce($2,status),expires_on=case when $3 then $4::date else expires_on end,review_notes=coalesce($5,review_notes),reviewed_by=$6,updated_at=now() where document_id=$1',
        [
          id,
          dto.status ?? null,
          hasExpiry,
          expiry ?? null,
          dto.reviewNotes ?? null,
          user.id,
        ],
      );
      const after = await this.documentValue(client, id);
      await this.log(client, user, 'reviewed', 'document', id, before, after);
      return after;
    });
  }
  async download(user: AuthenticatedUser, id: string) {
    const row = await this.run(user, (client) => this.documentRow(client, id));
    if (row.upload_state !== 'uploaded')
      throw new ConflictException('El archivo todavía no ha sido cargado.');
    const { data, error } = await this.supabase
      .forUser(user.accessToken)
      .storage.from(BUCKET)
      .createSignedUrl(row.storage_path, 60, { download: true });
    if (error || !data)
      throw new ServiceUnavailableException(
        'No se pudo abrir el documento. Intenta nuevamente.',
      );
    return { signedUrl: data.signedUrl, expiresIn: 60 };
  }
  private async range(client: PoolClient, dto: AdminRideListDto) {
    const { rows } = await client.query<{ from: Date | null; to: Date | null }>(
      `select
      case when $1::text is null then null when length($1)=10 then ($1::date::timestamp at time zone 'America/Monterrey') else $1::timestamptz end as "from",
      case when $2::text is null then null when length($2)=10 then (($2::date+1)::timestamp at time zone 'America/Monterrey') else $2::timestamptz end as "to"`,
      [dto.from ?? null, dto.to ?? null],
    );
    const { from, to } = rows[0];
    if (from && to && from >= to)
      throw new BadRequestException(
        'La fecha final debe ser posterior a la inicial.',
      );
    return [from, to];
  }
  async rides(user: AuthenticatedUser, dto: AdminRideListDto) {
    return this.run(user, async (client) => {
      const [from, to] = await this.range(client, dto);
      return this.paged(
        client,
        dto,
        RIDE_VALUE,
        RIDE_FROM,
        `($1::text is null or r.ride_id::text ilike $1 or u.full_name ilike $1 or r.origin_address ilike $1 or r.destination_address ilike $1)
      and ($2::uuid is null or r.driver_id=$2) and ($3::text is null or r.status=$3)
      and ($4::timestamptz is null or r.departure_time >=$4) and ($5::timestamptz is null or r.departure_time<$5)`,
        [pattern(dto.q), dto.driverId ?? null, dto.status ?? null, from, to],
        'r.departure_time desc,r.ride_id desc',
      );
    });
  }
  async ride(user: AuthenticatedUser, id: string): Promise<AdminRideDetail> {
    return this.run(user, async (client) => {
      const row = (
        await client.query<JsonRow<AdminRide>>(
          `select ${RIDE_VALUE} as value ${RIDE_FROM} where r.ride_id=$1`,
          [id],
        )
      ).rows[0];
      if (!row) throw new NotFoundException('Viaje no encontrado');
      const route = (
        await client.query<JsonRow<AdminRoute>>(
          `select jsonb_build_object('polyline',r.route_polyline,'distanceMeters',r.route_distance_meters,'durationSeconds',r.route_duration_seconds,'provider',r.route_provider,'version',r.version,
        'stops',coalesce((select jsonb_agg(jsonb_build_object('stopId',s.stop_id,'name',coalesce(t.name,s.address),'address',s.address,'lat',s.lat,'lng',s.lng,'order',s.stop_order,'isActive',s.is_active) order by s.stop_order,s.stop_id) from public.ride_stops s left join public.transport_stops t on t.stop_id=s.transport_stop_id where s.ride_id=r.ride_id and s.route_version=(select max(latest.route_version) from public.ride_stops latest where latest.ride_id=r.ride_id)),'[]'::jsonb)) as value from public.rides r where ride_id=$1`,
          [id],
        )
      ).rows[0].value;
      const passengers = (
        await client.query<JsonRow<AdminPassenger>>(
          `select jsonb_build_object('bookingId',b.booking_id,'userId',b.user_id,'fullName',u.full_name,'email',u.email_address,'seats',b.seats_reserved,'status',b.status,'amountCents',p.amount_cents,
        'cashStatus',coalesce(c.status,case when b.status in('cancelled','rejected','no_show') then 'void' else 'pending' end),
        'pickup',jsonb_build_object('stopId',s.stop_id,'address',s.address,'lat',s.lat,'lng',s.lng),
        'dropoff',jsonb_build_object('stopId',t.stop_id,'address',t.address,'lat',t.lat,'lng',t.lng)) as value
        from public.bookings b join public.users u on u.uuid=b.user_id join public.ride_stops s on s.stop_id=b.pickup_stop_id join public.ride_stops t on t.stop_id=b.dropoff_stop_id
        left join krow_pilot.booking_prices p using(booking_id) left join krow_pilot.cash c using(booking_id) where b.ride_id=$1 order by s.stop_order,b.created_at,b.booking_id`,
          [id],
        )
      ).rows.map((r) => r.value);
      const history = (
        await client.query<JsonRow<AdminRideHistory>>(
          `select jsonb_build_object('status',status,'previousStatus',previous_status,'changedAt',changed_at,'reason',reason) as value from public.ride_status_history where ride_id=$1 order by changed_at,id`,
          [id],
        )
      ).rows.map((r) => r.value);
      const started = history.find((h) => h.status === 'in_progress'),
        ended = [...history]
          .reverse()
          .find((h) => ['completed', 'cancelled'].includes(h.status));
      return {
        ...row.value,
        route,
        passengers,
        history,
        startedAt: started?.changedAt ?? null,
        endedAt: ended?.changedAt ?? null,
      };
    });
  }
  async audit(user: AuthenticatedUser, dto: AdminAuditListDto) {
    return this.run(user, (client) =>
      this.paged(
        client,
        dto,
        "jsonb_build_object('auditId',a.audit_id,'actorId',a.actor_id,'actorName',u.full_name,'action',a.action,'entityType',a.entity_type,'entityId',a.entity_id,'changes',a.changes,'createdAt',a.created_at)",
        'from krow_admin.audit_log a left join public.users u on u.uuid=a.actor_id',
        '($1::text is null or a.entity_type=$1) and ($2::uuid is null or a.entity_id=$2) and ($3::text is null or a.action ilike $3 or u.full_name ilike $3)',
        [dto.entityType ?? null, dto.entityId ?? null, pattern(dto.q)],
        'a.created_at desc,a.audit_id desc',
      ),
    );
  }
}
