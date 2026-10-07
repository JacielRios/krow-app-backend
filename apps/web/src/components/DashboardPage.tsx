'use client';
import { useState } from 'react';
import { MetricCard } from './MetricCard';
import { DateRangeFilter, rangeFromDays } from './DateRangeFilter';
import { RevenueChart, TripsTrendChart } from './Charts';
import { TopRoutesTable } from './TopRoutesTable';
import { dashboardInsights, money, number, percent } from './dashboard-data';
import { useDashboardData } from './useDashboardData';
import './dashboard.css';

export default function DashboardPage() {
  const [range, setRange] = useState(() => rangeFromDays(30));
  const { data, loading, error, reload } = useDashboardData(range);
  const cancelRate = data ? percent(data.cancelled, data.totalTrips) : 0;
  const registeredDrivers = data
    ? data.activeDrivers + data.inactiveDrivers
    : 0;

  return (
    <div className="dashboard" aria-busy={loading}>
      <header className="top">
        <div>
          <p className="eyebrow">Operación</p>
          <h1>Panel de operación</h1>
          <p className="sub">
            Del {range.from} al {range.to} · hora de Monterrey · MXN
          </p>
        </div>
        <DateRangeFilter value={range} onChange={setRange} />
      </header>
      <div className="dashboard-toolbar">
        <p className="sub">
          Indicadores de los viajes con salida dentro del periodo seleccionado.
        </p>
        <button
          type="button"
          className="dashboard-retry"
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
        <div className="dashboard-error" role="alert">
          <p>{error}</p>
          {data && (
            <p>
              Se conservan los últimos datos consultados. Pueden estar
              desactualizados.
            </p>
          )}
          <button type="button" onClick={reload}>
            Reintentar
          </button>
        </div>
      )}
      {!data && loading && (
        <div className="dashboard-skeleton" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} />
          ))}
        </div>
      )}
      {data && (
        <>
          <section className="insights" aria-label="Lectura rápida">
            <h2>Lo más importante del periodo</h2>
            <ul>
              {dashboardInsights(data).map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </section>
          <section id="viajes">
            <h2>Viajes</h2>
            <div className="grid">
              <MetricCard
                tone="trips"
                label="Realizados"
                value={number(data.completed)}
              />
              <MetricCard
                tone="alert"
                label="Cancelados"
                value={number(data.cancelled)}
                hint={`${cancelRate.toFixed(1)}% de los viajes del periodo`}
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
            {data.totalTrips > 0 && (
              <div className="panel">
                <h3>Viajes por día</h3>
                <TripsTrendChart data={data.trend} />
              </div>
            )}
          </section>
          <section id="conductores">
            <h2>Conductores</h2>
            <div className="grid">
              <MetricCard
                tone="drivers"
                label="Activos"
                value={number(data.activeDrivers)}
                progress={percent(data.activeDrivers, registeredDrivers)}
                hint="Estado actual del catálogo; no depende de las fechas"
              />
              <MetricCard
                tone="drivers"
                label="Inactivos"
                value={number(data.inactiveDrivers)}
                hint="Incluye pendientes, rechazados y suspendidos"
              />
            </div>
          </section>
          <section id="finanzas">
            <h2>Importes y efectivo</h2>
            <p className="sub">
              Los importes comprometidos pertenecen a las reservas. No
              representan ingresos netos de KROW ni pagos electrónicos.
            </p>
            <div className="grid">
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
                hint="Recepción registrada por el conductor"
              />
              <MetricCard
                tone="alert"
                label="Efectivo pendiente"
                value={
                  data.pending === null ? 'Sin registro' : money(data.pending)
                }
              />
            </div>
            {data.totalTrips > 0 && (
              <div className="panel">
                <h3>Importes comprometidos por día</h3>
                <RevenueChart data={data.trend} />
              </div>
            )}
          </section>
          <section id="rutas">
            <h2>Rutas con más actividad</h2>
            <div className="panel">
              <TopRoutesTable rows={data.topRoutes} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
