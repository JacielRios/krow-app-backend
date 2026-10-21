import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  act,
} from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { StopEditor } from './StopEditor';
import type { StopSuggestions, TransportStop } from '@/lib/transport-stops';
const api = vi.hoisted(() => vi.fn());
vi.mock('@/lib/admin-api', () => ({ useAdminApi: () => api }));
const point = { latitude: 25.65, longitude: -100.2 };
const props = {
  stop: null,
  coordinates: point,
  corridors: [
    {
      corridorId: 'ave',
      name: 'Av. Eloy Cavazos',
      direction: null,
      active: true,
    },
  ],
  onClose: vi.fn(),
  onSaved: vi.fn(),
};
const suggested: StopSuggestions = {
  values: {
    ...point,
    externalId: 'krow-itnl-eloy-descenso-1234',
    name: 'Eloy Cavazos 100',
    address: 'Av. Eloy Cavazos 100, Guadalupe',
    municipality: 'Guadalupe',
    direction: 'Poniente a Oriente',
    corridorId: 'ave',
    stopOrder: 3,
    stopType: 'dropoff_only',
  },
  warnings: ['Confirma el sentido y el lado de la vialidad.'],
  orderSource: 'catalog_geometry',
  directionSource: 'google_reference_label',
  shiftedStops: 2,
};
async function prepared() {
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Guardar parada' }),
    ).toBeEnabled(),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  api.mockImplementation(async (path: string) =>
    path.endsWith('/suggest') ? suggested : { stopId: 'saved' },
  );
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    },
  });
});
describe('descent editor autofill', () => {
  it('fills all verified fields and saves an explicitly ordered descent with one confirmation', async () => {
    render(<StopEditor {...props} />);
    await prepared();
    expect(screen.getByLabelText('Identificador')).toHaveValue(
      suggested.values.externalId,
    );
    expect(screen.getByLabelText('Nombre')).toHaveValue(suggested.values.name);
    expect(screen.getByLabelText('Dirección')).toHaveValue(
      suggested.values.address,
    );
    expect(screen.getByLabelText('Municipio')).toHaveValue('Guadalupe');
    expect(screen.getByLabelText('Sentido')).toHaveValue('Poniente a Oriente');
    expect(screen.getByLabelText('Avenida')).toHaveValue('ave');
    expect(screen.getByLabelText('Orden dentro de la avenida')).toHaveValue(3);
    expect(screen.getByLabelText('Tipo')).toHaveValue('dropoff_only');
    expect(
      within(screen.getByLabelText('Tipo')).getAllByRole('option'),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Guardar parada' }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledWith('saved'));
    expect(api).toHaveBeenLastCalledWith(
      '/admin/transport-stops',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          ...suggested.values,
          active: true,
          insertAtOrder: true,
        }),
      }),
    );
  });
  it('keeps manual edits made while Google is still loading', async () => {
    let resolve!: (value: StopSuggestions) => void;
    api.mockImplementation(
      () =>
        new Promise<StopSuggestions>((done) => {
          resolve = done;
        }),
    );
    render(<StopEditor {...props} />);
    fireEvent.change(screen.getByLabelText('Nombre'), {
      target: { value: 'Nombre confirmado por administrador' },
    });
    fireEvent.change(screen.getByLabelText('Municipio'), {
      target: { value: 'Municipio confirmado' },
    });
    await waitFor(() => expect(api).toHaveBeenCalled());
    await act(async () => resolve(suggested));
    expect(screen.getByLabelText('Nombre')).toHaveValue(
      'Nombre confirmado por administrador',
    );
    expect(screen.getByLabelText('Municipio')).toHaveValue(
      'Municipio confirmado',
    );
    expect(screen.getByLabelText('Dirección')).toHaveValue(
      suggested.values.address,
    );
  });
  it('ignores old responses after location changes and clears unsupported reference data', async () => {
    const pending: Array<(value: StopSuggestions) => void> = [];
    api.mockImplementation(
      () => new Promise<StopSuggestions>((done) => pending.push(done)),
    );
    render(
      <StopEditor
        {...props}
        reference={{
          ...point,
          placeId: 'google',
          name: 'Google bus',
          address: 'Google address',
        }}
      />,
    );
    await waitFor(() => expect(pending).toHaveLength(1));
    fireEvent.change(screen.getByLabelText('Latitud'), {
      target: { value: '25.66' },
    });
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(api.mock.calls[1][1].body).not.toHaveProperty(
      'referenceName',
      'Google bus',
    );
    await act(async () => pending[0](suggested));
    expect(screen.getByLabelText('Nombre')).toHaveValue('');
    await act(async () =>
      pending[1]({
        ...suggested,
        values: {
          ...suggested.values,
          latitude: 25.66,
          name: 'Nueva ubicación',
        },
      }),
    );
    expect(screen.getByLabelText('Nombre')).toHaveValue('Nueva ubicación');
  });
  it('leaves unknown fields empty and permits inactive drafts pending avenue confirmation', async () => {
    api.mockResolvedValueOnce({
      ...suggested,
      values: {
        ...suggested.values,
        municipality: '',
        direction: '',
        corridorId: '',
        stopOrder: null,
      },
      warnings: ['Municipio y sentido pendientes de confirmación.'],
    });
    render(<StopEditor {...props} />);
    await prepared();
    expect(screen.getByLabelText('Municipio')).toHaveValue('');
    expect(screen.getByLabelText('Sentido')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar parada' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Selecciona una avenida',
    );
    expect(props.onSaved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Activa'));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar parada' }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
  });
  it('shows a recoverable lookup error without fabricating address fields', async () => {
    api.mockRejectedValueOnce(new Error('Google no está disponible'));
    render(<StopEditor {...props} />);
    await prepared();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'capturarlos manualmente',
    );
    expect(screen.getByLabelText('Municipio')).toHaveValue('');
    expect(screen.getByLabelText('Latitud')).toHaveValue(25.65);
    fireEvent.click(
      screen.getByRole('button', { name: 'Reintentar datos de la ubicación' }),
    );
    await prepared();
    expect(screen.getByLabelText('Nombre')).toHaveValue(suggested.values.name);
  });
  it('preserves the identity and operational type of existing records when moving them', () => {
    const stop: TransportStop = {
      stopId: 'old',
      externalId: 'krow-old',
      name: 'Campus',
      address: 'Old address',
      municipality: 'Old municipality',
      direction: null,
      corridorId: null,
      stopOrder: null,
      latitude: 25.7,
      longitude: -100.3,
      active: true,
      stopType: 'official_boarding_zone',
    };
    render(<StopEditor {...props} stop={stop} />);
    expect(api).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Identificador')).toHaveValue('krow-old');
    expect(screen.getByLabelText('Tipo')).toHaveValue('official_boarding_zone');
    expect(screen.getByLabelText('Latitud')).toHaveValue(point.latitude);
  });
});
