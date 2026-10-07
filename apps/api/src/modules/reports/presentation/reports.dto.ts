import { IsDateString } from 'class-validator';

// Lo que el dashboard manda: el rango de fechas elegido en el filtro.
export class DashboardSummaryQueryDto {
  @IsDateString()
  from!: string; // formato YYYY-MM-DD

  @IsDateString()
  to!: string;
}
