'use client';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import {
  AdminDialog,
  AdminHeader,
  Feedback,
  ListState,
  Pagination,
  StatusBadge,
} from '@/components/admin/AdminUi';
import { useAdminApi, useAdminResource, type AdminPage } from '@/lib/admin-api';
import type {
  Driver,
  DriverDetail,
  OperationalStatus,
} from '@/lib/admin-types';
import {
  formatDate,
  queryString,
  readableError,
  statusLabel,
} from '@/lib/admin-utils';

export default function DriversPage() {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<Driver | 'new' | null>(null);
  const [statusTarget, setStatusTarget] = useState<Driver | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const resource = useAdminResource<AdminPage<Driver>>(
    `/admin/drivers?${queryString({ q: query, status, page, pageSize: 20 })}`,
  );
  const success = (text: string) => {
    setMessage(text);
    setEditor(null);
    setStatusTarget(null);
    resource.reload();
  };
  return (
    <>
      <AdminHeader
        title="Conductores"
        description="Gestiona el alta, los permisos para conducir y la documentación de cada cuenta."
        action={
          <button className="button" onClick={() => setEditor('new')}>
            Dar de alta conductor
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
            <label htmlFor="drivers-query">Buscar conductor</label>
            <input
              id="drivers-query"
              placeholder="Nombre, correo o matrícula"
              value={input}
              maxLength={120}
              onChange={(event) => setInput(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="drivers-status">Estado</label>
            <select
              id="drivers-status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos</option>
              {['active', 'suspended', 'inactive'].map((value) => (
                <option key={value} value={value}>
                  {statusLabel(value)}
                </option>
              ))}
            </select>
          </div>
          <button className="button secondary" type="submit">
            Buscar
          </button>
        </form>
        <ListState {...resource} empty={!resource.data?.items.length}>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Conductor</th>
                  <th>Estado</th>
                  <th>Licencia</th>
                  <th>Documentación</th>
                  <th>Vehículos</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {resource.data?.items.map((driver) => (
                  <tr key={driver.driverId}>
                    <td>
                      <strong>{driver.fullName}</strong>
                      <small>{driver.email}</small>
                      <small>{driver.institutionalId}</small>
                    </td>
                    <td>
                      <StatusBadge status={driver.status} />
                      <small>{statusLabel(driver.approvalStatus)}</small>
                    </td>
                    <td>
                      {driver.licenseNumber}
                      <small>Vence {formatDate(driver.licenseExpiresAt)}</small>
                    </td>
                    <td>
                      <StatusBadge status={driver.compliance.state} />
                      {driver.compliance.reasons.map((reason) => (
                        <small key={reason}>{reason}</small>
                      ))}
                    </td>
                    <td>{driver.vehicleCount}</td>
                    <td>
                      <div className="admin-row">
                        <button
                          className="admin-text-button"
                          type="button"
                          onClick={() => setEditor(driver)}
                        >
                          Consultar / editar
                        </button>
                        <button
                          className="admin-text-button"
                          type="button"
                          onClick={() => setStatusTarget(driver)}
                        >
                          Cambiar estado
                        </button>
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
            pageSize={20}
            total={resource.data.total}
            onPage={setPage}
            loading={resource.loading}
          />
        )}
      </section>
      {editor && (
        <DriverEditor
          driver={editor === 'new' ? undefined : editor}
          onClose={() => setEditor(null)}
          onSuccess={success}
        />
      )}
      {statusTarget && (
        <DriverStatusDialog
          driver={statusTarget}
          onClose={() => setStatusTarget(null)}
          onSuccess={success}
        />
      )}
    </>
  );
}

function DriverEditor({
  driver,
  onClose,
  onSuccess,
}: {
  driver?: Driver;
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const request = useAdminApi();
  const [fullName, setFullName] = useState(driver?.fullName || '');
  const [email, setEmail] = useState('');
  const [licenseNumber, setLicenseNumber] = useState(
    driver?.licenseNumber || '',
  );
  const [licenseExpiresAt, setLicenseExpiresAt] = useState(
    driver?.licenseExpiresAt || '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await request(
        driver ? `/admin/drivers/${driver.driverId}` : '/admin/drivers',
        {
          method: driver ? 'PATCH' : 'POST',
          body: {
            ...(driver
              ? { fullName: fullName.trim() }
              : { email: email.trim() }),
            licenseNumber: licenseNumber.trim(),
            licenseExpiresAt,
          },
        },
      );
      onSuccess(
        driver
          ? 'Los datos del conductor se actualizaron.'
          : 'Conductor registrado. Revisa sus documentos y activa su acceso cuando esté en regla.',
      );
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AdminDialog
      title={driver ? driver.fullName : 'Dar de alta conductor'}
      onClose={onClose}
      busy={busy}
    >
      <form
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <div className="admin-form-grid">
          {driver ? (
            <div className="field full">
              <label htmlFor="driver-name">Nombre</label>
              <input
                id="driver-name"
                required
                maxLength={150}
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
              />
            </div>
          ) : (
            <div className="field full">
              <label htmlFor="driver-email">Correo de la cuenta</label>
              <input
                id="driver-email"
                required
                type="email"
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <small className="admin-description">
                El usuario debe registrarse primero en KROW. Su cuenta podrá
                seguir usándose como pasajero.
              </small>
            </div>
          )}
          <div className="field">
            <label htmlFor="driver-license">Número de licencia</label>
            <input
              id="driver-license"
              required
              maxLength={80}
              value={licenseNumber}
              onChange={(event) => setLicenseNumber(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="driver-license-expiry">
              Vencimiento de licencia
            </label>
            <input
              id="driver-license-expiry"
              required
              type="date"
              value={licenseExpiresAt}
              onChange={(event) => setLicenseExpiresAt(event.target.value)}
            />
          </div>
        </div>
        <Feedback error={error} />
        <div className="admin-form-actions">
          <button
            className="button secondary"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            Cancelar
          </button>
          <button className="button" type="submit" disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
      {driver && <DriverExtras driverId={driver.driverId} />}
    </AdminDialog>
  );
}
function DriverExtras({ driverId }: { driverId: string }) {
  const resource = useAdminResource<DriverDetail>(`/admin/drivers/${driverId}`);
  return (
    <section className="admin-small">
      <h2>Vehículos y documentación</h2>
      <ListState {...resource} empty={false}>
        {resource.data && (
          <>
            <p>
              {resource.data.vehicles.length} vehículos registrados ·
              Calificación:{' '}
              {resource.data.rating === null
                ? 'Sin reseñas'
                : Number(resource.data.rating).toFixed(1)}
            </p>
            {resource.data.vehicles.map((vehicle) => (
              <p key={vehicle.vehicleId}>
                <strong>{vehicle.plate}</strong> · {vehicle.brand}{' '}
                {vehicle.model} <StatusBadge status={vehicle.status} />
              </p>
            ))}
            {resource.data.documents.map((document) => (
              <p key={document.documentId}>
                {statusLabel(document.kind)} · {document.fileName}{' '}
                <StatusBadge
                  status={document.isExpired ? 'expired' : document.status}
                />
              </p>
            ))}
          </>
        )}
      </ListState>
      <div className="admin-row">
        <Link
          className="admin-text-button"
          href={`/admin/vehiculos?driverId=${driverId}`}
        >
          Gestionar vehículos
        </Link>
        <Link
          className="admin-text-button"
          href={`/admin/documentos?driverId=${driverId}`}
        >
          Revisar documentos
        </Link>
        <Link
          className="admin-text-button"
          href={`/admin/viajes?driverId=${driverId}`}
        >
          Consultar viajes
        </Link>
      </div>
    </section>
  );
}
function DriverStatusDialog({
  driver,
  onClose,
  onSuccess,
}: {
  driver: Driver;
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const request = useAdminApi();
  const [status, setStatus] = useState<OperationalStatus>(driver.status);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (status !== 'active' && !reason.trim()) {
      setError('Indica el motivo del cambio de estado.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await request(`/admin/drivers/${driver.driverId}/status`, {
        method: 'PATCH',
        body: { status, reason: reason.trim() || undefined },
      });
      onSuccess('Estado del conductor actualizado.');
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AdminDialog
      title="Cambiar estado del conductor"
      onClose={onClose}
      busy={busy}
    >
      <p>
        <strong>{driver.fullName}</strong>
      </p>
      <p className="admin-description">
        Suspender o desactivar impide publicar e iniciar nuevos viajes. Los
        viajes en curso conservan su seguimiento.
      </p>
      <form
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <div className="field">
          <label htmlFor="driver-new-status">Nuevo estado</label>
          <select
            id="driver-new-status"
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as OperationalStatus)
            }
          >
            {['active', 'suspended', 'inactive'].map((value) => (
              <option key={value} value={value}>
                {statusLabel(value)}
              </option>
            ))}
          </select>
        </div>
        <div className="field admin-small">
          <label htmlFor="driver-status-reason">
            Motivo {status !== 'active' ? '(obligatorio)' : '(opcional)'}
          </label>
          <textarea
            id="driver-status-reason"
            required={status !== 'active'}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        <Feedback error={error} />
        <div className="admin-form-actions">
          <button
            className="button secondary"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            Cancelar
          </button>
          <button
            className="button"
            type="submit"
            disabled={busy || status === driver.status}
          >
            {busy ? 'Actualizando…' : 'Confirmar cambio'}
          </button>
        </div>
      </form>
    </AdminDialog>
  );
}
