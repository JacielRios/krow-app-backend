import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PilotDatabase } from '../pilot/pilot.database.js';
import { adminTransaction } from './admin.database.js';
import type { AuthenticatedUser } from '../auth/domain/authenticated-user.js';

export interface RideHealth {
  rideId: string;
  driverName: string | null;
  destination: string | null;
  capturedAt: string | null;
  sessionExpiresAt: Date | null;
  ageSeconds: number | null;
}
export interface IncidentRow {
  incidentId: string;
  rideId: string;
  kind: string;
  details: string;
  status: string;
  resolution: string | null;
  createdAt: Date;
  updatedAt: Date;
  reporterName: string | null;
}

@Injectable()
export class AdminOperations {
  constructor(private readonly db: PilotDatabase) {}
  overview(user: AuthenticatedUser) {
    return adminTransaction(this.db, user, async (client) => {
      const rides =
        await client.query<RideHealth>(`select r.ride_id as "rideId",u.full_name as "driverName",r.destination_address as destination,
        s.position->>'capturedAt' as "capturedAt",s.expires_at as "sessionExpiresAt",
        case when s.position is not null then greatest(0,extract(epoch from now()-(s.position->>'capturedAt')::timestamptz))::int end as "ageSeconds"
        from public.rides r join public.driver_profiles d using(driver_id) join public.users u on u.uuid=d.user_id
        left join krow_pilot.tracking_sessions s on s.ride_id=r.ride_id and s.expires_at>now()
        where r.status='in_progress' order by r.departure_time limit 100`);
      const delivery = await client.query<{ status: string; total: number }>(
        `select status,count(*)::int total from krow_pilot.outbox group by status order by status`,
      );
      const incidents = await client.query<{ total: number }>(
        "select count(*)::int total from krow_pilot.incidents where status<>'resolved'",
      );
      return {
        rides: rides.rows,
        notifications: delivery.rows,
        openIncidents: incidents.rows[0].total,
        observedAt: new Date().toISOString(),
      };
    });
  }
  incidents(user: AuthenticatedUser, status?: string) {
    return adminTransaction(
      this.db,
      user,
      async (client) =>
        (
          await client.query<IncidentRow>(
            `select i.incident_id as "incidentId",i.ride_id as "rideId",i.kind,i.details,i.status,i.resolution,i.created_at as "createdAt",i.updated_at as "updatedAt",u.full_name as "reporterName"
      from krow_pilot.incidents i join public.users u on u.uuid=i.actor_id where ($1::text is null or i.status=$1) order by i.created_at desc,i.incident_id limit 100`,
            [status || null],
          )
        ).rows,
    );
  }
  update(
    user: AuthenticatedUser,
    id: string,
    status: string,
    resolution: string,
  ) {
    return adminTransaction(this.db, user, async (client) => {
      const result = await client.query<{
        status: string;
        resolution: string | null;
      }>(
        'select status,resolution from krow_pilot.incidents where incident_id=$1 for update',
        [id],
      );
      const previous = result.rows[0];
      if (!previous) throw new NotFoundException('Reporte no encontrado');
      if (previous.status === status) return { success: true };
      if (previous.status === 'resolved')
        throw new ConflictException('El reporte ya fue resuelto');
      if (status === 'resolved' && !resolution.trim())
        throw new ConflictException('Describe cómo se resolvió el reporte');
      await client.query(
        'update krow_pilot.incidents set status=$2,resolution=$3,handled_by=$4,updated_at=now() where incident_id=$1',
        [id, status, resolution.trim() || null, user.id],
      );
      await client.query(
        "insert into krow_admin.audit_log(actor_id,action,entity_type,entity_id,changes) values($1,$2,'incident',$3,$4::jsonb)",
        [
          user.id,
          status,
          id,
          JSON.stringify({
            before: previous,
            after: { status, resolution: resolution.trim() },
          }),
        ],
      );
      return { success: true };
    });
  }
}
