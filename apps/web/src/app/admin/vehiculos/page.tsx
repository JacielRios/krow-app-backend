'use client';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import {
  AdminDialog,
  AdminHeader,
  Feedback,
  ListState,
  Pagination,
  StatusBadge,
} from '@/components/admin/AdminUi';
import { DriverPicker } from '@/components/admin/DriverPicker';
import { useAdminApi, useAdminResource, type AdminPage } from '@/lib/admin-api';
import type { OperationalStatus, Vehicle } from '@/lib/admin-types';
import { queryString, readableError, statusLabel } from '@/lib/admin-utils';

export default function VehiclesPage() {
  const [driverId, setDriverId] = useState('');
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<Vehicle | 'new' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    setDriverId(
      new URLSearchParams(window.location.search).get('driverId') || '',
    );
  }, []);
  const resource = useAdminResource<AdminPage<Vehicle>>(
    `/admin/vehicles?${queryString({ driverId, q: query, status, page, pageSize: 20 })}`,
  );
  return (
    <>
      <AdminHeader
        title="Vehículos"
        description="Consulta las unidades, su conductor y los requisitos para operar."
        action={
          <button className="button" onClick={() => setEditor('new')}>
            Registrar vehículo
          </button>
        }
      />
      <Feedback message={message} />
      <section className="card">
        <form
          className="admin-toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            setQuery(input.trim());
            setPage(1);
          }}
        >
          <div className="field">
            <label htmlFor="vehicles-query">Buscar unidad</label>
            <input
              id="vehicles-query"
              placeholder="Placa, marca o modelo"
              maxLength={120}
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="vehicles-status">Estado</label>
            <select
              id="vehicles-status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos</option>
              {['active', 'suspended', 'inactive'].map((value) => (
                <option value={value} key={value}>
                  {statusLabel(value)}
                </option>
              ))}
            </select>
          </div>
          <button className="button secondary" type="submit">
            Buscar
          </button>
        </form>
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
                  <th>Vehículo</th>
                  <th>Conductor</th>
                  <th>Capacidad</th>
                  <th>Estado</th>
                  <th>Documentación</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {resource.data?.items.map((vehicle) => (
                  <tr key={vehicle.vehicleId}>
                    <td>
                      <strong>{vehicle.plate}</strong>
                      <small>
                        {vehicle.brand} {vehicle.model} · {vehicle.year}
                      </small>
                      <small>{vehicle.color}</small>
                    </td>
                    <td>{vehicle.driverName}</td>
                    <td>{vehicle.capacity} asientos</td>
                    <td>
                      <StatusBadge status={vehicle.status} />
                    </td>
                    <td>
                      <StatusBadge status={vehicle.compliance.state} />
                      {vehicle.compliance.reasons.map((reason) => (
                        <small key={reason}>{reason}</small>
                      ))}
                    </td>
                    <td>
                      <div className="admin-row">
                        <button
                          className="admin-text-button"
                          onClick={() => setEditor(vehicle)}
                        >
                          Consultar / editar
                        </button>
                        <Link
                          className="admin-text-button"
                          href={`/admin/documentos?vehicleId=${vehicle.vehicleId}`}
                        >
                          Documentos
                        </Link>
                      </div>
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
      {editor && (
        <VehicleEditor
          vehicle={editor === 'new' ? undefined : editor}
          defaultDriverId={driverId}
          onClose={() => setEditor(null)}
          onSuccess={() => {
            setEditor(null);
            setMessage('Vehículo guardado correctamente.');
            resource.reload();
          }}
        />
      )}
    </>
  );
}

function VehicleEditor({
  vehicle,
  defaultDriverId,
  onClose,
  onSuccess,
}: {
  vehicle?: Vehicle;
  defaultDriverId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const request = useAdminApi();
  const [driverId, setDriverId] = useState(
    vehicle?.driverId || defaultDriverId,
  );
  const [plate, setPlate] = useState(vehicle?.plate || '');
  const [brand, setBrand] = useState(vehicle?.brand || '');
  const [model, setModel] = useState(vehicle?.model || '');
  const [year, setYear] = useState(
    String(vehicle?.year || new Date().getFullYear()),
  );
  const [color, setColor] = useState(vehicle?.color || '');
  const [capacity, setCapacity] = useState(String(vehicle?.capacity || 4));
  const [status, setStatus] = useState<OperationalStatus>(
    vehicle?.status || 'inactive',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await request(
        vehicle ? `/admin/vehicles/${vehicle.vehicleId}` : '/admin/vehicles',
        {
          method: vehicle ? 'PATCH' : 'POST',
          body: {
            ...(vehicle ? {} : { driverId }),
            plate: plate.trim().toUpperCase(),
            brand: brand.trim(),
            model: model.trim(),
            year: Number(year),
            color: color.trim(),
            capacity: Number(capacity),
            status,
          },
        },
      );
      onSuccess();
    } catch (cause) {
      setError(readableError(cause));
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (vehicle && status !== vehicle.status && status !== 'active')
      setConfirm(true);
    else void save();
  }
  return (
    <AdminDialog
      title={vehicle ? `Editar ${vehicle.plate}` : 'Registrar vehículo'}
      onClose={onClose}
      busy={busy}
    >
      {confirm ? (
        <>
          <p>
            ¿Confirmas cambiar <strong>{vehicle?.plate}</strong> a{' '}
            <strong>{statusLabel(status).toLowerCase()}</strong>?
          </p>
          <p className="admin-description">
            La unidad dejará de estar disponible para publicar nuevos viajes.
          </p>
          <Feedback error={error} />
          <div className="admin-form-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              Volver
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() => {
                void save();
              }}
            >
              {busy ? 'Guardando…' : 'Confirmar cambio'}
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={submit}>
          <div className="admin-form-grid">
            <div className="full">
              {vehicle ? (
                <div className="field">
                  <span>Conductor asociado</span>
                  <strong>{vehicle.driverName}</strong>
                </div>
              ) : (
                <DriverPicker
                  value={driverId}
                  onChange={setDriverId}
                  required
                  id="vehicle-driver"
                />
              )}
            </div>
            <div className="field">
              <label htmlFor="vehicle-plate">Placas</label>
              <input
                id="vehicle-plate"
                required
                maxLength={20}
                value={plate}
                onChange={(event) => setPlate(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="vehicle-color">Color</label>
              <input
                id="vehicle-color"
                required
                maxLength={40}
                value={color}
                onChange={(event) => setColor(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="vehicle-brand">Marca</label>
              <input
                id="vehicle-brand"
                required
                maxLength={80}
                value={brand}
                onChange={(event) => setBrand(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="vehicle-model">Modelo</label>
              <input
                id="vehicle-model"
                required
                maxLength={80}
                value={model}
                onChange={(event) => setModel(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="vehicle-year">Año</label>
              <input
                id="vehicle-year"
                required
                type="number"
                min={1950}
                max={new Date().getFullYear() + 1}
                value={year}
                onChange={(event) => setYear(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="vehicle-capacity">
                Asientos disponibles para pasajeros
              </label>
              <input
                id="vehicle-capacity"
                required
                type="number"
                min={1}
                max={16}
                value={capacity}
                onChange={(event) => setCapacity(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="vehicle-state">Estado</label>
              <select
                id="vehicle-state"
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as OperationalStatus)
                }
              >
                {['inactive', 'active', 'suspended'].map((value) => (
                  <option key={value} value={value}>
                    {statusLabel(value)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <Feedback error={error} />
          <div className="admin-form-actions">
            <button
              className="button secondary"
              disabled={busy}
              type="button"
              onClick={onClose}
            >
              Cancelar
            </button>
            <button className="button" disabled={busy} type="submit">
              {busy ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      )}
    </AdminDialog>
  );
}
