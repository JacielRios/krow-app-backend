import { StrictMode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import StopsMap from './StopsMap';
import type { TransportStop } from '@/lib/transport-stops';

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

describe('real Leaflet stop map', () => {
  it('renders only valid registered stops, distinguishes state and supports click/keyboard', async () => {
    const onSelect = vi.fn();
    render(
      <StopsMap
        {...props}
        onSelect={onSelect}
        stops={[
          ...stops,
          { ...stops[0], stopId: 'invalid', name: 'Invalid', latitude: NaN },
        ]}
      />,
    );
    const active = await screen.findByRole('button', {
      name: 'Campus · Activa',
    });
    const inactive = screen.getByRole('button', { name: 'Avenida · Inactiva' });
    expect(inactive).toHaveClass('is-inactive');
    expect(
      screen.queryByRole('button', { name: /Invalid/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(active);
    expect(onSelect).toHaveBeenLastCalledWith('one');
    fireEvent.keyDown(inactive, { key: ' ' });
    expect(onSelect).toHaveBeenLastCalledWith('two');
    expect(
      screen.getByRole('link', { name: 'OpenStreetMap' }),
    ).toBeInTheDocument();
  });

  it('updates markers after changes and filtering without duplicating them or losing focus', async () => {
    const view = render(<StopsMap {...props} />);
    const campus = await screen.findByRole('button', {
      name: 'Campus · Activa',
    });
    campus.focus();
    view.rerender(
      <StopsMap
        {...props}
        selectedId="one"
        stops={stops.map((stop) => ({ ...stop, active: true }))}
      />,
    );
    await waitFor(() => expect(campus).toHaveAttribute('aria-pressed', 'true'));
    expect(campus).toHaveFocus();
    expect(campus).toHaveClass('is-selected');
    expect(
      screen.getByRole('button', { name: 'Avenida · Activa' }),
    ).not.toHaveClass('is-inactive');
    view.rerender(<StopsMap {...props} stops={[stops[0]]} />);
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /Avenida ·/ }),
      ).not.toBeInTheDocument(),
    );
  });

  it('supports keyboard placement at map center and keeps the unsaved marker distinct', async () => {
    const onPick = vi.fn();
    const view = render(<StopsMap {...props} onPick={onPick} />);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Usar centro del mapa' }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Usar centro del mapa' }),
    );
    expect(onPick).toHaveBeenCalledWith({
      latitude: expect.any(Number),
      longitude: expect.any(Number),
    });
    const point = onPick.mock.calls[0][0];
    expect(Math.abs(point.latitude)).toBeLessThanOrEqual(90);
    expect(Math.abs(point.longitude)).toBeLessThanOrEqual(180);
    fireEvent.click(
      screen.getByRole('region', { name: 'Mapa de paradas registradas' }),
      { clientX: 80, clientY: 60 },
    );
    expect(onPick).toHaveBeenCalledTimes(2);
    view.rerender(<StopsMap {...props} onPick={onPick} draft={point} />);
    await waitFor(() =>
      expect(
        view.container.querySelectorAll('.is-draft.admin-stop-marker'),
      ).toHaveLength(1),
    );
    expect(
      screen.getByRole('button', { name: 'Campus · Activa' }),
    ).toHaveAttribute('aria-disabled', 'true');
    view.rerender(<StopsMap {...props} />);
    await waitFor(() =>
      expect(
        view.container.querySelector('.is-draft.admin-stop-marker'),
      ).not.toBeInTheDocument(),
    );
  });

  it('keeps catalog markers when tiles fail and rebuilds the map on retry', async () => {
    const view = render(<StopsMap {...props} />);
    const original = await screen.findByRole('button', {
      name: 'Campus · Activa',
    });
    const tile = view.container.querySelector('img.leaflet-tile');
    expect(tile).not.toBeNull();
    fireEvent.error(tile!);
    expect(
      await screen.findByText(/El mapa base no está disponible/),
    ).toBeInTheDocument();
    expect(original).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Recargar mapa base' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Campus · Activa' })).not.toBe(
        original,
      ),
    );
    expect(
      view.container.querySelectorAll('.leaflet-control-zoom-in'),
    ).toHaveLength(1);
  });

  it('cleans up StrictMode mounts and keeps stop names as text', async () => {
    const name = '<img src=x onerror=alert(1)>';
    const view = render(
      <StrictMode>
        <StopsMap {...props} stops={[{ ...stops[0], name }]} />
      </StrictMode>,
    );
    expect(
      await screen.findByRole('button', { name: `${name} · Activa` }),
    ).toBeInTheDocument();
    expect(view.container.querySelectorAll('.leaflet-container')).toHaveLength(
      1,
    );
    expect(
      view.container.querySelectorAll('.leaflet-control-zoom-in'),
    ).toHaveLength(1);
    expect(
      view.container.querySelector('img[src="x"]'),
    ).not.toBeInTheDocument();
    view.unmount();
  });
});
