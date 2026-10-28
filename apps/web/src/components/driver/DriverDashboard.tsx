'use client';
import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useDriverResource } from '@/lib/driver-api';
import { formatDate, queryString } from '@/lib/admin-utils';
import {
  driverInsights,
  money,
  number,
  percent,
  periodRange,
  type DriverDashboardData,
  type PeriodKey,
} from './driver-data';
import { RangeTabs } from './RangeTabs';
import { TripsBars } from './TripsBars';

function MetricCard({
  tone,
  label,
  value,
  hint,
  progress,
}: {
  tone: 'trips' | 'alert' | 'riders' | 'money';
  label: string;
  value: string;
  hint?: ReactNode;
  progress?: number;
}) {
  return (
    <article className={`drv-card drv-tone-${tone}`}>
      <p className="drv-card-label">{label}</p>
      <p className="drv-card-value">{value}</p>
      {progress !== undefined && (
        <div className="drv-progress" aria-hidden="true">
          <span style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
        </div>
      )}
      {hint && <p className="drv-card-hint">{hint}</p>}
    </article>
  );
}

export default function DriverDashboard() {
  const [period, setPeriod] = useState<PeriodKey>('month');
  const range = useMemo(() => periodRange(period), [period]);
  const { data, loading, error, reload } = useDriverResource<DriverDashboardData>(
    `/drivers/me/dashboard-summary?${queryString(range)}`,
  );
  const cancelRate = data ? percent(data.cancelled, data.totalTrips) : 0;

  return (
    <div className="drv-page" aria-busy={loading}>
      <header className="drv-top">
        <div>
          <p className="drv-eyebrow">Mi actividad</p>
          <h1>Mi panel de conductor</h1>
          <p className="drv-sub">
            Del {formatDate(range.from)} al {formatDate(range.to)} · hora de
            Monterrey · MXN
          </p>
        </div>
        <RangeTabs value={period} onChange={setPeriod} />
      </header>

      <div className="drv-toolbar">
        <p className="drv-sub">
          Indicadores de tus viajes con salida dentro del periodo seleccionado.
        </p>
        <button
          type="button"
          className="drv-button"
          onClick={reload}
          disabled={loading}
        >
          Actualizar
        </button>
      </div>

      {loading && (
        <p role="status">
          {data ? 'Actualizando indicadores…' : 'Cargando indicadores…'}
        </p>
      )}
      {error && (
        <div className="drv-error" role="alert">
          <p>{error}</p>
          {data && (
            <p>
              Se conservan los últimos datos consultados. Pueden estar
              desactualizados.
            </p>
          )}
          <button type="button" className="drv-button" onClick={reload}>
            Reintentar
          </button>
        </div>
      )}

      {data && (
        <>
          <section className="drv-insights" aria-label="Lectura rápida">
            <h2>Lo más importante del periodo</h2>
            <ul>
              {driverInsights(data).map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </section>

          <section>
            <h2>Viajes</h2>
            <div className="drv-grid">
              <MetricCard
                tone="trips"
                label="Realizados"
                value={number(data.completed)}
              />
              <MetricCard
                tone="alert"
                label="Cancelados"
                value={number(data.cancelled)}
                hint={`${cancelRate.toFixed(1)}% de tus viajes del periodo`}
              />
              <MetricCard
                tone="trips"
                label="En curso"
                value={number(data.ongoing)}
                hint="Con salida dentro del periodo"
              />
              <MetricCard
                tone="trips"
                label="Programados"
                value={number(data.scheduled)}
              />
              <MetricCard
                tone="riders"
                label="Pasajeros transportados"
                value={number(data.passengers)}
                hint="Asientos de reservas abordadas o completadas"
              />
              <MetricCard
                tone="riders"
                label="Ocupación promedio"
                value={`${data.occupancy.toFixed(1)}%`}
                progress={data.occupancy}
                hint="Asientos reservados / ofrecidos; excluye viajes cancelados"
              />
            </div>
            {data.totalTrips > 0 ? (
              <div className="drv-panel">
                <h3>Viajes por día</h3>
                <TripsBars data={data.trend} />
              </div>
            ) : (
              <p className="drv-empty">No hay viajes en este periodo.</p>
            )}
          </section>

          <section>
            <h2>Importes y efectivo</h2>
            <p className="drv-sub">
              El importe comprometido es el precio acordado de las reservas de
              tus viajes. El efectivo recibido es el que tú registraste.
            </p>
            <div className="drv-grid drv-grid-3">
              <MetricCard
                tone="money"
                label="Importe comprometido"
                value={money(data.revenue)}
                hint="Precio acordado de las reservas vigentes"
              />
              <MetricCard
                tone="money"
                label="Efectivo recibido"
                value={data.paid === null ? 'Sin registro' : money(data.paid)}
                hint="Recepción que registraste"
              />
              <MetricCard
                tone="alert"
                label="Efectivo pendiente"
                value={
                  data.pending === null ? 'Sin registro' : money(data.pending)
                }
              />
            </div>
          </section>

          <section>
            <h2>Rutas con más actividad</h2>
            <div className="drv-panel">
              {data.topRoutes.length ? (
                <div className="drv-table-wrap">
                  <table className="drv-table">
                    <thead>
                      <tr>
                        <th>Ruta</th>
                        <th>Viajes</th>
                        <th>Ocupación</th>
                        <th>Importe</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topRoutes.map((row) => (
                        <tr key={row.route}>
                          <td>{row.route}</td>
                          <td>{number(row.trips)}</td>
                          <td>{row.occupancy.toFixed(1)}%</td>
                          <td>{money(row.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="drv-empty">
                  No hay rutas con actividad en este periodo.
                </p>
              )}
            </div>
          </section>

          <p>
            <Link className="drv-link" href="/driver/viajes">
              Ver historial de viajes realizados
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
