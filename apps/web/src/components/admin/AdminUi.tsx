'use client';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { statusLabel } from '@/lib/admin-utils';
export function AdminHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="admin-header">
      <div>
        <p className="eyebrow">Administración</p>
        <h1>{title}</h1>
        <p className="admin-description">{description}</p>
      </div>
      {action}
    </header>
  );
}
export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`admin-badge status-${status}`}>
      {statusLabel(status)}
    </span>
  );
}
export function Feedback({
  error,
  message,
}: {
  error?: string | null;
  message?: string | null;
}) {
  return (
    <>
      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="admin-success" role="status">
          {message}
        </p>
      )}
    </>
  );
}
export function ListState({
  loading,
  error,
  empty,
  reload,
  children,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  reload: () => void;
  children: ReactNode;
}) {
  return (
    <>
      {loading && (
        <p className="admin-description" role="status">
          Actualizando datos…
        </p>
      )}
      {error && (
        <div className="admin-error" role="alert">
          {error}{' '}
          <button className="admin-text-button" type="button" onClick={reload}>
            Reintentar
          </button>
        </div>
      )}
      {!loading && !error && empty && (
        <div className="admin-empty">
          <h2>No hay resultados</h2>
          <p>Prueba otros filtros o registra el primer elemento.</p>
        </div>
      )}
      {children}
    </>
  );
}
export function Pagination({
  page,
  total,
  pageSize,
  onPage,
  loading,
}: {
  page: number;
  total: number;
  pageSize: number;
  onPage: (value: number) => void;
  loading: boolean;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav className="admin-pagination" aria-label="Paginación">
      <p>
        {total} registros · Página {page} de {pages}
      </p>
      <div className="admin-row">
        <button
          className="button secondary"
          type="button"
          disabled={page <= 1 || loading}
          onClick={() => onPage(page - 1)}
        >
          Anterior
        </button>
        <button
          className="button secondary"
          type="button"
          disabled={page >= pages || loading}
          onClick={() => onPage(page + 1)}
        >
          Siguiente
        </button>
      </div>
    </nav>
  );
}
export function AdminDialog({
  title,
  onClose,
  children,
  busy = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement;
    dialog?.showModal();
    dialog
      ?.querySelector<HTMLElement>(
        'input:not([type="hidden"]), select, textarea',
      )
      ?.focus();
    return () => {
      dialog?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="admin-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="admin-dialog-header">
        <h2 id={titleId}>{title}</h2>
        <button
          className="button secondary"
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label="Cerrar ventana"
        >
          Cerrar
        </button>
      </header>
      {children}
    </dialog>
  );
}
