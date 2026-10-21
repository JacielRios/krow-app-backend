'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AdminDialog, Feedback } from './AdminUi';
import { useAdminApi } from '@/lib/admin-api';
import { readableError } from '@/lib/admin-utils';
import type {
  GoogleStopReference,
  StopCoordinates,
  StopSuggestions,
  TransportCorridor,
  TransportStop,
} from '@/lib/transport-stops';
import { validStopCoordinates } from '@/lib/transport-stops';

type Fields = {
  externalId: string;
  name: string;
  address: string;
  municipality: string;
  direction: string;
  corridorId: string;
  stopOrder: string;
  latitude: string;
  longitude: string;
  stopType: TransportStop['stopType'];
};
export function StopEditor({
  stop,
  coordinates,
  reference,
  corridors,
  onClose,
  onSaved,
}: {
  stop: TransportStop | null;
  coordinates?: StopCoordinates | null;
  reference?: GoogleStopReference;
  corridors: TransportCorridor[];
  onClose: () => void;
  onSaved: (stopId: string) => void;
}) {
  const request = useAdminApi();
  const saving = useRef(false);
  const dirty = useRef(new Set<keyof Fields>());
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [manualCorridor, setManualCorridor] = useState<string | undefined>();
  const [suggestions, setSuggestions] = useState<StopSuggestions | null>(null);
  const [lookupError, setLookupError] = useState('');
  const [error, setError] = useState('');
  const [active, setActive] = useState(stop?.active ?? true);
  const [insertAtOrder, setInsertAtOrder] = useState(!stop);
  const [fields, setFields] = useState<Fields>(() => ({
    externalId: stop?.externalId ?? '',
    name: stop?.name ?? reference?.name ?? '',
    address: stop?.address ?? reference?.address ?? '',
    municipality: stop?.municipality ?? '',
    direction: stop?.direction ?? '',
    corridorId: stop?.corridorId ?? '',
    stopOrder: String(stop?.stopOrder ?? ''),
    latitude: String(coordinates?.latitude ?? stop?.latitude ?? ''),
    longitude: String(coordinates?.longitude ?? stop?.longitude ?? ''),
    stopType: stop?.stopType ?? 'dropoff_only',
  }));
  const latitude = fields.latitude,
    longitude = fields.longitude;
  const sameMapPoint =
    !!coordinates &&
    Number(latitude) === coordinates.latitude &&
    Number(longitude) === coordinates.longitude;
  const referenceName = sameMapPoint ? reference?.name : undefined;
  useEffect(() => {
    if (
      stop ||
      !latitude.trim() ||
      !longitude.trim() ||
      !validStopCoordinates({
        latitude: Number(latitude),
        longitude: Number(longitude),
      })
    )
      return;
    const controller = new AbortController();
    setLoading(true);
    setLookupError('');
    setSuggestions(null);
    const timer = setTimeout(() => {
      void request<StopSuggestions>('/admin/transport-stops/suggest', {
        method: 'POST',
        signal: controller.signal,
        body: {
          latitude: Number(latitude),
          longitude: Number(longitude),
          referenceName,
          ...(manualCorridor ? { corridorId: manualCorridor } : {}),
        },
      })
        .then((result) => {
          if (controller.signal.aborted) return;
          setSuggestions(result);
          setFields((current) => {
            const next = { ...current };
            for (const key of [
              'externalId',
              'name',
              'address',
              'municipality',
              'direction',
              'corridorId',
              'stopOrder',
            ] as const) {
              if (dirty.current.has(key)) continue;
              const value = result.values[key];
              // Retain the actual Google POI address if reverse geocoding has no address.
              if (key === 'address' && !value && referenceName) continue;
              next[key] = value == null ? '' : String(value);
            }
            if (manualCorridor === '') next.stopOrder = '';
            return next;
          });
        })
        .catch((cause) => {
          if (!controller.signal.aborted) setLookupError(readableError(cause));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    stop,
    latitude,
    longitude,
    referenceName,
    manualCorridor,
    request,
    revision,
  ]);

  function change(key: keyof Fields, value: string) {
    dirty.current.add(key);
    if (key === 'corridorId') {
      setManualCorridor(value);
      dirty.current.delete('stopOrder');
      if (!dirty.current.has('direction'))
        setFields((current) => ({ ...current, direction: '' }));
    }
    if (!stop && (key === 'latitude' || key === 'longitude')) {
      setSuggestions(null);
      setLookupError('');
      setLoading(false);
      setFields((current) => {
        const next = { ...current, [key]: value };
        for (const derived of [
          'externalId',
          'name',
          'address',
          'municipality',
          'direction',
          'stopOrder',
          'corridorId',
        ] as const)
          if (!dirty.current.has(derived)) next[derived] = '';
        return next;
      });
    } else
      setFields((current) => ({
        ...current,
        [key]: value,
        ...(key === 'corridorId' ? { stopOrder: '' } : {}),
      }));
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current || loading) return;
    const text = (key: keyof Fields) => fields[key].trim();
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
    if (fields.stopType === 'dropoff_only' && active && !corridorId) {
      setError(
        'Selecciona una avenida para activar esta parada de descenso, o guárdala inactiva mientras confirmas su ubicación.',
      );
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
            stopType: fields.stopType,
            active,
            corridorId,
            stopOrder: corridorId ? Number(text('stopOrder')) : null,
            direction: text('direction') || null,
            ...(!stop ? { insertAtOrder: insertAtOrder && !!corridorId } : {}),
            ...(!stop &&
            suggestions?.values.corridorId === corridorId &&
            suggestions.catalogVersion
              ? { expectedCatalogVersion: suggestions.catalogVersion }
              : {}),
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
      title={stop ? 'Editar parada' : 'Agregar parada de descenso'}
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
          {!stop && (
            <div className="admin-stop-autofill" aria-busy={loading}>
              {loading ? (
                <p role="status">
                  Completando datos de Google y del catálogo KROW…
                </p>
              ) : suggestions ? (
                <p role="status">
                  Datos preparados. Los campos siguen siendo editables; revisa
                  las observaciones antes de guardar.
                </p>
              ) : null}
              {lookupError && (
                <p role="alert">
                  No pudimos completar los datos: {lookupError} Puedes
                  capturarlos manualmente.
                </p>
              )}
              {suggestions?.warnings.length ? (
                <ul>
                  {suggestions.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
              <button
                type="button"
                className="admin-text-button"
                disabled={loading || !latitude || !longitude}
                onClick={() => setRevision((value) => value + 1)}
              >
                Reintentar datos de la ubicación
              </button>
            </div>
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
                  value={fields[key]}
                  onChange={(event) => change(key, event.target.value)}
                  maxLength={max}
                  required={key === 'name' || key === 'externalId'}
                />
                {key === 'direction' && (
                  <small>
                    Confirma el lado y sentido de circulación. Si no se conoce,
                    puede quedar pendiente.
                  </small>
                )}
              </div>
            ))}
            <div className="field">
              <label htmlFor="stop-avenue">Avenida</label>
              <select
                id="stop-avenue"
                name="corridorId"
                value={fields.corridorId}
                onChange={(event) => change('corridorId', event.target.value)}
              >
                <option value="">
                  {fields.stopType === 'dropoff_only'
                    ? 'Selecciona una avenida'
                    : 'Punto general / campus'}
                </option>
                {corridors
                  .filter(
                    (corridor) =>
                      corridor.active ||
                      corridor.corridorId === stop?.corridorId,
                  )
                  .map((corridor) => (
                    <option
                      key={corridor.corridorId}
                      value={corridor.corridorId}
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
                required={!!fields.corridorId}
                disabled={!fields.corridorId || busy}
                value={fields.stopOrder}
                onChange={(event) => change('stopOrder', event.target.value)}
              />
              {suggestions?.orderSource && (
                <small>
                  Posición sugerida según el recorrido ordenado del catálogo.
                </small>
              )}
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
                  value={fields[key]}
                  onChange={(event) => change(key, event.target.value)}
                />
              </div>
            ))}
            <div className="field full">
              <label htmlFor="stop-type">Tipo</label>
              <select
                id="stop-type"
                name="stopType"
                value={fields.stopType}
                onChange={(event) => change('stopType', event.target.value)}
              >
                <option value="dropoff_only">Solo descenso de pasajeros</option>
                {stop && (
                  <>
                    <option value="general">Punto de encuentro</option>
                    <option value="official_boarding_zone">
                      Zona oficial de abordaje
                    </option>
                  </>
                )}
              </select>
            </div>
            <label className="admin-checkbox full">
              <input
                type="checkbox"
                name="active"
                checked={active}
                onChange={(event) => setActive(event.target.checked)}
              />
              Activa
            </label>
            {!stop && fields.corridorId && (
              <label className="admin-checkbox full">
                <input
                  type="checkbox"
                  checked={insertAtOrder}
                  onChange={(event) => setInsertAtOrder(event.target.checked)}
                />
                Insertar en esta posición y desplazar las paradas posteriores
                del catálogo.
              </label>
            )}
          </div>
          <p className="admin-description admin-small">
            {fields.stopType === 'dropoff_only'
              ? 'Se utilizará exclusivamente para bajar pasajeros, dentro de los viajes que incluyan esta parada. No se ofrecerá como punto de ascenso o encuentro.'
              : 'Conserva el uso actual de esta parada o revisa su tipo antes de cambiarlo.'}{' '}
            Los viajes publicados y sus reservas conservan sus puntos y su
            orden. Verifica en campo que sea posible detenerse.
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
          <button className="button" disabled={busy || loading} type="submit">
            {busy
              ? 'Guardando…'
              : loading
                ? 'Preparando datos…'
                : 'Guardar parada'}
          </button>
        </div>
      </form>
    </AdminDialog>
  );
}
