'use client';
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
import { getAdminSupabase } from '@/lib/admin-supabase';
import type { AdminDocument, DocumentKind, Vehicle } from '@/lib/admin-types';
import {
  formatDate,
  queryString,
  readableError,
  statusLabel,
  validateDocumentFile,
} from '@/lib/admin-utils';

export default function DocumentsPage() {
  const [driverId, setDriverId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [status, setStatus] = useState('');
  const [validity, setValidity] = useState('all');
  const [page, setPage] = useState(1);
  const [upload, setUpload] = useState(false);
  const [review, setReview] = useState<AdminDocument | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [download, setDownload] = useState<{
    documentId: string;
    url: string;
  } | null>(null);
  const request = useAdminApi();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setDriverId(params.get('driverId') || '');
    setVehicleId(params.get('vehicleId') || '');
  }, []);
  useEffect(() => {
    if (!download) return;
    const timer = setTimeout(() => setDownload(null), 55_000);
    return () => clearTimeout(timer);
  }, [download]);
  const resource = useAdminResource<AdminPage<AdminDocument>>(
    `/admin/documents?${queryString({ driverId, vehicleId, status, validity, page, pageSize: 20 })}`,
  );
  async function prepareDownload(document: AdminDocument) {
    setDownloading(document.documentId);
    setActionError(null);
    setDownload(null);
    try {
      const result = await request<{ signedUrl: string }>(
        `/admin/documents/${document.documentId}/download`,
        { method: 'POST' },
      );
      const url = new URL(result.signedUrl);
      const project = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '');
      if (url.protocol !== 'https:' || url.origin !== project.origin)
        throw new Error('No se pudo abrir el documento de forma segura.');
      setDownload({ documentId: document.documentId, url: url.toString() });
    } catch (cause) {
      setActionError(readableError(cause));
    } finally {
      setDownloading(null);
    }
  }
  return (
    <>
      <AdminHeader
        title="Documentos"
        description="Archivos privados, vigencia y revisión de conductores y unidades."
        action={
          <button
            className="button"
            type="button"
            onClick={() => setUpload(true)}
          >
            Registrar documento
          </button>
        }
      />
      <Feedback error={actionError} message={message} />
      <section className="card">
        <div className="admin-toolbar">
          <DriverPicker
            value={driverId}
            onChange={(value) => {
              setDriverId(value);
              setVehicleId('');
              setPage(1);
            }}
          />
          <div className="field">
            <label htmlFor="docs-status">Revisión</label>
            <select
              id="docs-status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Todas</option>
              {['pending', 'approved', 'rejected'].map((value) => (
                <option key={value} value={value}>
                  {statusLabel(value)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="docs-validity">Vigencia</label>
            <select
              id="docs-validity"
              value={validity}
              onChange={(event) => {
                setValidity(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">Todas</option>
              <option value="valid">Vigentes</option>
              <option value="expired">Vencidos</option>
              <option value="no_expiry">Sin vencimiento</option>
            </select>
          </div>
          {vehicleId && (
            <button
              className="button secondary"
              onClick={() => {
                setVehicleId('');
                setPage(1);
              }}
            >
              Quitar filtro de vehículo
            </button>
          )}
        </div>
        <ListState {...resource} empty={!resource.data?.items.length}>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Titular</th>
                  <th>Revisión</th>
                  <th>Vigencia</th>
                  <th>Registro</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {resource.data?.items.map((document) => (
                  <tr key={document.documentId}>
                    <td>
                      <strong>{statusLabel(document.kind)}</strong>
                      <small>{document.fileName}</small>
                      <small>
                        {(document.sizeBytes / 1024 / 1024).toFixed(1)} MB
                      </small>
                    </td>
                    <td>
                      {document.driverName}
                      <small>
                        {document.vehicleId
                          ? 'Documento de vehículo'
                          : 'Documento de conductor'}
                      </small>
                    </td>
                    <td>
                      <StatusBadge status={document.status} />
                      <small>
                        {document.uploadState === 'uploaded'
                          ? 'Archivo recibido'
                          : 'Archivo pendiente'}
                      </small>
                    </td>
                    <td>
                      {document.isExpired ? (
                        <StatusBadge status="expired" />
                      ) : document.expiresAt ? (
                        <StatusBadge status="valid" />
                      ) : (
                        'Sin vencimiento'
                      )}
                      <small>{formatDate(document.expiresAt)}</small>
                    </td>
                    <td>{formatDate(document.createdAt, true)}</td>
                    <td>
                      <div className="admin-row">
                        <button
                          className="admin-text-button"
                          onClick={() => setReview(document)}
                        >
                          Revisar
                        </button>
                        {document.uploadState === 'uploaded' && (
                          <button
                            className="admin-text-button"
                            disabled={downloading !== null}
                            onClick={() => {
                              void prepareDownload(document);
                            }}
                          >
                            {downloading === document.documentId
                              ? 'Preparando…'
                              : 'Abrir archivo'}
                          </button>
                        )}
                        {download?.documentId === document.documentId && (
                          <a
                            className="admin-text-button"
                            href={download.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Ver documento ↗
                          </a>
                        )}
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
      {upload && (
        <UploadDocument
          defaultDriverId={driverId}
          defaultVehicleId={vehicleId}
          onClose={() => setUpload(false)}
          onSuccess={() => {
            setUpload(false);
            setMessage(
              'Documento recibido. Ya puedes revisar su contenido y vigencia.',
            );
            resource.reload();
          }}
        />
      )}
      {review && (
        <ReviewDocument
          document={review}
          onClose={() => setReview(null)}
          onSuccess={() => {
            setReview(null);
            setMessage('Revisión guardada correctamente.');
            resource.reload();
          }}
        />
      )}
    </>
  );
}

interface UploadTicket {
  document: AdminDocument;
  path: string;
  token: string;
  signedUrl: string;
}
function UploadDocument({
  defaultDriverId,
  defaultVehicleId,
  onClose,
  onSuccess,
}: {
  defaultDriverId: string;
  defaultVehicleId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const request = useAdminApi();
  const [target, setTarget] = useState<'driver' | 'vehicle'>(
    defaultVehicleId ? 'vehicle' : 'driver',
  );
  const [driverId, setDriverId] = useState(defaultDriverId);
  const [vehicleId, setVehicleId] = useState(defaultVehicleId);
  const [kind, setKind] = useState<DocumentKind>(
    defaultVehicleId ? 'registration' : 'license',
  );
  const [expiresAt, setExpiresAt] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [ticket, setTicket] = useState<UploadTicket | null>(null);
  const [uploaded, setUploaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const vehicles = useAdminResource<AdminPage<Vehicle>>(
    `/admin/vehicles?${queryString({ driverId, pageSize: 100 })}`,
  );
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!file) {
      setError('Selecciona un archivo.');
      return;
    }
    const invalid = validateDocumentFile(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const activeTicket =
        ticket ||
        (await request<UploadTicket>('/admin/documents/uploads', {
          method: 'POST',
          body: {
            ...(target === 'driver' ? { driverId } : { vehicleId }),
            kind,
            fileName: file.name,
            contentType: file.type,
            sizeBytes: file.size,
            expiresAt: expiresAt || undefined,
          },
        }));
      setTicket(activeTicket);
      if (!uploaded) {
        const result = await getAdminSupabase()
          .storage.from('krow-admin-documents')
          .uploadToSignedUrl(activeTicket.path, activeTicket.token, file, {
            contentType: file.type,
          });
        if (result.error)
          throw new Error(
            'No pudimos subir el archivo. Conservamos el registro para que puedas reintentar.',
          );
        setUploaded(true);
      }
      await request(
        `/admin/documents/${activeTicket.document.documentId}/complete`,
        { method: 'POST' },
      );
      onSuccess();
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AdminDialog
      title="Registrar documento privado"
      onClose={onClose}
      busy={busy}
    >
      <form
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <fieldset
          disabled={busy || ticket !== null}
          className="admin-form-fieldset"
        >
          <div className="admin-form-grid">
            <div className="field">
              <label htmlFor="document-target">Pertenece a</label>
              <select
                id="document-target"
                value={target}
                onChange={(event) => {
                  setTarget(event.target.value as 'driver' | 'vehicle');
                  setKind(
                    event.target.value === 'driver'
                      ? 'license'
                      : 'registration',
                  );
                }}
              >
                <option value="driver">Conductor</option>
                <option value="vehicle">Vehículo</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="document-kind">Tipo</label>
              <select
                id="document-kind"
                value={kind}
                onChange={(event) =>
                  setKind(event.target.value as DocumentKind)
                }
              >
                {(target === 'driver'
                  ? ['license', 'identity', 'other']
                  : ['registration', 'insurance', 'other']
                ).map((value) => (
                  <option key={value} value={value}>
                    {statusLabel(value)}
                  </option>
                ))}
              </select>
            </div>
            <div className="full">
              <DriverPicker
                value={driverId}
                onChange={(value) => {
                  setDriverId(value);
                  setVehicleId('');
                }}
                required={target === 'driver'}
                id="document-driver"
                label={
                  target === 'driver'
                    ? 'Conductor'
                    : 'Filtrar vehículos por conductor'
                }
              />
            </div>
            {target === 'vehicle' && (
              <div className="field full">
                <label htmlFor="document-vehicle">Vehículo</label>
                <select
                  required
                  id="document-vehicle"
                  value={vehicleId}
                  onChange={(event) => setVehicleId(event.target.value)}
                >
                  <option value="">Seleccionar unidad</option>
                  {vehicleId &&
                    !vehicles.data?.items.some(
                      (item) => item.vehicleId === vehicleId,
                    ) && <option value={vehicleId}>Unidad seleccionada</option>}
                  {vehicles.data?.items.map((vehicle) => (
                    <option value={vehicle.vehicleId} key={vehicle.vehicleId}>
                      {vehicle.plate} · {vehicle.brand} {vehicle.model} ·{' '}
                      {vehicle.driverName}
                    </option>
                  ))}
                </select>
                {vehicles.error && <small role="alert">{vehicles.error}</small>}
                {vehicles.data && vehicles.data.total > 100 && (
                  <small>
                    Filtra por conductor para encontrar otras unidades.
                  </small>
                )}
              </div>
            )}
            <div className="field">
              <label htmlFor="document-expiry">Vence el (opcional)</label>
              <input
                id="document-expiry"
                type="date"
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
              />
            </div>
            <div className="field full">
              <label htmlFor="document-file">
                Archivo PDF, JPG o PNG · hasta 10 MB
              </label>
              <input
                id="document-file"
                type="file"
                required
                accept="application/pdf,image/jpeg,image/png"
                onChange={(event) => setFile(event.target.files?.[0] || null)}
              />
            </div>
          </div>
        </fieldset>
        <Feedback error={error} />
        {uploaded && (
          <p role="status">Archivo recibido. Falta confirmar su registro.</p>
        )}
        <div className="admin-form-actions">
          <button
            className="button secondary"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button className="button" type="submit" disabled={busy}>
            {busy
              ? uploaded
                ? 'Confirmando…'
                : 'Subiendo…'
              : ticket
                ? 'Reintentar'
                : 'Subir documento'}
          </button>
        </div>
      </form>
    </AdminDialog>
  );
}
function ReviewDocument({
  document,
  onClose,
  onSuccess,
}: {
  document: AdminDocument;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const request = useAdminApi();
  const [status, setStatus] = useState(document.status);
  const [expiresAt, setExpiresAt] = useState(document.expiresAt || '');
  const [notes, setNotes] = useState(document.reviewNotes || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await request(`/admin/documents/${document.documentId}`, {
        method: 'PATCH',
        body: {
          status,
          expiresAt: expiresAt || null,
          reviewNotes: notes.trim() || null,
        },
      });
      onSuccess();
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AdminDialog title="Revisar documento" onClose={onClose} busy={busy}>
      <p>
        <strong>{document.fileName}</strong> · {document.driverName}
      </p>
      {document.isExpired && (
        <p className="admin-error">Este documento está vencido.</p>
      )}
      <form
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <div className="admin-form-grid">
          <div className="field">
            <label htmlFor="review-status">Resultado</label>
            <select
              id="review-status"
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as AdminDocument['status'])
              }
            >
              {['pending', 'approved', 'rejected'].map((value) => (
                <option
                  disabled={
                    value === 'approved' && document.uploadState !== 'uploaded'
                  }
                  key={value}
                  value={value}
                >
                  {statusLabel(value)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="review-expiry">Vencimiento</label>
            <input
              id="review-expiry"
              type="date"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
          </div>
          <div className="field full">
            <label htmlFor="review-notes">
              Observaciones{' '}
              {status === 'rejected' ? '(obligatorio)' : '(opcional)'}
            </label>
            <textarea
              id="review-notes"
              required={status === 'rejected'}
              maxLength={1000}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </div>
        <Feedback error={error} />
        <div className="admin-form-actions">
          <button
            className="button secondary"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button className="button" type="submit" disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar revisión'}
          </button>
        </div>
      </form>
    </AdminDialog>
  );
}
