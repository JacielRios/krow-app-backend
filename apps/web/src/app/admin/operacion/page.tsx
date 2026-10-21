'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AdminHeader, Feedback, ListState } from '@/components/admin/AdminUi';
import { useAdminApi, useAdminResource } from '@/lib/admin-api';
import { formatDate, readableError } from '@/lib/admin-utils';
interface Overview {
  rides: {
    rideId: string;
    driverName: string;
    destination: string;
    ageSeconds: number | null;
  }[];
  notifications: { status: string; total: number }[];
  openIncidents: number;
  observedAt: string;
}
interface Incident {
  incidentId: string;
  rideId: string;
  reporterName: string;
  kind: string;
  details: string;
  status: string;
  resolution: string | null;
  createdAt: string;
}
export default function OperationsPage() {
  const overview = useAdminResource<Overview>('/admin/operations');
  const [status, setStatus] = useState('open');
  const incidents = useAdminResource<Incident[]>(
    `/admin/operations/incidents${status ? `?status=${status}` : ''}`,
  );
  const request = useAdminApi();
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const refreshOverview = overview.reload;
  const refreshIncidents = incidents.reload;
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        refreshOverview();
        refreshIncidents();
      }
    }, 15000);
    return () => clearInterval(timer);
  }, [refreshOverview, refreshIncidents]);
  async function handle(id: string, next: string, resolution: string) {
    if (busy) return;
    setBusy(id);
    setFeedback('');
    try {
      await request(`/admin/operations/incidents/${id}`, {
        method: 'PATCH',
        body: { status: next, resolution },
      });
      incidents.reload();
      overview.reload();
    } catch (e) {
      setFeedback(readableError(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <AdminHeader
        title="Operación"
        description="Señal GPS, entrega de avisos y reportes que requieren atención del equipo."
        action={
          <button
            className="button secondary"
            onClick={() => {
              overview.reload();
              incidents.reload();
            }}
          >
            Actualizar
          </button>
        }
      />
      <Feedback error={feedback} />
      <section className="card">
        <h2>Viajes en curso</h2>
        <ListState {...overview} empty={!overview.data?.rides.length}>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Conductor</th>
                  <th>Destino</th>
                  <th>Señal GPS</th>
                  <th>Viaje</th>
                </tr>
              </thead>
              <tbody>
                {overview.data?.rides.map((ride) => (
                  <tr key={ride.rideId}>
                    <td>{ride.driverName}</td>
                    <td>{ride.destination}</td>
                    <td>
                      {ride.ageSeconds == null
                        ? 'Sin señal'
                        : ride.ageSeconds <= 10
                          ? 'Reciente'
                          : `${ride.ageSeconds} s · ${ride.ageSeconds > 30 ? 'desactualizada' : 'demorada'}`}
                    </td>
                    <td>
                      <Link href={`/admin/viajes/${ride.rideId}`}>
                        Ver detalle
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ListState>
        <p>
          Avisos:{' '}
          {overview.data?.notifications
            .map((n) => `${n.status}: ${n.total}`)
            .join(' · ') || 'Sin eventos'}
        </p>
      </section>
      <section className="card">
        <h2>Reportes</h2>
        <div className="field">
          <label htmlFor="incident-status">Estado</label>
          <select
            id="incident-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="open">Nuevos</option>
            <option value="acknowledged">En atención</option>
            <option value="resolved">Resueltos</option>
            <option value="">Todos</option>
          </select>
        </div>
        <ListState {...incidents} empty={!incidents.data?.length}>
          {incidents.data?.map((incident) => (
            <article className="card" key={incident.incidentId}>
              <h3>
                {incident.kind} · {incident.reporterName}
              </h3>
              <p>
                {formatDate(incident.createdAt)} · {incident.status}
              </p>
              <p style={{ whiteSpace: 'pre-wrap' }}>{incident.details}</p>
              <Link href={`/admin/viajes/${incident.rideId}`}>
                Consultar viaje
              </Link>
              {incident.status === 'resolved' ? (
                <p>Resolución: {incident.resolution}</p>
              ) : (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handle(
                      incident.incidentId,
                      'resolved',
                      String(
                        new FormData(event.currentTarget).get('resolution') ??
                          '',
                      ),
                    );
                  }}
                >
                  <div className="field">
                    <label htmlFor={`resolution-${incident.incidentId}`}>
                      Resolución
                    </label>
                    <textarea
                      id={`resolution-${incident.incidentId}`}
                      name="resolution"
                      required
                      maxLength={2000}
                    />
                  </div>
                  <div className="actions">
                    {incident.status === 'open' && (
                      <button
                        className="button secondary"
                        type="button"
                        disabled={!!busy}
                        onClick={() =>
                          void handle(incident.incidentId, 'acknowledged', '')
                        }
                      >
                        Tomar reporte
                      </button>
                    )}
                    <button className="button" type="submit" disabled={!!busy}>
                      Resolver
                    </button>
                  </div>
                </form>
              )}
            </article>
          ))}
        </ListState>
      </section>
    </>
  );
}
