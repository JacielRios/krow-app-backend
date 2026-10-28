import { IsDateString, IsIn, IsOptional, Matches } from 'class-validator';

export const RIDE_STATUSES = [
  'scheduled',
  'full',
  'in_progress',
  'completed',
  'cancelled',
] as const;

// Filtros del historial de viajes del conductor. Nunca incluye un id de
// conductor: el conductor sale siempre del token verificado.
export class DriverRidesQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  from!: string; // formato YYYY-MM-DD

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  to!: string;

  @IsOptional()
  @IsIn(RIDE_STATUSES)
  status?: (typeof RIDE_STATUSES)[number];

  @IsOptional()
  @Matches(/^[1-9]\d{0,5}$/)
  page?: string;

  @IsOptional()
  @Matches(/^([1-9]|[1-4]\d|50)$/)
  pageSize?: string; // de 1 a 50
}
