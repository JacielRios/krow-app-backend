import { formatDate } from '@/lib/admin-utils';
import type { DriverDashboardData } from './driver-data';

export function TripsBars({ data }: { data: DriverDashboardData['trend'] }) {
  if (!data.length) return null;
  const max = Math.max(1, ...data.map((d) => d.completed + d.cancelled));
  const completed = data.reduce((sum, d) => sum + d.completed, 0);
  const cancelled = data.reduce((sum, d) => sum + d.cancelled, 0);
  return (
    <div>
      <div
        className="drv-bars"
        role="img"
        aria-label={`Viajes por día: ${completed} realizados y ${cancelled} cancelados`}
      >
        {data.map((day) => (
          <div
            key={day.date}
            className="drv-bar"
            title={`${formatDate(day.date)}: ${day.completed} realizados, ${day.cancelled} cancelados`}
          >
            <span
              className="cancelled"
              style={{ height: `${(day.cancelled / max) * 100}%` }}
            />
            <span
              className="done"
              style={{ height: `${(day.completed / max) * 100}%` }}
            />
          </div>
        ))}
      </div>
      <div className="drv-bars-axis">
        <span>{formatDate(data[0].date)}</span>
        <span>{formatDate(data[data.length - 1].date)}</span>
      </div>
      <p className="drv-legend">
        <span className="dot done" /> Realizados{' '}
        <span className="dot cancelled" /> Cancelados
      </p>
    </div>
  );
}
