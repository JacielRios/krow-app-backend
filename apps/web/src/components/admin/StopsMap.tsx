'use client';

import { useEffect, useRef, useState } from 'react';
import {
  GOOGLE_MAPS_AUTH_FAILURE,
  loadGoogleMaps,
} from '@/lib/google-maps-browser';
import type {
  GoogleStopReference,
  StopCoordinates,
  TransportStop,
} from '@/lib/transport-stops';
import { validStopCoordinates } from '@/lib/transport-stops';

interface Props {
  stops: TransportStop[];
  selectedId: string | null;
  draft: StopCoordinates | null;
  onSelect: (id: string) => void;
  onPick?: (point: StopCoordinates) => void;
  onReference?: (reference: GoogleStopReference) => void;
  disabled?: boolean;
}
const position = (point: StopCoordinates) => ({
  lat: point.latitude,
  lng: point.longitude,
});
const coordinates = (point: google.maps.LatLng): StopCoordinates => ({
  latitude: Number(point.lat().toFixed(6)),
  longitude: Number(point.lng().toFixed(6)),
});
const busTypes = ['bus_stop', 'bus_station'];

/** DOM overlays retain native accessible controls without requiring a cloud Map ID. */
function createPin(
  maps: typeof google.maps,
  map: google.maps.Map,
  point: StopCoordinates,
  element: HTMLElement,
) {
  class Pin extends maps.OverlayView {
    point = point;
    onAdd() {
      this.getPanes()?.overlayMouseTarget.appendChild(element);
      maps.OverlayView.preventMapHitsAndGesturesFrom(element);
    }
    draw() {
      // Google attaches overlays asynchronously; projection is absent before onAdd.
      const projection = this.getProjection();
      if (!projection) return;
      const pixel = projection.fromLatLngToDivPixel(
        new maps.LatLng(position(this.point)),
      );
      if (pixel) {
        element.style.left = `${pixel.x}px`;
        element.style.top = `${pixel.y}px`;
      }
    }
    onRemove() {
      element.remove();
    }
  }
  const pin = new Pin();
  pin.setMap(map);
  return pin;
}
type Pin = ReturnType<typeof createPin>;
type Entry = { pin: Pin; button: HTMLButtonElement; label: HTMLElement };
function asReference(
  place: google.maps.places.Place,
): GoogleStopReference | null {
  if (!place.location) return null;
  const point = coordinates(place.location);
  return validStopCoordinates(point)
    ? {
        ...point,
        placeId: place.id,
        name: place.displayName || 'Parada de autobús',
        address: place.formattedAddress || '',
      }
    : null;
}

export default function StopsMap({
  stops,
  selectedId,
  draft,
  onSelect,
  onPick,
  onReference,
  disabled = false,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const library = useRef<typeof google.maps | null>(null);
  const markers = useRef(new Map<string, Entry>());
  const handlers = useRef({ onSelect, onPick, onReference, disabled });
  const fitted = useRef('');
  const generation = useRef(0);
  const pendingQuery = useRef(false);
  const [ready, setReady] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState('');
  const [references, setReferences] = useState<GoogleStopReference[]>([]);
  useEffect(() => {
    handlers.current = { onSelect, onPick, onReference, disabled };
  }, [onSelect, onPick, onReference, disabled]);

  async function queryGoogle(placeId?: string) {
    if (
      pendingQuery.current ||
      !map.current ||
      !library.current ||
      handlers.current.disabled
    )
      return;
    if (!placeId && (map.current.getZoom() ?? 0) < 13) {
      setNotice(
        'Acerca el mapa para buscar paradas de autobús en una zona más pequeña.',
      );
      return;
    }
    const center = map.current.getCenter();
    if (!center) return;
    const version = generation.current;
    const selectionMode = handlers.current.onPick;
    pendingQuery.current = true;
    setSearching(true);
    setNotice('');
    try {
      const { Place, SearchNearbyRankPreference } =
        (await library.current.importLibrary(
          'places',
        )) as google.maps.PlacesLibrary;
      if (version !== generation.current) return;
      if (placeId) {
        const place = new Place({ id: placeId, requestedLanguage: 'es' });
        await place.fetchFields({
          fields: [
            'id',
            'displayName',
            'formattedAddress',
            'location',
            'types',
          ],
        });
        if (
          version !== generation.current ||
          handlers.current.disabled ||
          handlers.current.onPick !== selectionMode
        )
          return;
        const reference = asReference(place);
        if (reference && place.types?.some((type) => busTypes.includes(type)))
          handlers.current.onReference?.(reference);
        else
          setNotice(
            'Ese lugar no figura como parada de autobús en Google. Puedes agregar un punto propio con «Agregar parada».',
          );
      } else {
        const result = await Place.searchNearby({
          fields: ['id', 'displayName', 'formattedAddress', 'location'],
          locationRestriction: { center, radius: 1500 },
          includedTypes: busTypes,
          maxResultCount: 20,
          rankPreference: SearchNearbyRankPreference.DISTANCE,
          language: 'es',
          region: 'mx',
        });
        if (version !== generation.current) return;
        const unique = new Map<string, GoogleStopReference>();
        for (const place of result.places) {
          const reference = asReference(place);
          if (reference) unique.set(reference.placeId, reference);
        }
        setReferences([...unique.values()]);
        setNotice(
          unique.size
            ? `${unique.size} referencias de Google a 1.5 km del centro. Selecciona una para revisar sus datos.`
            : 'Google no devolvió paradas en esta zona. Puedes mover el mapa o agregar un punto propio.',
        );
      }
    } catch {
      if (version === generation.current)
        setNotice(
          'No pudimos consultar las paradas de Google. Revisa la conexión, Places API (New) y los permisos de la clave web. Puedes agregar un punto propio.',
        );
    } finally {
      if (version === generation.current) {
        pendingQuery.current = false;
        setSearching(false);
      }
    }
  }

  useEffect(() => {
    let disposed = false;
    let instance: google.maps.Map | null = null;
    let transit: google.maps.TransitLayer | undefined;
    let listener: google.maps.MapsEventListener | undefined;
    let observer: ResizeObserver | undefined;
    const authFailure = () => {
      if (!disposed)
        setError(
          'Google Maps rechazó la clave web. Revisa las APIs habilitadas y los dominios permitidos.',
        );
    };
    window.addEventListener(GOOGLE_MAPS_AUTH_FAILURE, authFailure);
    setLoading(true);
    setError('');
    setReferences([]);
    setNotice('');
    setSearching(false);
    void loadGoogleMaps()
      .then((maps) => {
        if (disposed || !container.current) return;
        library.current = maps;
        instance = new maps.Map(container.current, {
          center: { lat: 25.67, lng: -100.25 },
          zoom: 13,
          minZoom: 3,
          maxZoom: 20,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          gestureHandling: 'cooperative',
          clickableIcons: true,
          styles: [
            { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
            {
              featureType: 'transit.station.bus',
              stylers: [{ visibility: 'on' }],
            },
          ],
        });
        map.current = instance;
        transit = new maps.TransitLayer();
        transit.setMap(instance);
        listener = instance.addListener(
          'click',
          (event: google.maps.MapMouseEvent | google.maps.IconMouseEvent) => {
            const current = handlers.current;
            if (current.disabled || !event.latLng) return;
            if ('placeId' in event && event.placeId && current.onReference) {
              event.stop();
              void queryGoogle(event.placeId);
            } else if (current.onPick) {
              event.stop();
              current.onPick(coordinates(event.latLng));
            }
          },
        );
        if (typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(() => {
            if (instance) maps.event.trigger(instance, 'resize');
          });
          observer.observe(container.current);
        }
        fitted.current = '';
        setReady((value) => value + 1);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (!disposed) {
          setError(
            cause instanceof Error && cause.message === 'missing-browser-key'
              ? 'Falta configurar la clave web de Google Maps. Puedes seguir usando el listado y las coordenadas manuales.'
              : 'No pudimos cargar Google Maps. Revisa la conexión o usa el listado y las coordenadas manuales.',
          );
          setLoading(false);
        }
      });
    return () => {
      disposed = true;
      generation.current++;
      pendingQuery.current = false;
      window.removeEventListener(GOOGLE_MAPS_AUTH_FAILURE, authFailure);
      observer?.disconnect();
      listener?.remove();
      transit?.setMap(null);
      for (const entry of markers.current.values()) entry.pin.setMap(null);
      markers.current.clear();
      if (instance) library.current?.event.clearInstanceListeners(instance);
      container.current?.replaceChildren();
      map.current = null;
      library.current = null;
    };
  }, [attempt]);

  useEffect(() => {
    const maps = library.current;
    const instance = map.current;
    if (!maps || !instance) return;
    const valid = stops.filter(validStopCoordinates);
    const ids = new Set(valid.map((stop) => stop.stopId));
    for (const [id, entry] of markers.current)
      if (!ids.has(id)) {
        entry.pin.setMap(null);
        markers.current.delete(id);
      }
    for (const stop of valid) {
      let entry = markers.current.get(stop.stopId);
      if (!entry) {
        const button = document.createElement('button');
        button.type = 'button';
        const label = document.createElement('span');
        label.className = 'admin-map-pin';
        label.setAttribute('aria-hidden', 'true');
        button.appendChild(label);
        button.addEventListener('click', () => {
          const current = handlers.current;
          if (!current.disabled && !current.onPick)
            current.onSelect(stop.stopId);
        });
        entry = { button, label, pin: createPin(maps, instance, stop, button) };
        markers.current.set(stop.stopId, entry);
      }
      entry.pin.point = stop;
      entry.pin.draw();
      entry.button.className = `admin-stop-marker${stop.active ? '' : ' is-inactive'}${stop.stopId === selectedId ? ' is-selected' : ''}`;
      entry.button.style.zIndex = stop.stopId === selectedId ? '3' : '2';
      entry.button.disabled = disabled || !!onPick;
      entry.button.setAttribute(
        'aria-pressed',
        String(stop.stopId === selectedId),
      );
      entry.button.title = `${stop.name} · ${stop.active ? 'Activa' : 'Inactiva'} · KROW`;
      entry.button.setAttribute('aria-label', entry.button.title);
      entry.label.textContent = String(
        stop.stopOrder ?? (stop.active ? '•' : '−'),
      );
    }
    const geometry = valid
      .map((stop) => `${stop.stopId}:${stop.latitude}:${stop.longitude}`)
      .sort()
      .join('|');
    if (valid.length && geometry !== fitted.current) {
      const bounds = new maps.LatLngBounds();
      valid.forEach((stop) => bounds.extend(position(stop)));
      instance.fitBounds(bounds, 45);
      const listener = maps.event.addListenerOnce(instance, 'idle', () => {
        if ((instance.getZoom() ?? 0) > 16) instance.setZoom(16);
      });
      fitted.current = geometry;
      return () => listener.remove();
    }
  }, [stops, selectedId, ready, disabled, onPick]);

  useEffect(() => {
    const stop = stops.find((item) => item.stopId === selectedId);
    if (stop && validStopCoordinates(stop)) map.current?.panTo(position(stop));
  }, [selectedId, stops, ready]);
  useEffect(() => {
    if (
      !draft ||
      !validStopCoordinates(draft) ||
      !library.current ||
      !map.current
    )
      return;
    const element = document.createElement('span');
    element.className = 'admin-stop-marker is-draft';
    element.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'admin-map-pin';
    label.textContent = '+';
    element.appendChild(label);
    element.style.zIndex = '4';
    const pin = createPin(library.current, map.current, draft, element);
    map.current.panTo(position(draft));
    return () => pin.setMap(null);
  }, [draft, ready]);
  useEffect(() => {
    if (!library.current || !map.current) return;
    const pins = references.map((reference) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'admin-stop-marker is-google';
      button.title = `${reference.name} · Referencia de Google`;
      button.setAttribute('aria-label', button.title);
      button.disabled = disabled || !onReference;
      const label = document.createElement('span');
      label.className = 'admin-map-pin';
      label.textContent = 'G';
      label.setAttribute('aria-hidden', 'true');
      button.appendChild(label);
      button.addEventListener('click', () => {
        const current = handlers.current;
        if (!current.disabled) current.onReference?.(reference);
      });
      return createPin(library.current!, map.current!, reference, button);
    });
    return () => pins.forEach((pin) => pin.setMap(null));
  }, [references, ready, disabled, onReference]);

  return (
    <div className="admin-stops-map-wrap">
      <div className="admin-map-tools">
        <span id="stop-map-instructions">
          {onPick
            ? 'Elige una parada de Google o toca cualquier punto. También puedes usar el centro del mapa.'
            : 'Selecciona una parada KROW o busca paradas de autobús de Google para agregarlas.'}
        </span>
        <div className="admin-row">
          <button
            type="button"
            className="button secondary"
            disabled={loading || !!error || disabled || searching}
            onClick={() => void queryGoogle()}
          >
            {searching ? 'Consultando Google…' : 'Buscar paradas en esta zona'}
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={loading || !!error || !stops.length}
            onClick={() => {
              if (!library.current || !map.current) return;
              const bounds = new library.current.LatLngBounds();
              stops
                .filter(validStopCoordinates)
                .forEach((stop) => bounds.extend(position(stop)));
              if (!bounds.isEmpty()) map.current.fitBounds(bounds, 45);
            }}
          >
            Ver KROW
          </button>
          {onPick && (
            <button
              type="button"
              className="button"
              disabled={loading || disabled || !!error}
              onClick={() => {
                const center = map.current?.getCenter();
                if (center) onPick(coordinates(center));
              }}
            >
              Usar centro del mapa
            </button>
          )}
        </div>
      </div>
      <div className={`admin-stops-map${onPick ? ' is-picking' : ''}`}>
        <div
          ref={container}
          className="admin-stops-map-canvas"
          role="region"
          aria-label="Google Maps: paradas de KROW y transporte público"
          aria-describedby="stop-map-instructions"
        />
        {loading && !error && (
          <p className="admin-map-overlay" role="status">
            Cargando Google Maps…
          </p>
        )}
        {onPick && !error && (
          <span className="admin-map-crosshair" aria-hidden="true">
            +
          </span>
        )}
        {error && (
          <div className="admin-map-overlay" role="alert">
            <p>{error}</p>
            <button
              className="button secondary"
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Reintentar mapa
            </button>
          </div>
        )}
      </div>
      {notice && (
        <p className="admin-map-notice" role="status">
          {notice}
        </p>
      )}
      <div className="admin-map-legend" aria-label="Leyenda del mapa">
        <span>
          <i className="admin-map-dot" />
          KROW activa
        </span>
        <span>
          <i className="admin-map-dot is-inactive" />
          KROW inactiva
        </span>
        <span>
          <i className="admin-map-dot is-google" />
          Referencia de Google
        </span>
        {onPick && (
          <span>
            <i className="admin-map-dot is-draft" />
            Ubicación sin guardar
          </span>
        )}
        <small>
          Google muestra referencias según su cobertura; no son registros de
          KROW. Busca hasta 20 paradas a 1.5 km del centro o crea una ubicación
          propia.
        </small>
      </div>
      {!!references.length && (
        <details className="admin-google-results">
          <summary>Ver referencias de Google ({references.length})</summary>
          <ul>
            {references.map((reference) => (
              <li key={reference.placeId}>
                <button
                  type="button"
                  className="admin-text-button"
                  disabled={disabled || !onReference}
                  onClick={() => onReference?.(reference)}
                >
                  {reference.name}
                </button>
                <small>{reference.address}</small>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
