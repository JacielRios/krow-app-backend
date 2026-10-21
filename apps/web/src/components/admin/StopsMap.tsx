'use client';

import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { StopCoordinates, TransportStop } from '@/lib/transport-stops';
import { validStopCoordinates } from '@/lib/transport-stops';

interface Props {
  stops: TransportStop[];
  selectedId: string | null;
  draft: StopCoordinates | null;
  onSelect: (id: string) => void;
  onPick?: (point: StopCoordinates) => void;
  disabled?: boolean;
}
type MarkerEntry = {
  marker: Leaflet.Marker;
  label: HTMLElement;
  tooltip: HTMLElement;
};

export default function StopsMap({
  stops,
  selectedId,
  draft,
  onSelect,
  onPick,
  disabled = false,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const library = useRef<typeof Leaflet | null>(null);
  const markers = useRef(new Map<string, MarkerEntry>());
  const draftMarker = useRef<Leaflet.Marker | null>(null);
  const handlers = useRef({ onSelect, onPick, disabled });
  const fittedGeometry = useRef('');
  const [ready, setReady] = useState(0);
  const [mapLoading, setMapLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState(false);
  const [tileError, setTileError] = useState(false);

  useEffect(() => {
    handlers.current = { onSelect, onPick, disabled };
  }, [onSelect, onPick, disabled]);

  useEffect(() => {
    let disposed = false;
    let instance: Leaflet.Map | null = null;
    let observer: ResizeObserver | undefined;
    setError(false);
    setTileError(false);
    setMapLoading(true);
    // Leaflet reads window at import time; never evaluate it during Next.js SSR.
    void import('leaflet')
      .then((L) => {
        if (disposed || !container.current) return;
        library.current = L;
        instance = L.map(container.current, {
          scrollWheelZoom: false,
          zoomControl: false,
          zoomAnimation: !window.matchMedia?.(
            '(prefers-reduced-motion: reduce)',
          ).matches,
          maxBounds: [
            [-85, -180],
            [85, 180],
          ],
          maxBoundsViscosity: 1,
        }).setView([25.67, -100.25], 12);
        map.current = instance;
        L.control
          .zoom({
            position: 'topright',
            zoomInTitle: 'Acercar',
            zoomOutTitle: 'Alejar',
          })
          .addTo(instance);
        // Attribution remains visible; browser caching/referrer use their normal defaults.
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        })
          .on('tileerror', () => {
            if (!disposed) setTileError(true);
          })
          .on('tileload', () => {
            if (!disposed) setTileError(false);
          })
          .addTo(instance);
        instance.on('click', (event: Leaflet.LeafletMouseEvent) => {
          if (!handlers.current.disabled)
            handlers.current.onPick?.({
              latitude: Number(event.latlng.lat.toFixed(6)),
              longitude: Number(event.latlng.wrap().lng.toFixed(6)),
            });
        });
        if (typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(() => instance?.invalidateSize());
          observer.observe(container.current);
        }
        fittedGeometry.current = '';
        setMapLoading(false);
        setReady((value) => value + 1);
      })
      .catch(() => {
        if (!disposed) {
          setError(true);
          setMapLoading(false);
        }
      });
    return () => {
      disposed = true;
      observer?.disconnect();
      instance?.remove();
      map.current = null;
      library.current = null;
      markers.current.clear();
      draftMarker.current = null;
    };
  }, [attempt]);

  useEffect(() => {
    const L = library.current;
    const instance = map.current;
    if (!L || !instance) return;
    const valid = stops.filter(validStopCoordinates);
    const ids = new Set(valid.map((stop) => stop.stopId));
    for (const [id, entry] of markers.current) {
      if (!ids.has(id)) {
        entry.marker.remove();
        markers.current.delete(id);
      }
    }
    for (const stop of valid) {
      let entry = markers.current.get(stop.stopId);
      if (!entry) {
        const label = document.createElement('span');
        label.className = 'admin-map-pin';
        label.setAttribute('aria-hidden', 'true');
        const tooltip = document.createElement('span');
        const marker = L.marker([stop.latitude, stop.longitude], {
          icon: L.divIcon({
            html: label,
            className: 'admin-stop-marker',
            iconSize: [44, 44],
            iconAnchor: [22, 22],
          }),
          keyboard: true,
          riseOnHover: true,
        })
          .addTo(instance)
          .bindTooltip(tooltip, { direction: 'top', offset: [0, -20] });
        marker.on('click', () => {
          const current = handlers.current;
          if (!current.onPick && !current.disabled)
            current.onSelect(stop.stopId);
        });
        marker.getElement()?.addEventListener('keydown', (event) => {
          if (event.key === ' ') {
            event.preventDefault();
            marker.fire('click');
          }
        });
        entry = { marker, label, tooltip };
        markers.current.set(stop.stopId, entry);
      }
      entry.marker.setLatLng([stop.latitude, stop.longitude]);
      entry.marker.setZIndexOffset(stop.stopId === selectedId ? 1000 : 0);
      entry.label.textContent = String(
        stop.stopOrder ?? (stop.active ? '•' : '−'),
      );
      const title = `${stop.name} · ${stop.active ? 'Activa' : 'Inactiva'}`;
      entry.tooltip.textContent = title;
      const element = entry.marker.getElement();
      if (element) {
        element.classList.toggle('is-inactive', !stop.active);
        element.classList.toggle('is-selected', stop.stopId === selectedId);
        element.setAttribute('aria-label', title);
        element.setAttribute(
          'aria-pressed',
          String(stop.stopId === selectedId),
        );
        element.setAttribute('aria-disabled', String(disabled || !!onPick));
        element.tabIndex = disabled || onPick ? -1 : 0;
        element.title = title;
      }
    }
    const geometry = valid
      .map((stop) => `${stop.stopId}:${stop.latitude}:${stop.longitude}`)
      .sort()
      .join('|');
    if (valid.length && geometry !== fittedGeometry.current) {
      instance.fitBounds(
        valid.map(
          (stop) => [stop.latitude, stop.longitude] as Leaflet.LatLngTuple,
        ),
        { padding: [40, 40], maxZoom: 16, animate: false },
      );
      fittedGeometry.current = geometry;
    }
  }, [stops, selectedId, ready, disabled, onPick]);

  useEffect(() => {
    const stop = stops.find((item) => item.stopId === selectedId);
    if (stop && validStopCoordinates(stop) && map.current)
      map.current.panTo([stop.latitude, stop.longitude], { animate: false });
  }, [selectedId, stops, ready]);

  useEffect(() => {
    draftMarker.current?.remove();
    draftMarker.current = null;
    if (
      !draft ||
      !validStopCoordinates(draft) ||
      !library.current ||
      !map.current
    )
      return;
    const label = document.createElement('span');
    label.className = 'admin-map-pin';
    label.textContent = '+';
    draftMarker.current = library.current
      .marker([draft.latitude, draft.longitude], {
        icon: library.current.divIcon({
          html: label,
          className: 'admin-stop-marker is-draft',
          iconSize: [44, 44],
          iconAnchor: [22, 22],
        }),
        interactive: false,
        keyboard: false,
        zIndexOffset: 2000,
      })
      .addTo(map.current);
    draftMarker.current.getElement()?.setAttribute('aria-hidden', 'true');
  }, [draft, ready]);

  function fitAll() {
    const valid = stops.filter(validStopCoordinates);
    if (valid.length)
      map.current?.fitBounds(
        valid.map(
          (stop) => [stop.latitude, stop.longitude] as Leaflet.LatLngTuple,
        ),
        { padding: [40, 40], maxZoom: 16, animate: false },
      );
  }
  return (
    <div className="admin-stops-map-wrap">
      <div className="admin-map-tools">
        <span id="stop-map-instructions">
          {onPick
            ? 'Toca el mapa para colocar el punto, o desplázalo y usa su centro.'
            : 'Selecciona un marcador para consultar la parada.'}
        </span>
        <div className="admin-row">
          <button
            type="button"
            className="button secondary"
            disabled={mapLoading || !stops.length || error}
            onClick={fitAll}
          >
            Ver todas
          </button>
          {onPick && (
            <button
              type="button"
              className="button"
              disabled={mapLoading || disabled || error}
              onClick={() => {
                const center = map.current?.getCenter();
                if (center)
                  onPick({
                    latitude: Number(center.lat.toFixed(6)),
                    longitude: Number(center.wrap().lng.toFixed(6)),
                  });
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
          aria-label="Mapa de paradas registradas"
          aria-describedby="stop-map-instructions"
        />
        {mapLoading && !error && (
          <p className="admin-map-overlay" role="status">
            Cargando mapa…
          </p>
        )}
        {onPick && !error && (
          <span className="admin-map-crosshair" aria-hidden="true">
            +
          </span>
        )}
        {error && (
          <div className="admin-map-overlay" role="alert">
            <p>
              No pudimos cargar el mapa. Puedes usar el listado o ingresar
              coordenadas.
            </p>
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
      {tileError && (
        <p className="admin-map-notice" role="status">
          El mapa base no está disponible. Las paradas siguen visibles; también
          puedes usar el listado.{' '}
          <button
            type="button"
            className="admin-text-button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Recargar mapa base
          </button>
        </p>
      )}
      <div className="admin-map-legend" aria-label="Leyenda del mapa">
        <span>
          <i className="admin-map-dot" />
          Activa
        </span>
        <span>
          <i className="admin-map-dot is-inactive" />
          Inactiva
        </span>
        {onPick && (
          <span>
            <i className="admin-map-dot is-draft" />
            Ubicación sin guardar
          </span>
        )}
        <small>Solo los marcadores de KROW se pueden administrar.</small>
      </div>
    </div>
  );
}
