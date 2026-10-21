import {
  render,
  screen,
  fireEvent,
  within,
  waitFor,
  act,
} from '@testing-library/react';
import {
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';
import type {
  GoogleStopReference,
  StopCoordinates,
  TransportStop,
} from '@/lib/transport-stops';
const auth = vi.hoisted(() => ({ token: vi.fn(), invalidate: vi.fn() }));
vi.mock('@/lib/admin-auth', () => ({
  useAdminAuth: () => ({
    getAccessToken: auth.token,
    invalidate: auth.invalidate,
  }),
}));
// Page tests use real authenticated hooks. Google Maps events are tested separately.
vi.mock('@/components/admin/StopsMap', () => ({
  default: ({
    stops,
    selectedId,
    onSelect,
    onPick,
    onReference,
    disabled,
  }: {
    stops: TransportStop[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    onPick?: (point: StopCoordinates) => void;
    onReference?: (point: GoogleStopReference) => void;
    disabled: boolean;
  }) => (
    <div data-testid="stop-map">
      {onReference && (
        <button
          disabled={disabled}
          onClick={() =>
            onReference({
              placeId: 'google-bus',
              name: 'Autobús Google',
              address: 'Avenida de prueba',
              latitude: 25.72,
              longitude: -100.25,
            })
          }
        >
          Elegir referencia Google
        </button>
      )}
      {stops.map((stop) => (
        <button
          key={stop.stopId}
          disabled={disabled || !!onPick}
          aria-pressed={selectedId === stop.stopId}
          onClick={() => onSelect(stop.stopId)}
        >
          Marcador {stop.name} {stop.active ? 'Activa' : 'Inactiva'}
        </button>
      ))}
      {onPick && (
        <button
          disabled={disabled}
          onClick={() =>
            onPick({ latitude: 25.712345, longitude: -100.254321 })
          }
        >
          Elegir punto de prueba
        </button>
      )}
    </div>
  ),
}));
import StopsPage from './page';

const firstStop: TransportStop = {
  stopId: 'stop-1',
  externalId: 'OLD',
  name: 'Referencia existente',
  latitude: 25.7,
  longitude: -100.2,
  active: true,
  stopType: 'general',
  corridorId: 'avenue-1',
  stopOrder: 1,
  address: 'Pablo Livas 100',
  municipality: 'Guadalupe',
  direction: 'Oriente',
};
let catalog: TransportStop[];
let rejectSave: string | null;
let fetcher: Mock<(url: string, init: RequestInit) => Promise<Response>>;
const mutations = () =>
  fetcher.mock.calls.filter(
    ([url, init]) =>
      !url.endsWith('/suggest') &&
      (init.method === 'PATCH' || init.method === 'POST'),
  );
const marker = (name = 'Referencia existente', active = true) =>
  within(screen.getByTestId('stop-map')).getByRole('button', {
    name: `Marcador ${name} ${active ? 'Activa' : 'Inactiva'}`,
  });
async function ready() {
  render(<StopsPage />);
  await waitFor(() => expect(marker()).toBeEnabled());
}
function openStatus(active = true) {
  fireEvent.click(
    marker(active ? 'Referencia existente' : 'Parada inactiva', active),
  );
  fireEvent.click(
    screen.getByRole('button', {
      name: active ? 'Desactivar parada' : 'Activar parada',
    }),
  );
}
function fillNewStop() {
  const dialog = within(screen.getByRole('dialog'));
  fireEvent.change(dialog.getByLabelText('Identificador'), {
    target: { value: 'NEW' },
  });
  fireEvent.change(dialog.getByLabelText('Nombre'), {
    target: { value: 'Nueva referencia' },
  });
  fireEvent.change(dialog.getByLabelText('Avenida'), {
    target: { value: 'avenue-1' },
  });
  fireEvent.change(dialog.getByLabelText('Orden dentro de la avenida'), {
    target: { value: '2' },
  });
  return dialog;
}

describe('stop administration map and persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.token.mockResolvedValue('synthetic-admin-access');
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example/v1');
    catalog = [
      { ...firstStop },
      {
        ...firstStop,
        stopId: 'stop-2',
        externalId: 'INACTIVE',
        name: 'Parada inactiva',
        active: false,
        latitude: 25.71,
        stopOrder: 3,
      },
    ];
    rejectSave = null;
    fetcher = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/suggest')) {
        const point = JSON.parse(String(init.body));
        return new Response(
          JSON.stringify({
            values: {
              ...point,
              externalId: 'krow-itnl-pablo-descenso-abcdef1234',
              name: point.referenceName || 'Parada generada',
              address: 'Dirección verificada',
              municipality: 'Guadalupe',
              direction: '',
              corridorId: point.corridorId || 'avenue-1',
              stopOrder: 2,
              stopType: 'dropoff_only',
            },
            warnings: [],
            orderSource: 'catalog_geometry',
            directionSource: null,
            shiftedStops: 1,
          }),
        );
      }
      if (init.method === 'POST' || init.method === 'PATCH') {
        if (rejectSave)
          return new Response(JSON.stringify({ message: rejectSave }), {
            status: 409,
          });
        const body = JSON.parse(String(init.body));
        const stopId =
          init.method === 'POST' ? 'new-stop-1' : url.split('/').at(-1)!;
        catalog =
          init.method === 'POST'
            ? [...catalog, { ...body, stopId }]
            : catalog.map((stop) =>
                stop.stopId === stopId ? { ...stop, ...body } : stop,
              );
        return new Response(JSON.stringify({ stopId }));
      }
      return new Response(
        JSON.stringify(
          url.endsWith('/corridors')
            ? [
                {
                  corridorId: 'avenue-1',
                  name: 'Pablo Livas',
                  direction: 'Oriente',
                  active: true,
                },
              ]
            : catalog,
        ),
      );
    });
    vi.stubGlobal('fetch', fetcher);
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
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('reviews a Google reference before explicitly creating and reloading the KROW record', async () => {
    await ready();
    fireEvent.click(
      screen.getByRole('button', { name: 'Elegir referencia Google' }),
    );
    expect(
      screen.getByRole('heading', { name: 'Autobús Google' }),
    ).toBeInTheDocument();
    expect(mutations()).toHaveLength(0);
    fireEvent.click(
      screen.getByRole('button', { name: 'Continuar con los datos' }),
    );
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByLabelText('Nombre')).toHaveValue('Autobús Google');
    expect(dialog.getByLabelText('Dirección')).toHaveValue('Avenida de prueba');
    expect(dialog.getByLabelText('Latitud')).toHaveValue(25.72);
    expect(dialog.getByLabelText('Identificador')).toHaveValue('');
    fireEvent.change(dialog.getByLabelText('Identificador'), {
      target: { value: 'BUS-NEW' },
    });
    await waitFor(() =>
      expect(
        dialog.getByRole('button', { name: 'Guardar parada' }),
      ).toBeEnabled(),
    );
    fireEvent.click(dialog.getByRole('button', { name: 'Guardar parada' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(marker('Autobús Google')).toBeEnabled());
    expect(mutations()).toHaveLength(1);
    expect(JSON.parse(String(mutations()[0][1].body))).toEqual(
      expect.objectContaining({
        externalId: 'BUS-NEW',
        name: 'Autobús Google',
        latitude: 25.72,
        longitude: -100.25,
      }),
    );
  });

  it('clears Google suggested data when replacing its location with a custom point', async () => {
    await ready();
    fireEvent.click(
      screen.getByRole('button', { name: 'Elegir referencia Google' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Elegir punto de prueba' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Continuar con los datos' }),
    );
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByLabelText('Nombre')).toHaveValue('');
    expect(dialog.getByLabelText('Dirección')).toHaveValue('');
    expect(dialog.getByLabelText('Latitud')).toHaveValue(25.712345);
    expect(mutations()).toHaveLength(0);
  });

  it('selects registered markers and keeps map/list selection and filters consistent', async () => {
    await ready();
    fireEvent.click(marker());
    expect(
      screen.getByRole('heading', { name: firstStop.name }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: `Ver ${firstStop.name} en el mapa` }),
    ).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(
      screen.getByRole('button', { name: 'Ver Parada inactiva en el mapa' }),
    );
    expect(marker('Parada inactiva', false)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.change(screen.getByLabelText('Estado'), {
      target: { value: 'inactive' },
    });
    expect(
      within(screen.getByTestId('stop-map')).getAllByRole('button', {
        name: /^Marcador/,
      }),
    ).toHaveLength(1);
    expect(
      within(screen.getByRole('table')).queryByText(firstStop.name),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Buscar parada'), {
      target: { value: 'inexistente' },
    });
    expect(
      within(screen.getByTestId('stop-map')).queryAllByRole('button', {
        name: /^Marcador/,
      }),
    ).toHaveLength(0);
    expect(screen.getByText('No hay resultados')).toBeInTheDocument();
  });

  it('creates from map coordinates only after confirming data and refreshes both views', async () => {
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Agregar parada' }));
    expect(
      screen.getByRole('button', { name: 'Continuar con los datos' }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Elegir punto de prueba' }),
    );
    expect(screen.getByText('25.712345')).toBeInTheDocument();
    expect(mutations()).toHaveLength(0);
    fireEvent.click(
      screen.getByRole('button', { name: 'Continuar con los datos' }),
    );
    const dialog = fillNewStop();
    expect(dialog.getByLabelText('Latitud')).toHaveValue(25.712345);
    expect(dialog.getByLabelText('Longitud')).toHaveValue(-100.254321);
    await waitFor(() =>
      expect(
        dialog.getByRole('button', { name: 'Guardar parada' }),
      ).toBeEnabled(),
    );
    fireEvent.click(dialog.getByRole('button', { name: 'Guardar parada' }));
    await waitFor(() => expect(marker('Nueva referencia')).toBeEnabled());
    expect(
      within(screen.getByRole('table')).getByText('Nueva referencia'),
    ).toBeInTheDocument();
    expect(JSON.parse(String(mutations()[0][1].body))).toMatchObject({
      latitude: 25.712345,
      longitude: -100.254321,
      corridorId: 'avenue-1',
      stopOrder: 2,
      active: true,
    });
    expect(mutations()[0][1].headers).toMatchObject({
      Authorization: 'Bearer synthetic-admin-access',
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps manual coordinate entry available and validates missing data', async () => {
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Agregar parada' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Ingresar coordenadas manualmente' }),
    );
    const dialog = fillNewStop();
    fireEvent.submit(
      dialog.getByRole('button', { name: 'Guardar parada' }).closest('form')!,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'latitud y longitud válidas',
    );
    expect(mutations()).toHaveLength(0);
    fireEvent.change(dialog.getByLabelText('Latitud'), {
      target: { value: '25.71' },
    });
    fireEvent.change(dialog.getByLabelText('Longitud'), {
      target: { value: '-100.25' },
    });
    await waitFor(() =>
      expect(
        dialog.getByRole('button', { name: 'Guardar parada' }),
      ).toBeEnabled(),
    );
    fireEvent.click(dialog.getByRole('button', { name: 'Guardar parada' }));
    await waitFor(() => expect(marker('Nueva referencia')).toBeEnabled());
  });

  it('cancels map placement without writing any stop', async () => {
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Agregar parada' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Elegir punto de prueba' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar selección' }));
    expect(screen.queryByText('25.712345')).not.toBeInTheDocument();
    expect(mutations()).toHaveLength(0);
    expect(catalog).toHaveLength(2);
  });

  it('deactivates only after confirmation, preserving the freshest stored fields', async () => {
    await ready();
    openStatus();
    expect(mutations()).toHaveLength(0);
    catalog[0] = {
      ...catalog[0],
      latitude: 25.700123,
      name: 'Nombre actualizado por otro administrador',
    };
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirmar desactivación' }),
    );
    await waitFor(() => expect(marker(catalog[0].name, false)).toBeEnabled());
    expect(JSON.parse(String(mutations()[0][1].body))).toMatchObject({
      active: false,
      latitude: 25.700123,
      name: catalog[0].name,
      corridorId: 'avenue-1',
      stopOrder: 1,
    });
    expect(
      within(screen.getByRole('table')).getAllByText('Inactivo'),
    ).toHaveLength(2);
  });

  it('activates an inactive stop and refreshes its map marker', async () => {
    await ready();
    openStatus(false);
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirmar activación' }),
    );
    await waitFor(() => expect(marker('Parada inactiva')).toBeEnabled());
    expect(catalog[1].active).toBe(true);
  });

  it('keeps booked stops active when the server rejects deactivation', async () => {
    await ready();
    rejectSave =
      'La parada tiene reservas pendientes. Atiende esos viajes antes de desactivarla';
    openStatus();
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirmar desactivación' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'reservas pendientes',
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(marker()).toHaveAttribute('aria-pressed', 'true');
    expect(catalog[0].active).toBe(true);
  });

  it('keeps duplicate/create errors in the editor without a phantom marker', async () => {
    await ready();
    rejectSave = 'El identificador o el orden de la parada ya están en uso';
    fireEvent.click(screen.getByRole('button', { name: 'Agregar parada' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Elegir punto de prueba' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Continuar con los datos' }),
    );
    const dialog = fillNewStop();
    await waitFor(() =>
      expect(
        dialog.getByRole('button', { name: 'Guardar parada' }),
      ).toBeEnabled(),
    );
    fireEvent.click(dialog.getByRole('button', { name: 'Guardar parada' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'ya están en uso',
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(catalog).toHaveLength(2);
    expect(
      within(screen.getByTestId('stop-map')).queryByText(/Nueva referencia/),
    ).not.toBeInTheDocument();
  });

  it('moves a stop through the map without writing until the editor is saved', async () => {
    await ready();
    fireEvent.click(marker());
    fireEvent.click(
      screen.getByRole('button', { name: 'Cambiar ubicación en el mapa' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Elegir punto de prueba' }),
    );
    expect(mutations()).toHaveLength(0);
    fireEvent.click(
      screen.getByRole('button', { name: 'Continuar con los datos' }),
    );
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByLabelText('Nombre')).toHaveValue(firstStop.name);
    await waitFor(() =>
      expect(
        dialog.getByRole('button', { name: 'Guardar parada' }),
      ).toBeEnabled(),
    );
    fireEvent.click(dialog.getByRole('button', { name: 'Guardar parada' }));
    await waitFor(() => expect(catalog[0].latitude).toBe(25.712345));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole('heading', { name: firstStop.name }),
    ).toBeInTheDocument();
  });

  it('prevents repeated status writes while the server is saving', async () => {
    await ready();
    const implementation = fetcher.getMockImplementation()!;
    let release!: () => void;
    fetcher.mockImplementation((url: string, init: RequestInit) =>
      init.method === 'PATCH'
        ? new Promise((resolve) => {
            release = () => {
              void implementation(url, init).then(resolve);
            };
          })
        : implementation(url, init),
    );
    openStatus();
    const confirm = screen.getByRole('button', {
      name: 'Confirmar desactivación',
    });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(release).toBeTypeOf('function'));
    expect(mutations()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Guardando…' })).toBeDisabled();
    await act(async () => release());
    await waitFor(() => expect(marker(firstStop.name, false)).toBeEnabled());
  });

  it('reloads the catalog on window focus', async () => {
    await ready();
    catalog[0] = { ...catalog[0], active: false };
    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(marker(firstStop.name, false)).toBeEnabled());
  });
});
