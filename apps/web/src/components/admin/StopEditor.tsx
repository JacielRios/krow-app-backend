'use client';

import { useRef, useState, type FormEvent } from 'react';
import { AdminDialog, Feedback } from './AdminUi';
import { useAdminApi } from '@/lib/admin-api';
import { readableError } from '@/lib/admin-utils';
import type {
  StopCoordinates,
  TransportCorridor,
  TransportStop,
} from '@/lib/transport-stops';
import { validStopCoordinates } from '@/lib/transport-stops';

export function StopEditor({
  stop,
  coordinates,
  corridors,
  onClose,
  onSaved,
}: {
  stop: TransportStop | null;
  coordinates?: StopCoordinates | null;
  corridors: TransportCorridor[];
  onClose: () => void;
  onSaved: (stopId: string) => void;
}) {
  const request = useAdminApi();
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [avenue, setAvenue] = useState(stop?.corridorId ?? '');
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current) return;
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? '').trim();
    const corridorId = text('corridorId') || null;
    const point = {
      latitude: Number(text('latitude')),
      longitude: Number(text('longitude')),
    };
    if (
      !text('latitude') ||
      !text('longitude') ||
      !validStopCoordinates(point)
    ) {
      setError('Indica una latitud y longitud válidas.');
      return;
    }
    if (!text('externalId') || !text('name')) {
      setError('El identificador y el nombre son obligatorios.');
      return;
    }
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      const saved = await request<{ stopId: string }>(
        stop
          ? `/admin/transport-stops/${stop.stopId}`
          : '/admin/transport-stops',
        {
          method: stop ? 'PATCH' : 'POST',
          body: {
            externalId: text('externalId'),
            name: text('name'),
            address: text('address'),
            municipality: text('municipality'),
            ...point,
            stopType: text('stopType'),
            active: form.has('active'),
            corridorId,
            stopOrder: corridorId ? Number(text('stopOrder')) : null,
            direction: text('direction') || null,
          },
        },
      );
      onSaved(saved.stopId);
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <AdminDialog
      title={stop ? 'Editar parada' : 'Agregar parada'}
      onClose={onClose}
      busy={busy}
    >
      <form onSubmit={save}>
        <Feedback error={error} />
        <fieldset className="admin-form-fieldset" disabled={busy}>
          {coordinates && (
            <p className="admin-stop-location-note">
              Ubicación seleccionada en el mapa. Revisa los datos antes de
              guardar.
            </p>
          )}
          <div className="admin-form-grid">
            {(
              [
                ['externalId', 'Identificador', 120],
                ['name', 'Nombre', 160],
                ['address', 'Dirección', 500],
                ['municipality', 'Municipio', 160],
                ['direction', 'Sentido', 160],
              ] as const
            ).map(([key, label, max]) => (
              <div
                className={`field${key === 'address' ? ' full' : ''}`}
                key={key}
              >
                <label htmlFor={`stop-${key}`}>{label}</label>
                <input
                  id={`stop-${key}`}
                  name={key}
                  defaultValue={stop?.[key] ?? ''}
                  maxLength={max}
                  required={key === 'name' || key === 'externalId'}
                />
              </div>
            ))}
            <div className="field">
              <label htmlFor="stop-avenue">Avenida</label>
              <select
                id="stop-avenue"
                name="corridorId"
                value={avenue}
                onChange={(event) => setAvenue(event.target.value)}
              >
                <option value="">Punto general / campus</option>
                {corridors
                  .filter(
                    (corridor) =>
                      corridor.active ||
                      corridor.corridorId === stop?.corridorId,
                  )
                  .map((corridor) => (
                    <option
                      value={corridor.corridorId}
                      key={corridor.corridorId}
                    >
                      {corridor.name}
                      {corridor.active ? '' : ' (inactiva)'}
                    </option>
                  ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="stop-order">Orden dentro de la avenida</label>
              <input
                id="stop-order"
                name="stopOrder"
                type="number"
                min={1}
                max={10000}
                required={!!avenue}
                disabled={!avenue || busy}
                defaultValue={stop?.stopOrder ?? ''}
              />
            </div>
            {(['latitude', 'longitude'] as const).map((key, index) => (
              <div className="field" key={key}>
                <label htmlFor={`stop-${key}`}>
                  {index === 0 ? 'Latitud' : 'Longitud'}
                </label>
                <input
                  id={`stop-${key}`}
                  name={key}
                  type="number"
                  step="any"
                  min={index === 0 ? -90 : -180}
                  max={index === 0 ? 90 : 180}
                  required
                  defaultValue={coordinates?.[key] ?? stop?.[key] ?? ''}
                />
              </div>
            ))}
            <div className="field full">
              <label htmlFor="stop-type">Tipo</label>
              <select
                id="stop-type"
                name="stopType"
                defaultValue={stop?.stopType ?? 'general'}
              >
                <option value="general">Punto de encuentro</option>
                <option value="official_boarding_zone">
                  Zona oficial de abordaje
                </option>
              </select>
            </div>
            <label className="admin-checkbox full">
              <input
                type="checkbox"
                name="active"
                defaultChecked={stop?.active ?? true}
              />
              Activa
            </label>
          </div>
          <p className="admin-description admin-small">
            El identificador y el nombre son obligatorios. Las paradas se
            ofrecen por avenida al asociarlas a una. Una parada con reservas
            pendientes no se puede desactivar. Verifica en campo el lado de
            circulación y la posibilidad de detenerse.
          </p>
        </fieldset>
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
            {busy ? 'Guardando…' : 'Guardar parada'}
          </button>
        </div>
      </form>
    </AdminDialog>
  );
}
