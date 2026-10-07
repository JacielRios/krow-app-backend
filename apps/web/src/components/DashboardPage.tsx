"use client";
import { useMemo, useState } from "react";
import { MetricCard } from "./MetricCard";
import { DateRangeFilter, rangeFromDays } from "./DateRangeFilter";
import { RevenueChart, TripsTrendChart } from "./Charts";
import { TopRoutesTable } from "./TopRoutesTable";
import { getMockData } from "./mockData";
import "./dashboard.css";

const n = (v: number) => v.toLocaleString("es-MX");
const money = (v: number) => `$${v.toLocaleString("es-MX")}`;
const NAV = [["resumen", "Resumen"], ["viajes", "Viajes"], ["conductores", "Conductores"], ["finanzas", "Finanzas"], ["rutas", "Rutas"]];

export default function DashboardPage() {
  const [range, setRange] = useState(() => rangeFromDays(30));
  // TODO: sustituir por datos reales (api-client) con estados de carga y error.
 /*const { data: d, loading, error } = useDashboardData(range, getAccessToken);

    if (loading && !d) return <p>Cargando...</p>;
    if (error) return <p>Error al cargar el dashboard: {error}</p>;
    if (!d) return null;*/
const d = getMockData(range);

  const cancelRate = (d.cancelled / (d.completed + d.cancelled)) * 100;
  const top = d.topRoutes[0];
  const insights = [
    cancelRate > 8
      ? `Las cancelaciones están en ${cancelRate.toFixed(1)}%. Revisa los horarios con más cancelaciones.`
      : `Las cancelaciones están controladas (${cancelRate.toFixed(1)}%).`,
    `${top.route} concentra ${Math.round((top.trips / d.completed) * 100)}% de los viajes realizados.`,
    `Hay ${money(d.pending)} en pagos pendientes (${Math.round((d.pending / d.revenue) * 100)}% de los ingresos).`,
  ];

  return (
    <div className="shell">
      <aside className="side">
        <p className="brand">KROW</p>
        <nav aria-label="Secciones">
          {NAV.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
        </nav>
        <button type="button" className="ghost">Cerrar sesión</button>
      </aside>

      <main className="main">
        <header id="resumen" className="top">
          <div>
            <h1>Panel de operación</h1>
            <p className="sub">Del {range.from} al {range.to}</p>
          </div>
          <DateRangeFilter value={range} onChange={setRange} />
        </header>

        <section className="insights" aria-label="Lectura rápida">
          <h2>Lo más importante del periodo</h2>
          <ul>{insights.map((t) => <li key={t}>{t}</li>)}</ul>
        </section>

        <section id="viajes">
          <h2>Viajes</h2>
          <div className="grid">
            <MetricCard tone="trips" label="Realizados" value={n(d.completed)} />
            <MetricCard tone="alert" label="Cancelados" value={n(d.cancelled)} hint={`${cancelRate.toFixed(1)}% del total`} />
            <MetricCard tone="trips" label="En curso ahora" value={n(d.ongoing)} />
            <MetricCard tone="riders" label="Pasajeros transportados" value={n(d.passengers)} />
            <MetricCard tone="riders" label="Ocupación promedio" value={`${d.occupancy}%`} progress={d.occupancy} hint="Asientos usados vs. ofrecidos" />
          </div>
          <div className="panel">
            <h3>Viajes por día</h3>
            <TripsTrendChart data={d.trend} />
          </div>
        </section>

        <section id="conductores">
          <h2>Conductores</h2>
          <div className="grid">
            <MetricCard tone="drivers" label="Activos" value={n(d.activeDrivers)}
              progress={Math.round((d.activeDrivers / (d.activeDrivers + d.inactiveDrivers)) * 100)} hint="Del total registrado" />
            <MetricCard tone="drivers" label="Inactivos" value={n(d.inactiveDrivers)} />
          </div>
        </section>

        <section id="finanzas">
          <h2>Finanzas</h2>
          <div className="grid">
            <MetricCard tone="money" label="Ingresos" value={money(d.revenue)} />
            <MetricCard tone="money" label="Pagos confirmados" value={money(d.paid)} />
            <MetricCard tone="alert" label="Pagos pendientes" value={money(d.pending)} />
          </div>
          <div className="panel">
            <h3>Ingresos por día</h3>
            <RevenueChart data={d.trend} />
          </div>
        </section>

        <section id="rutas">
          <h2>Rutas con más actividad</h2>
          <div className="panel"><TopRoutesTable rows={d.topRoutes} /></div>
        </section>
      </main>
    </div>
  );
}
