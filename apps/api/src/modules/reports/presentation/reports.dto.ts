import { IsDateString, Matches } from 'class-validator';

// Lo que el dashboard manda: el rango de fechas elegido en el filtro.
export class DashboardSummaryQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  from!: string; // formato YYYY-MM-DD

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  to!: string;
}
