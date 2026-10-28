'use client';
import { useState } from 'react';
import { useDriverResource } from '@/lib/driver-auth';
import { formatDate, statusLabel } from '@/lib/admin-utils';
import {
  initials,
  licenseStatus,
  safePhotoUrl,
  type DriverProfile as Profile,
} from '@/components/driver/driver-kit';

function Avatar({ name, photo }: { name: string | null; photo: string | null }) {
  const [failed, setFailed] = useState(false);
  const url = safePhotoUrl(photo);
  if (url && !failed)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className="drv-avatar"
        src={url}
        alt={`Foto de ${name ?? 'conductor'}`}
        onError={() => setFailed(true)}
      />
    );
  return (
    <div className="drv-avatar" role="img" aria-label="Sin foto de perfil">
      {initials(name)}
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export default function DriverProfile() {
  const { data, loading, error, reload } =
    useDriverResource<Profile>('/drivers/me/profile');
  const license = data ? licenseStatus(data.licenseExpiry) : null;

  return (
    <div className="drv-page" aria-busy={loading}>
      <header className="drv-top">
        <div>
          <p className="drv-eyebrow">Mi cuenta</p>
          <h1>Mi perfil</h1>
          <p className="drv-sub">Los datos de tu cuenta de conductor en KROW.</p>
        </div>
      </header>

      {loading && !data && <p role="status">Cargando tu perfil…</p>}
      {error && (
        <div className="drv-error" role="alert">
          <p>{error}</p>
          <button type="button" className="drv-button" onClick={reload}>
            Reintentar
          </button>
        </div>
      )}

      {data && license && (
        <section className="drv-panel">
          <div className="drv-profile-head">
            <Avatar name={data.fullName} photo={data.photoUrl} />
            <div>
              <h2>{data.fullName ?? 'Nombre sin registrar'}</h2>
              <p className="drv-sub">{data.email ?? 'Correo sin registrar'}</p>
              <span className="drv-badge">{statusLabel(data.status)}</span>
            </div>
          </div>
          <dl className="drv-details">
            <Detail label="Programa académico">
              {data.academicProgram ?? 'Sin registrar'}
            </Detail>
            <Detail label="Periodo académico">
              {data.academicPeriod ?? 'Sin registrar'}
            </Detail>
            <Detail label="Número de licencia">{data.licenseNumber}</Detail>
            <Detail label="Vigencia de la licencia">
              {formatDate(data.licenseExpiry)}{' '}
              {license.tone === 'expired' && (
                <span className="drv-badge bad">Licencia vencida</span>
              )}
              {license.tone === 'soon' && (
                <span className="drv-badge warn">
                  Vence en {license.days}{' '}
                  {license.days === 1 ? 'día' : 'días'}
                </span>
              )}
              {license.tone === 'ok' && (
                <span className="drv-badge">Vigente</span>
              )}
            </Detail>
            <Detail label="Calificación como conductor">
              {data.rating === null
                ? 'Aún sin calificaciones'
                : `${data.rating.toFixed(1)} de 5`}
            </Detail>
            <Detail label="Conductor desde">{formatDate(data.memberSince)}</Detail>
          </dl>
        </section>
      )}
    </div>
  );
}
