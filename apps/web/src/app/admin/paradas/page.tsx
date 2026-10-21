'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AdminDialog,
  AdminHeader,
  Feedback,
  ListState,
  StatusBadge,
} from '@/components/admin/AdminUi';
import StopsMap from '@/components/admin/StopsMap';
import { StopEditor } from '@/components/admin/StopEditor';
import { useAdminApi, useAdminResource } from '@/lib/admin-api';
import { readableError } from '@/lib/admin-utils';
import type {
  GoogleStopReference,
  StopCoordinates,
  TransportCorridor,
  TransportStop,
} from '@/lib/transport-stops';
import { transportStopPayload } from '@/lib/transport-stops';
import './stops.css';

type Placement = {
  stop: TransportStop | null;
  coordinates: StopCoordinates | null;
  reference?: GoogleStopReference;
};

export default function StopsPage() {
  const request = useAdminApi();
  const stops = useAdminResource<TransportStop[]>('/admin/transport-stops');
  const corridors = useAdminResource<TransportCorridor[]>(
    '/admin/transport-stops/corridors',
  );
  const [editor, setEditor] = useState<Placement | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusTarget, setStatusTarget] = useState<TransportStop | null>(null);
  const [busy, setBusy] = useState(false);
  const savingStatus = useRef(false);
  const [statusError, setStatusError] = useState('');
  const [filter, setFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const visible = useMemo(
    () =>
      (stops.data ?? [])
        .filter(
          (stop) =>
            (!filter || stop.corridorId === filter) &&
            (!stateFilter || stop.active === (stateFilter === 'active')) &&
            `${stop.name} ${stop.address ?? ''} ${stop.externalId} ${stop.municipality ?? ''}`
              .toLocaleLowerCase()
              .includes(query.trim().toLocaleLowerCase()),
        )
        .sort(
          (a, b) =>
            (a.stopOrder ?? 0) - (b.stopOrder ?? 0) ||
            a.name.localeCompare(b.name),
        ),
    [stops.data, filter, stateFilter, query],
  );
  const selected = visible.find((stop) => stop.stopId === selectedId) ?? null;
  const unavailable =
    stops.loading || corridors.loading || !!stops.error || !!corridors.error;
  const pickLocation = useCallback((coordinates: StopCoordinates) => {
    setPlacement((current) =>
      current ? { ...current, coordinates, reference: undefined } : current,
    );
  }, []);
  const pickReference = useCallback((reference: GoogleStopReference) => {
    setPlacement({ stop: null, coordinates: reference, reference });
    setMessage('');
  }, []);
  useEffect(() => {
    const refresh = () => stops.reload();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [stops.reload]);

  async function changeStatus() {
    if (!statusTarget || savingStatus.current) return;
    savingStatus.current = true;
    setBusy(true);
    setStatusError('');
    try {
      // Preserve other administrators' recent edits when saving the required full payload.
      const current = (
        await request<TransportStop[]>('/admin/transport-stops')
      ).find((stop) => stop.stopId === statusTarget.stopId);
      if (!current)
        throw new Error(
          'La parada ya no está disponible. Actualiza el catálogo.',
        );
      const nextActive = !statusTarget.active;
      if (current.active !== nextActive)
        await request(`/admin/transport-stops/${current.stopId}`, {
          method: 'PATCH',
          body: transportStopPayload(current, nextActive),
        });
      setMessage(
        `Parada ${nextActive ? 'activada' : 'desactivada'} correctamente.`,
      );
      setStatusTarget(null);
      stops.reload();
    } catch (cause) {
      setStatusError(readableError(cause));
    } finally {
      savingStatus.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <AdminHeader
        title="Paradas"
        description="Gestiona los puntos de encuentro desde el mapa. Los viajes publicados conservan sus coordenadas."
        action={
          <button
            className="button"
            disabled={unavailable || !!placement}
            onClick={() => {
              setPlacement({ stop: null, coordinates: null });
              setMessage('');
            }}
          >
            Agregar parada
          </button>
        }
      />
      <Feedback message={message} />
      <section
        className="card admin-stops-catalog"
        aria-label="Catálogo de paradas"
        aria-busy={stops.loading}
      >
        <div className="admin-toolbar">
          <div className="field">
            <label htmlFor="stops-search">Buscar parada</label>
            <input
              id="stops-search"
              type="search"
              placeholder="Nombre, dirección o identificador"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="stops-corridor">Avenida</label>
            <select
              id="stops-corridor"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option value="">Todas</option>
              {corridors.data?.map((corridor) => (
                <option key={corridor.corridorId} value={corridor.corridorId}>
                  {corridor.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="stops-state">Estado</label>
            <select
              id="stops-state"
              value={stateFilter}
              onChange={(event) => setStateFilter(event.target.value)}
            >
              <option value="">Todas</option>
              <option value="active">Activas</option>
              <option value="inactive">Inactivas</option>
            </select>
          </div>
          <button
            className="button secondary"
            disabled={stops.loading || busy}
            onClick={() => {
              stops.reload();
              corridors.reload();
            }}
          >
            Actualizar
          </button>
        </div>
        <ListState
          loading={stops.loading || corridors.loading}
          error={stops.error || corridors.error}
          empty={!visible.length}
          reload={() => {
            stops.reload();
            corridors.reload();
          }}
        >
          <div className="admin-stops-workspace">
            <StopsMap
              stops={visible}
              selectedId={selected?.stopId ?? null}
              draft={placement?.coordinates ?? null}
              onSelect={setSelectedId}
              onPick={placement ? pickLocation : undefined}
              onReference={placement?.stop ? undefined : pickReference}
              disabled={unavailable || busy || !!editor || !!statusTarget}
            />
            <aside
              className="admin-stop-detail"
              aria-label={
                placement ? 'Ubicación de la parada' : 'Detalle de la parada'
              }
            >
              {placement ? (
                <>
                  <p className="eyebrow">
                    {placement.stop ? 'Cambiar ubicación' : 'Nueva parada'}
                  </p>
                  <h2>
                    {placement.stop?.name ??
                      placement.reference?.name ??
                      'Elige un punto en el mapa'}
                  </h2>
                  {placement.reference && (
                    <p className="admin-stop-location-note">
                      Referencia de Google ·{' '}
                      {placement.reference.address ||
                        'Sin dirección disponible'}
                      . Revisa la ubicación y los datos antes de registrarla en
                      KROW.
                    </p>
                  )}
                  <p className="admin-description">
                    {placement.coordinates
                      ? 'Puedes tocar otro punto para ajustar la ubicación. Todavía no se ha guardado.'
                      : 'Acerca el mapa y selecciona el lugar exacto donde se detendrá el vehículo.'}
                  </p>
                  {placement.coordinates && (
                    <Coordinates point={placement.coordinates} />
                  )}
                  <div className="admin-stop-actions">
                    <button
                      className="button"
                      disabled={!placement.coordinates || unavailable}
                      onClick={() => setEditor(placement)}
                    >
                      Continuar con los datos
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => setPlacement(null)}
                    >
                      Cancelar selección
                    </button>
                    <button
                      className="admin-text-button"
                      disabled={unavailable}
                      onClick={() => setEditor(placement)}
                    >
                      Ingresar coordenadas manualmente
                    </button>
                  </div>
                </>
              ) : selected ? (
                <>
                  <p className="eyebrow">Parada seleccionada</p>
                  <h2 id="stop-detail-title">{selected.name}</h2>
                  <StatusBadge
                    status={selected.active ? 'active' : 'inactive'}
                  />
                  <p className="admin-description">
                    {selected.address || 'Sin dirección registrada'}
                  </p>
                  <dl className="admin-detail-list">
                    <div>
                      <dt>Identificador</dt>
                      <dd>{selected.externalId}</dd>
                    </div>
                    <div>
                      <dt>Avenida / sentido</dt>
                      <dd>
                        {corridors.data?.find(
                          (corridor) =>
                            corridor.corridorId === selected.corridorId,
                        )?.name ?? 'Punto general / campus'}
                        {selected.direction ? ` · ${selected.direction}` : ''}
                      </dd>
                    </div>
                    <div>
                      <dt>Orden / tipo</dt>
                      <dd>
                        {selected.stopOrder ?? 'Sin orden'} ·{' '}
                        {selected.stopType === 'dropoff_only'
                          ? 'Solo descenso de pasajeros'
                          : selected.stopType === 'official_boarding_zone'
                            ? 'Zona oficial de abordaje'
                            : 'Punto de encuentro'}
                      </dd>
                    </div>
                    {selected.municipality && (
                      <div>
                        <dt>Municipio</dt>
                        <dd>{selected.municipality}</dd>
                      </div>
                    )}
                  </dl>
                  <Coordinates point={selected} />
                  <div className="admin-stop-actions">
                    <button
                      className="button"
                      disabled={unavailable}
                      onClick={() =>
                        setEditor({ stop: selected, coordinates: null })
                      }
                    >
                      Editar información
                    </button>
                    <button
                      className="button secondary"
                      disabled={unavailable}
                      onClick={() =>
                        setPlacement({
                          stop: selected,
                          coordinates: {
                            latitude: selected.latitude,
                            longitude: selected.longitude,
                          },
                        })
                      }
                    >
                      Cambiar ubicación en el mapa
                    </button>
                    <button
                      className={`button secondary${selected.active ? ' admin-stop-deactivate' : ''}`}
                      disabled={unavailable}
                      onClick={() => {
                        setStatusError('');
                        setStatusTarget(selected);
                      }}
                    >
                      {selected.active ? 'Desactivar parada' : 'Activar parada'}
                    </button>
                  </div>
                  <p className="admin-description admin-small">
                    {selected.active
                      ? selected.stopType === 'dropoff_only'
                        ? 'Disponible exclusivamente para descenso en los viajes que la incluyan. No permite ascensos.'
                        : 'Disponible para nuevas selecciones. Las reservas pendientes protegen su desactivación.'
                      : 'No se ofrece en nuevas selecciones de la app móvil.'}
                  </p>
                </>
              ) : (
                <div className="admin-stop-detail-empty">
                  <span className="admin-stop-empty-icon" aria-hidden="true">
                    ◎
                  </span>
                  <h2>Una vista de tus paradas</h2>
                  <p className="admin-description">
                    Selecciona un marcador o una fila del listado para consultar
                    sus datos y administrar su estado. Busca las paradas de
                    autobús de Google para agregar una referencia, o usa
                    «Agregar parada» para elegir cualquier otro punto.
                  </p>
                  <small>{visible.length} paradas en esta vista</small>
                </div>
              )}
            </aside>
          </div>
          <p className="admin-stops-count" role="status">
            {placement
              ? 'Seleccionando una ubicación sin guardar.'
              : selected
                ? `Parada seleccionada: ${selected.name}. ${selected.active ? 'Activa' : 'Inactiva'}.`
                : `${visible.length} paradas visibles en el mapa y el listado.`}
          </p>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Parada</th>
                  <th>Avenida / sentido</th>
                  <th>Orden</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((stop) => (
                  <tr
                    key={stop.stopId}
                    className={
                      selected?.stopId === stop.stopId
                        ? 'admin-stop-row-selected'
                        : undefined
                    }
                  >
                    <td>
                      <button
                        className="admin-text-button"
                        disabled={!!placement || unavailable}
                        onClick={() => setSelectedId(stop.stopId)}
                        aria-label={`Ver ${stop.name} en el mapa`}
                        aria-pressed={selected?.stopId === stop.stopId}
                      >
                        {stop.name}
                      </button>
                      <p>{stop.address}</p>
                      <small>
                        {stop.latitude.toFixed(6)}, {stop.longitude.toFixed(6)}
                      </small>
                    </td>
                    <td>
                      {corridors.data?.find(
                        (corridor) => corridor.corridorId === stop.corridorId,
                      )?.name ?? 'Sin avenida'}
                      <p>{stop.direction}</p>
                    </td>
                    <td>{stop.stopOrder ?? '—'}</td>
                    <td>
                      <StatusBadge
                        status={stop.active ? 'active' : 'inactive'}
                      />
                    </td>
                    <td>
                      <button
                        className="button secondary"
                        disabled={!!placement || unavailable}
                        onClick={() => setEditor({ stop, coordinates: null })}
                        aria-label={`Editar ${stop.name}`}
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ListState>
      </section>
      {editor && (
        <StopEditor
          stop={editor.stop}
          coordinates={editor.coordinates}
          reference={editor.reference}
          corridors={corridors.data ?? []}
          onClose={() => setEditor(null)}
          onSaved={(id) => {
            setMessage('Parada guardada correctamente.');
            setEditor(null);
            setPlacement(null);
            setSelectedId(id);
            setFilter('');
            setStateFilter('');
            setQuery('');
            stops.reload();
          }}
        />
      )}
      {statusTarget && (
        <AdminDialog
          title={statusTarget.active ? 'Desactivar parada' : 'Activar parada'}
          onClose={() => setStatusTarget(null)}
          busy={busy}
        >
          <Feedback error={statusError} />
          <p>
            <strong>{statusTarget.name}</strong>
          </p>
          <p>
            {statusTarget.active
              ? 'Dejará de ofrecerse para nuevas selecciones en la app móvil. Los viajes publicados conservan sus coordenadas. Si hay reservas pendientes, el sistema impedirá la desactivación.'
              : 'Volverá a estar disponible para nuevas selecciones en la app móvil, según su avenida y configuración actuales.'}
          </p>
          <div className="admin-form-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setStatusTarget(null)}
            >
              Cancelar
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() => void changeStatus()}
            >
              {busy
                ? 'Guardando…'
                : statusTarget.active
                  ? 'Confirmar desactivación'
                  : 'Confirmar activación'}
            </button>
          </div>
        </AdminDialog>
      )}
    </>
  );
}

function Coordinates({ point }: { point: StopCoordinates }) {
  return (
    <dl className="admin-stop-coordinates">
      <div>
        <dt>Latitud</dt>
        <dd>{point.latitude.toFixed(6)}</dd>
      </div>
      <div>
        <dt>Longitud</dt>
        <dd>{point.longitude.toFixed(6)}</dd>
      </div>
    </dl>
  );
}
