import { StrictMode } from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import StopsMap from './StopsMap';
import type { TransportStop } from '@/lib/transport-stops';
import { GOOGLE_MAPS_AUTH_FAILURE } from '@/lib/google-maps-browser';

const sdk = vi.hoisted(() => ({
  load: vi.fn(),
  search: vi.fn(),
  details: vi.fn(),
}));
vi.mock('@/lib/google-maps-browser', () => ({
  loadGoogleMaps: sdk.load,
  GOOGLE_MAPS_AUTH_FAILURE: 'krow:google-maps-auth-failure',
}));
class LatLng {
  constructor(public point: { lat: number; lng: number }) {}
  lat() {
    return this.point.lat;
  }
  lng() {
    return this.point.lng;
  }
}
let instances: FakeMap[];
class FakeMap {
  handlers = new Map<string, (event: unknown) => void>();
  center = new LatLng({ lat: 25.67, lng: -100.25 });
  zoom = 13;
  constructor(public element: HTMLElement) {
    instances.push(this);
  }
  addListener(name: string, handler: (event: unknown) => void) {
    this.handlers.set(name, handler);
    return { remove: () => this.handlers.delete(name) };
  }
  getCenter() {
    return this.center;
  }
  getZoom() {
    return this.zoom;
  }
  setZoom(zoom: number) {
    this.zoom = zoom;
  }
  fitBounds() {}
  panTo() {}
}
class Overlay {
  map: FakeMap | null = null;
  onAdd() {}
  draw() {}
  onRemove() {}
  setMap(map: FakeMap | null) {
    if (this.map) this.onRemove();
    this.map = map;
    if (map) {
      this.onAdd();
      this.draw();
    }
  }
  getPanes() {
    return { overlayMouseTarget: this.map!.element };
  }
  getProjection() {
    return { fromLatLngToDivPixel: () => ({ x: 80, y: 60 }) };
  }
  static preventMapHitsAndGesturesFrom() {}
}
class Bounds {
  extend() {}
  isEmpty() {
    return false;
  }
}
const candidate = {
  id: 'google-bus',
  displayName: 'Parada de camiones',
  formattedAddress: 'Avenida 123',
  location: new LatLng({ lat: 25.71, lng: -100.25 }),
  types: ['bus_stop'],
};
class Place {
  static searchNearby = sdk.search;
  constructor() {
    Object.assign(this, candidate);
  }
  fetchFields = sdk.details;
}
const maps = {
  Map: FakeMap,
  OverlayView: Overlay,
  LatLng,
  LatLngBounds: Bounds,
  TransitLayer: class {
    setMap() {}
  },
  event: {
    trigger() {},
    clearInstanceListeners() {},
    addListenerOnce: () => ({ remove() {} }),
  },
  importLibrary: vi.fn(async () => ({
    Place,
    SearchNearbyRankPreference: { DISTANCE: 'DISTANCE' },
  })),
};
const stops: TransportStop[] = [
  {
    stopId: 'one',
    name: 'Campus',
    externalId: 'CAMPUS',
    address: null,
    municipality: null,
    direction: null,
    latitude: 25.664,
    longitude: -100.243,
    active: true,
    stopType: 'general',
    corridorId: null,
    stopOrder: null,
  },
  {
    stopId: 'two',
    name: 'Avenida',
    externalId: 'AV',
    address: null,
    municipality: null,
    direction: null,
    latitude: 25.668,
    longitude: -100.233,
    active: false,
    stopType: 'general',
    corridorId: 'corridor',
    stopOrder: 2,
  },
];
const props = { stops, selectedId: null, draft: null, onSelect: vi.fn() };
const search = () =>
  screen.getByRole('button', { name: 'Buscar paradas en esta zona' });
async function ready() {
  await waitFor(() => expect(search()).toBeEnabled());
}

describe('Google stop map integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    instances = [];
    sdk.load.mockResolvedValue(maps);
    sdk.search.mockResolvedValue({ places: [candidate] });
    sdk.details.mockResolvedValue({});
  });
  it('renders valid KROW stops and preserves selection, inactive state and focus across updates', async () => {
    const onSelect = vi.fn();
    const view = render(
      <StopsMap
        {...props}
        onSelect={onSelect}
        stops={[
          ...stops,
          { ...stops[0], stopId: 'bad', name: 'Invalid', latitude: NaN },
        ]}
      />,
    );
    const active = await screen.findByRole('button', {
      name: 'Campus · Activa · KROW',
    });
    expect(
      screen.getByRole('button', { name: 'Avenida · Inactiva · KROW' }),
    ).toHaveClass('is-inactive');
    expect(
      screen.queryByRole('button', { name: /Invalid/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(active);
    expect(onSelect).toHaveBeenCalledWith('one');
    active.focus();
    view.rerender(
      <StopsMap
        {...props}
        onSelect={onSelect}
        selectedId="one"
        stops={[stops[0]]}
      />,
    );
    expect(active).toHaveAttribute('aria-pressed', 'true');
    expect(active).toHaveFocus();
    expect(
      screen.queryByRole('button', { name: /Avenida ·/ }),
    ).not.toBeInTheDocument();
  });
  it('places a custom point by map click or center without requiring a Google stop', async () => {
    const onPick = vi.fn();
    const view = render(<StopsMap {...props} onPick={onPick} />);
    await ready();
    fireEvent.click(
      screen.getByRole('button', { name: 'Usar centro del mapa' }),
    );
    expect(onPick).toHaveBeenLastCalledWith({
      latitude: 25.67,
      longitude: -100.25,
    });
    act(() =>
      instances[0].handlers.get('click')!({
        latLng: new LatLng({ lat: 25.72, lng: -100.28 }),
        stop() {},
      }),
    );
    expect(onPick).toHaveBeenLastCalledWith({
      latitude: 25.72,
      longitude: -100.28,
    });
    view.rerender(
      <StopsMap
        {...props}
        onPick={onPick}
        draft={{ latitude: 25.72, longitude: -100.28 }}
      />,
    );
    expect(
      view.container.querySelectorAll('.is-draft.admin-stop-marker'),
    ).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: 'Campus · Activa · KROW' }),
    ).toBeDisabled();
  });
  it('searches only on demand with bounded bus types, deduplicates references and selects a draft', async () => {
    const onReference = vi.fn();
    sdk.search.mockResolvedValue({ places: [candidate, candidate] });
    render(<StopsMap {...props} onReference={onReference} />);
    await ready();
    expect(sdk.search).not.toHaveBeenCalled();
    fireEvent.click(search());
    const reference = await screen.findByRole('button', {
      name: 'Parada de camiones · Referencia de Google',
    });
    expect(sdk.search).toHaveBeenCalledWith(
      expect.objectContaining({
        includedTypes: ['bus_stop', 'bus_station'],
        maxResultCount: 20,
        locationRestriction: { center: expect.any(LatLng), radius: 1500 },
      }),
    );
    expect(onReference).not.toHaveBeenCalled();
    fireEvent.click(reference);
    expect(onReference).toHaveBeenCalledWith({
      placeId: 'google-bus',
      name: 'Parada de camiones',
      address: 'Avenida 123',
      latitude: 25.71,
      longitude: -100.25,
    });
    expect(
      screen.getByText('Ver referencias de Google (1)'),
    ).toBeInTheDocument();
  });
  it('can select a bus POI from the Google basemap', async () => {
    const onReference = vi.fn();
    render(<StopsMap {...props} onReference={onReference} />);
    await ready();
    const stop = vi.fn();
    act(() =>
      instances[0].handlers.get('click')!({
        placeId: 'google-bus',
        latLng: candidate.location,
        stop,
      }),
    );
    await waitFor(() =>
      expect(onReference).toHaveBeenCalledWith(
        expect.objectContaining({ placeId: 'google-bus' }),
      ),
    );
    expect(stop).toHaveBeenCalledOnce();
    expect(sdk.details).toHaveBeenCalledOnce();
  });
  it('does not reopen a cancelled draft after a late POI response', async () => {
    let resolve!: () => void;
    sdk.details.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const onReference = vi.fn();
    const onPick = vi.fn();
    const view = render(
      <StopsMap {...props} onPick={onPick} onReference={onReference} />,
    );
    await ready();
    act(() =>
      instances[0].handlers.get('click')!({
        placeId: 'google-bus',
        latLng: candidate.location,
        stop() {},
      }),
    );
    await waitFor(() => expect(sdk.details).toHaveBeenCalledOnce());
    view.rerender(<StopsMap {...props} onReference={onReference} />);
    await act(async () => resolve());
    expect(onReference).not.toHaveBeenCalled();
  });

  it('keeps manual placement and registered stops usable when Places search fails', async () => {
    sdk.search.mockRejectedValue(new Error('REQUEST_DENIED'));
    const onPick = vi.fn();
    render(<StopsMap {...props} onPick={onPick} />);
    await ready();
    fireEvent.click(search());
    expect(
      await screen.findByText(/No pudimos consultar las paradas de Google/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Usar centro del mapa' }),
    );
    expect(onPick).toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Campus · Activa · KROW' }),
    ).toBeInTheDocument();
  });
  it('blocks broad searches and handles empty coverage honestly', async () => {
    sdk.search.mockResolvedValue({ places: [] });
    render(<StopsMap {...props} />);
    await ready();
    instances[0].zoom = 10;
    fireEvent.click(search());
    expect(sdk.search).not.toHaveBeenCalled();
    expect(screen.getByText(/Acerca el mapa/)).toBeInTheDocument();
    instances[0].zoom = 14;
    fireEvent.click(search());
    expect(
      await screen.findByText(/Google no devolvió paradas/),
    ).toBeInTheDocument();
  });
  it('recovers from loader failure and surfaces asynchronous authentication failures', async () => {
    sdk.load.mockRejectedValueOnce(new Error('missing-browser-key'));
    render(<StopsMap {...props} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Falta configurar la clave web',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar mapa' }));
    await ready();
    act(() => window.dispatchEvent(new Event(GOOGLE_MAPS_AUTH_FAILURE)));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Google Maps rechazó la clave web',
    );
    expect(search()).toBeDisabled();
  });
  it('ignores late responses after unmount and cleans StrictMode overlays safely', async () => {
    let resolve!: (value: unknown) => void;
    sdk.search.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const view = render(
      <StrictMode>
        <StopsMap
          {...props}
          stops={[{ ...stops[0], name: '<img src=x onerror=alert(1)>' }]}
        />
      </StrictMode>,
    );
    await ready();
    expect(view.container.querySelectorAll('.admin-stop-marker')).toHaveLength(
      1,
    );
    expect(view.container.querySelector('img')).not.toBeInTheDocument();
    fireEvent.click(search());
    await waitFor(() => expect(sdk.search).toHaveBeenCalledOnce());
    const element = instances[0].element;
    view.unmount();
    await act(async () => resolve({ places: [candidate] }));
    expect(element.children).toHaveLength(0);
    expect(instances[0].handlers.size).toBe(0);
  });
});
