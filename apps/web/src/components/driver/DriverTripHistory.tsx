'use client';
import { useMemo, useState } from 'react';
import { useDriverResource, type DriverPage } from '@/lib/driver-api';
import { formatDate, queryString } from '@/lib/admin-utils';
import {
  money,
  number,
  periodRange,
  type DriverRide,
  type PeriodKey,
} from './driver-data';
import { RangeTabs } from './RangeTabs';

const PAGE_SIZE = 10;

export default function DriverTripHistory() {
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [page, setPage] = useState(1);
  const range = useMemo(() => periodRange(period), [period]);
  const { data, loading, error, reload } = useDriverResource<
    DriverPage<DriverRide>
  >(
    `/drivers/me/rides?${queryString({
      status: 'completed',
      ...range,
      page,
      pageSize: PAGE_SIZE,
    })}`,
  );
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="drv-page" aria-busy={loading}>
      <header className="drv-top">
        <div>
          <p className="drv-eyebrow">Mi actividad</p>
          <h1>Historial de viajes</h1>
          <p className="drv-sub">
            Viajes realizados del {formatDate(range.from)} al{' '}
            {formatDate(range.to)}
          </p>
        </div>
        <RangeTabs
          value={period}
          onChange={(next) => {
            setPeriod(next);
            setPage(1);
          }}
        />
      </header>

      {loading && (
        <p role="status">
          {data ? 'Actualizando historial…' : 'Cargando historial…'}
        </p>
      )}
      {error && (
        <div className="drv-error" role="alert">
          <p>{error}</p>
          <button type="button" className="drv-button" onClick={reload}>
            Reintentar
          </button>
        </div>
      )}

      {data && (
        <section className="drv-panel">
          <h2>
            {number(data.total)}{' '}
            {data.total === 1 ? 'viaje realizado' : 'viajes realizados'}
          </h2>
          {data.items.length ? (
            <div className="drv-table-wrap">
              <table className="drv-table">
                <thead>
                  <tr>
                    <th>Fecha de salida</th>
                    <th>Ruta</th>
                    <th>Pasajeros</th>
                    <th>Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((ride) => (
                    <tr key={ride.rideId}>
                      <td>{formatDate(ride.departureTime, true)}</td>
                      <td>
                        {ride.originAddress ?? 'Origen sin registrar'} →{' '}
                        {ride.destinationAddress ?? 'Destino sin registrar'}
                      </td>
                      <td>{number(ride.passengers)}</td>
                      <td>{money(ride.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="drv-empty">
              No hay viajes realizados en este periodo.
            </p>
          )}
          <nav className="drv-pagination" aria-label="Paginación">
            <button
              type="button"
              className="drv-button"
              disabled={loading || page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Anterior
            </button>
            <span>
              Página {page} de {pages}
            </span>
            <button
              type="button"
              className="drv-button"
              disabled={loading || page >= pages}
              onClick={() => setPage(page + 1)}
            >
              Siguiente
            </button>
          </nav>
        </section>
      )}
    </div>
  );
}
