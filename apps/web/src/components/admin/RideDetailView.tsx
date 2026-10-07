'use client';
import Link from 'next/link';
import { AdminHeader, ListState, StatusBadge } from './AdminUi';
import { RideRoute } from './RideRoute';
import { useAdminResource } from '@/lib/admin-api';
import type { RideDetail } from '@/lib/admin-types';
import { formatDate, formatMoney, statusLabel } from '@/lib/admin-utils';
export function RideDetailView({ rideId }: { rideId: string }) {
  const resource = useAdminResource<RideDetail>(
    `/admin/rides/${encodeURIComponent(rideId)}`,
  );
  const ride = resource.data;
  return (
    <>
      <AdminHeader
        title="Detalle de viaje"
        description={rideId}
        action={
          <Link className="button secondary" href="/admin/viajes">
            Volver a viajes
          </Link>
        }
      />
      <ListState {...resource} empty={false}>
        {ride && (
          <>
            <div className="admin-detail-grid">
              <section className="card">
                <h2>Operación</h2>
                <dl className="admin-detail-list">
                  <div>
                    <dt>Estado</dt>
                    <dd>
                      <StatusBadge status={ride.status} />
                    </dd>
                  </div>
                  <div>
                    <dt>Conductor / unidad</dt>
                    <dd>
                      {ride.driverName} · {ride.plate}
                    </dd>
                  </div>
                  <div>
                    <dt>Salida programada</dt>
                    <dd>{formatDate(ride.departureTime, true)}</dd>
                  </div>
                  <div>
                    <dt>Inicio / finalización</dt>
                    <dd>
                      {formatDate(ride.startedAt, true)} /{' '}
                      {formatDate(ride.endedAt, true)}
                    </dd>
                  </div>
                  <div>
                    <dt>Origen</dt>
                    <dd>{ride.origin.address}</dd>
                  </div>
                  <div>
                    <dt>Destino</dt>
                    <dd>{ride.destination.address}</dd>
                  </div>
                  <div>
                    <dt>Pasajeros / asientos disponibles</dt>
                    <dd>
                      {ride.passengerCount} / {ride.availableSeats}
                    </dd>
                  </div>
                </dl>
              </section>
              <section className="card">
                <h2>Recorrido</h2>
                <RideRoute ride={ride} />
                <p className="admin-description admin-small">
                  {ride.route.distanceMeters
                    ? `${(ride.route.distanceMeters / 1000).toFixed(1)} km · `
                    : ''}
                  {ride.route.durationSeconds
                    ? `${Math.round(ride.route.durationSeconds / 60)} min aproximados · `
                    : ''}
                  Versión {ride.route.version}
                </p>
              </section>
            </div>
            <section className="card admin-small">
              <h2>Importes y efectivo</h2>
              <div className="admin-detail-grid">
                <dl className="admin-detail-list">
                  <div>
                    <dt>Precio por asiento</dt>
                    <dd>{formatMoney(ride.pricePerSeatCents)}</dd>
                  </div>
                  <div>
                    <dt>Importe de las reservas</dt>
                    <dd>{formatMoney(ride.grossAmountCents)}</dd>
                  </div>
                </dl>
                <dl className="admin-detail-list">
                  <div>
                    <dt>Efectivo recibido</dt>
                    <dd>{formatMoney(ride.collectedAmountCents)}</dd>
                  </div>
                  <div>
                    <dt>Efectivo pendiente</dt>
                    <dd>{formatMoney(ride.pendingAmountCents)}</dd>
                  </div>
                </dl>
              </div>
            </section>
            <section className="card admin-small">
              <h2>Pasajeros y reservas</h2>
              {ride.passengers.length ? (
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Pasajero</th>
                        <th>Estado</th>
                        <th>Subida</th>
                        <th>Bajada</th>
                        <th>Asientos</th>
                        <th>Importe</th>
                        <th>Efectivo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ride.passengers.map((passenger) => (
                        <tr key={passenger.bookingId}>
                          <td>
                            <strong>{passenger.fullName}</strong>
                            <small>{passenger.email}</small>
                          </td>
                          <td>
                            <StatusBadge status={passenger.status} />
                          </td>
                          <td>
                            {passenger.pickup?.address ||
                              'Sin punto registrado'}
                          </td>
                          <td>
                            {passenger.dropoff?.address ||
                              'Sin punto registrado'}
                          </td>
                          <td>{passenger.seats}</td>
                          <td>{formatMoney(passenger.amountCents)}</td>
                          <td>
                            <StatusBadge status={passenger.cashStatus} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="admin-description">
                  Este viaje no tiene reservas.
                </p>
              )}
            </section>
            <section className="card admin-small">
              <h2>Historial de estados</h2>
              {ride.history.length ? (
                <ol className="admin-stop-list">
                  {ride.history.map((event, index) => (
                    <li key={`${event.changedAt}-${index}`}>
                      <strong>{statusLabel(event.status)}</strong> ·{' '}
                      {formatDate(event.changedAt, true)}
                      {event.reason && ` · ${event.reason}`}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="admin-description">
                  No se registraron cambios históricos.
                </p>
              )}
            </section>
          </>
        )}
      </ListState>
    </>
  );
}
