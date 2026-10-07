import {
  Controller,
  Get,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PilotDatabase } from './modules/pilot/pilot.database.js';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class AppController {
  constructor(@Optional() private readonly pilot?: PilotDatabase) {}
  @Get('ready')
  async ready() {
    if (!this.pilot?.enabled) return { status: 'ok', pilot: 'disabled' };
    try {
      const [r] = await this.pilot.query<{ ready: boolean }>(
        `select to_regclass('krow_pilot.tracking_sessions') is not null and to_regclass('krow_pilot.outbox') is not null and to_regclass('krow_pilot.account_closure_requests') is not null
        and has_column_privilege(current_user,'public.rides','status','UPDATE')
        and has_function_privilege(current_user,'public.request_booking_v2(jsonb)','EXECUTE')
        and has_table_privilege(current_user,'public.users','SELECT')
        and not exists(select 1 from (values ('uuid'),('email_address'),('full_name'),('institutional_id'),('academic_program'),('academic_period')) c(name) where not has_column_privilege(current_user,'public.users',c.name,'INSERT'))
        and not exists(select 1 from (values ('email_address'),('full_name'),('institutional_id'),('academic_program'),('academic_period')) c(name) where not has_column_privilege(current_user,'public.users',c.name,'UPDATE'))
        and (pg_get_serial_sequence('public.users','id') is null or has_sequence_privilege(current_user,pg_get_serial_sequence('public.users','id'),'USAGE'))
        and exists(select 1 from pg_roles where rolname=current_user and not rolsuper and not rolbypassrls) as ready`,
      );
      if (!r?.ready) throw new Error('Pilot schema or role missing');
      return { status: 'ok', pilot: 'ready' };
    } catch {
      throw new ServiceUnavailableException(
        'El piloto no está listo para recibir viajes',
      );
    }
  }
  @Get()
  @ApiOperation({ summary: 'Comprueba que la API está disponible' })
  health() {
    return {
      status: 'ok',
      service: 'krow-api',
      timestamp: new Date().toISOString(),
    };
  }
}
