'use client';
import { useMemo, useState } from 'react';
import { useDriverResource } from '@/lib/driver-auth';
import { formatDate, queryString } from '@/lib/admin-utils';
import {
  currentWeekStart,
  methodLabel,
  money,
  number,
  shiftWeek,
  weekEnd,
  type DriverWeeklyReport,
  MetricCard,
} from '@/components/driver/driver-kit';

export default function DriverFinance() {
  const thisWeek = useMemo(() => currentWeekStart(), []);
  const [weekStart, setWeekStart] = useState(thisWeek);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const { data, loading, error, reload } =
    useDriverResource<DriverWeeklyReport>(
      `/drivers/me/weekly-report?${queryString({ weekStart })}`,
    );
  // Nunca se muestra (ni se descarga) el reporte de otra semana.
  const report = data && data.weekStart === weekStart ? data : null;
  const isCurrent = weekStart === thisWeek;
  const from = formatDate(weekStart);
  const to = formatDate(weekEnd(weekStart));

  async function download() {
    if (!report || pdfBusy) return;
    setPdfBusy(true);
    setPdfError(null);
    try {
      const { downloadWeeklyReportPdf } = await import('@/components/driver/driver-report-pdf');
      downloadWeeklyReportPdf(report);
    } catch {
      setPdfError('No pudimos generar el PDF. Intenta de nuevo.');
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <div className="drv-page" aria-busy={loading}>
      <header className="drv-top">
        <div>
          <p className="drv-eyebrow">Mis ganancias</p>
          <h1>Finanzas</h1>
          <p className="drv-sub">
            Reporte semanal de tus viajes realizados · hora de Monterrey · MXN
          </p>
        </div>
        <button
          type="button"
          className="drv-button drv-button-primary"
          disabled={!report || loading || pdfBusy}
          onClick={() => void download()}
        >
          {pdfBusy ? 'Generando PDF…' : 'Descargar reporte PDF'}
        </button>
      </header>

      <div className="drv-toolbar">
        <div className="drv-week" role="group" aria-label="Semana">
          <button
            type="button"
            className="drv-button"
            onClick={() => setWeekStart(shiftWeek(weekStart, -1))}
          >
            Semana anterior
          </button>
          <span className="drv-week-label">
            Del {from} al {to}
            {isCurrent && ' (semana en curso)'}
          </span>
          <button
            type="button"
            className="drv-button"
            disabled={isCurrent}
            onClick={() => setWeekStart(shiftWeek(weekStart, 1))}
          >
            Semana siguiente
          </button>
          {!isCurrent && (
            <button
              type="button"
              className="drv-button"
              onClick={() => setWeekStart(thisWeek)}
            >
              Ir a la semana actual
            </button>
          )}
        </div>
      </div>

      {loading && (
        <p role="status">
          {report ? 'Actualizando reporte…' : 'Cargando reporte…'}
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
      {pdfError && (
        <div className="drv-error" role="alert">
          <p>{pdfError}</p>
        </div>
      )}

      {report && (
        <>
          <section className="drv-insights" aria-label="Resumen de la semana">
            <p className="drv-headline">
              En la semana del {from} al {to} ganaste{' '}
              <strong>{money(report.totals.net)}</strong>.
            </p>
            <p className="drv-sub">
              Recibes {money(report.payPerPassenger)} por cada pasajero
              transportado, sea que pague en efectivo o con tarjeta. El resto
              del pago del pasajero cubre el servicio de KROW.
            </p>
          </section>

          <section>
            <h2>Resumen</h2>
            <div className="drv-grid">
              <MetricCard
                tone="trips"
                label="Viajes realizados"
                value={number(report.totals.trips)}
              />
              <MetricCard
                tone="riders"
                label="Pasajeros transportados"
                value={number(report.totals.passengers)}
              />
              <MetricCard
                tone="money"
                label="Cobrado a pasajeros"
                value={money(report.totals.gross)}
              />
              <MetricCard
                tone="alert"
                label="Cargo por servicio"
                value={money(report.totals.retained)}
              />
              <MetricCard
                tone="money"
                label="Tu ganancia"
                value={money(report.totals.net)}
                hint={`${money(report.payPerPassenger)} por pasajero transportado`}
              />
            </div>
          </section>

          <section>
            <h2>Por forma de pago</h2>
            <div className="drv-panel">
              <div className="drv-table-wrap">
                <table className="drv-table">
                  <thead>
                    <tr>
                      <th>Forma de pago</th>
                      <th className="drv-num">Pagos</th>
                      <th className="drv-num">Pasajeros</th>
                      <th className="drv-num">Cobrado</th>
                      <th className="drv-num">Cargo</th>
                      <th className="drv-num">Ganancia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byMethod.map((row) => (
                      <tr key={row.method}>
                        <td>{methodLabel(row.method)}</td>
                        <td className="drv-num">{number(row.payments)}</td>
                        <td className="drv-num">{number(row.passengers)}</td>
                        <td className="drv-num">{money(row.gross)}</td>
                        <td className="drv-num">{money(row.retained)}</td>
                        <td className="drv-num">{money(row.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section>
            <h2>Viajes de la semana</h2>
            <div className="drv-panel">
              {report.trips.length ? (
                <div className="drv-table-wrap">
                  <table className="drv-table">
                    <thead>
                      <tr>
                        <th>Fecha de salida</th>
                        <th>Ruta</th>
                        <th className="drv-num">Pasajeros</th>
                        <th className="drv-num">Cobrado</th>
                        <th className="drv-num">Cargo</th>
                        <th className="drv-num">Ganancia</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.trips.map((trip) => (
                        <tr key={trip.rideId}>
                          <td>{formatDate(trip.departureTime, true)}</td>
                          <td>
                            {trip.originAddress ?? 'Origen sin registrar'} →{' '}
                            {trip.destinationAddress ?? 'Destino sin registrar'}
                          </td>
                          <td className="drv-num">{number(trip.passengers)}</td>
                          <td className="drv-num">{money(trip.gross)}</td>
                          <td className="drv-num">{money(trip.retained)}</td>
                          <td className="drv-num">{money(trip.net)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="drv-empty">
                  No hubo viajes realizados en esta semana.
                </p>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
