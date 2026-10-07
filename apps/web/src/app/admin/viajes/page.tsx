'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  AdminHeader,
  ListState,
  Pagination,
  StatusBadge,
} from '@/components/admin/AdminUi';
import { DriverPicker } from '@/components/admin/DriverPicker';
import { useAdminResource, type AdminPage } from '@/lib/admin-api';
import type { AdminRide } from '@/lib/admin-types';
import {
  formatDate,
  formatMoney,
  queryString,
  statusLabel,
} from '@/lib/admin-utils';
export default function RidesPage() {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [driverId, setDriverId] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [dates, setDates] = useState({ from: '', to: '' });
  useEffect(() => {
    setDriverId(
      new URLSearchParams(window.location.search).get('driverId') || '',
    );
  }, []);
  const resource = useAdminResource<AdminPage<AdminRide>>(
    `/admin/rides?${queryString({ q: query, driverId, status, ...dates, page, pageSize: 20 })}`,
  );
  const invalidDates = Boolean(from && to && from > to);
  return (
    <>
      <AdminHeader
        title="Viajes"
        description="Historial completo, pasajeros, recorrido y cobros registrados."
      />
      <section className="card">
        <form
          className="admin-toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            if (invalidDates) return;
            setQuery(input.trim());
            setDates({ from, to });
            setPage(1);
          }}
        >
          <div className="field">
            <label htmlFor="rides-search">Buscar viaje</label>
            <input
              id="rides-search"
              value={input}
              maxLength={120}
              placeholder="ID, conductor o destino"
              onChange={(event) => setInput(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="rides-state">Estado</label>
            <select
              id="rides-state"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos</option>
              {[
                'scheduled',
                'full',
                'in_progress',
                'completed',
                'cancelled',
              ].map((value) => (
                <option key={value} value={value}>
                  {statusLabel(value)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rides-from">Desde</label>
            <input
              id="rides-from"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="rides-to">Hasta</label>
            <input
              id="rides-to"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
          <button
            className="button secondary"
            type="submit"
            disabled={invalidDates}
          >
            Aplicar
          </button>
        </form>
        {invalidDates && (
          <p className="admin-error" role="alert">
            La fecha inicial debe ser anterior o igual a la final.
          </p>
        )}
        <div className="admin-toolbar">
          <DriverPicker
            value={driverId}
            onChange={(value) => {
              setDriverId(value);
              setPage(1);
            }}
          />
        </div>
        <ListState {...resource} empty={!resource.data?.items.length}>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Viaje / fecha</th>
                  <th>Conductor</th>
                  <th>Destino</th>
                  <th>Estado</th>
                  <th>Pasajeros</th>
                  <th>Precio por asiento</th>
                  <th>Efectivo cobrado</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {resource.data?.items.map((ride) => (
                  <tr key={ride.rideId}>
                    <td>
                      <strong>{formatDate(ride.departureTime, true)}</strong>
                      <small>{ride.rideId}</small>
                    </td>
                    <td>
                      {ride.driverName}
                      <small>{ride.plate}</small>
                    </td>
                    <td>
                      {ride.destination.address}
                      <small>Desde {ride.origin.address}</small>
                    </td>
                    <td>
                      <StatusBadge status={ride.status} />
                    </td>
                    <td>
                      {ride.passengerCount}
                      <small>{ride.transportedPassengers} transportados</small>
                    </td>
                    <td>{formatMoney(ride.pricePerSeatCents)}</td>
                    <td>
                      {formatMoney(ride.collectedAmountCents)}
                      <small>
                        {formatMoney(ride.pendingAmountCents)} pendiente
                      </small>
                    </td>
                    <td>
                      <Link
                        className="admin-text-button"
                        href={`/admin/viajes/${ride.rideId}`}
                      >
                        Ver detalle
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ListState>
        {resource.data && (
          <Pagination
            page={page}
            total={resource.data.total}
            pageSize={20}
            onPage={setPage}
            loading={resource.loading}
          />
        )}
      </section>
    </>
  );
}
