import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ProfilePage from '@/app/conductor/perfil/page';
import DriverDashboard from '@/app/conductor/dashboard/page';
import DriverTripHistory from '@/app/conductor/viajes/page';
import DriverFinance from '@/app/conductor/finanzas/page';
import { verifyDriverSession, type DriverPage } from '@/lib/driver-auth';
import {
  currentWeekStart,
  driverInsights,
  initials,
  licenseStatus,
  mondayOf,
  money,
  percent,
  rangeFromDays,
  safePhotoUrl,
  shiftWeek,
  weekEnd,
  type DriverDashboardData,
  type DriverProfile as Profile,
  type DriverRide,
  type DriverWeeklyReport,
} from '@/components/driver/driver-kit';

// Las pantallas leen sus datos con useDriverResource: aquí se sustituye por un
// doble controlado. verifyDriverSession se conserva real.
const { resource, reload, download } = vi.hoisted(() => ({
  resource: vi.fn(),
  reload: vi.fn(),
  download: vi.fn(),
}));
vi.mock('@/lib/driver-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/driver-auth')>()),
  useDriverResource: (path: string) => resource(path),
}));
vi.mock('@/components/driver/driver-report-pdf', () => ({
  downloadWeeklyReportPdf: download,
}));

describe('perfil', () => {
const profile: Profile = {
  fullName: 'Ana María López',
  email: 'ana@example.com',
  photoUrl: 'https://cdn.example/ana.jpg',
  academicProgram: 'Ingeniería en Sistemas',
  academicPeriod: 7,
  licenseNumber: 'LIC-12345',
  licenseExpiry: '2099-03-15',
  rating: 4.76,
  status: 'approved',
  memberSince: '2026-01-10T12:00:00+00:00',
};
const state = (
  data: Profile | null,
  extra: Partial<{ loading: boolean; error: string | null }> = {},
) => ({ data, loading: false, error: null, reload, ...extra });

describe('perfil del conductor', () => {
  beforeEach(() => {
    resource.mockReset();
    reload.mockReset();
  });

  it('pide su perfil y muestra los datos importantes sin identificadores', () => {
    resource.mockReturnValue(state(profile));
    render(<ProfilePage />);
    expect(resource).toHaveBeenCalledWith('/drivers/me/profile');
    expect(screen.getByRole('heading', { name: 'Ana María López' })).toBeVisible();
    expect(screen.getByText('ana@example.com')).toBeVisible();
    expect(screen.getByText('Aprobado')).toBeVisible();
    expect(screen.getByText('Ingeniería en Sistemas')).toBeVisible();
    expect(screen.getByText('LIC-12345')).toBeVisible();
    expect(screen.getByText('4.8 de 5')).toBeVisible();
    expect(screen.getByText('Vigente')).toBeVisible();
    expect(screen.queryByText(/uuid|driver_id|user_id/i)).not.toBeInTheDocument();
  });

  it('muestra la foto cuando es una URL válida', () => {
    resource.mockReturnValue(state(profile));
    render(<ProfilePage />);
    expect(screen.getByRole('img', { name: 'Foto de Ana María López' })).toHaveAttribute(
      'src',
      'https://cdn.example/ana.jpg',
    );
  });

  it('usa iniciales sin foto, con una ruta que no es URL o si la imagen falla', () => {
    resource.mockReturnValue(state({ ...profile, photoUrl: null }));
    const { unmount } = render(<ProfilePage />);
    expect(screen.getByRole('img', { name: 'Sin foto de perfil' })).toHaveTextContent('AM');
    unmount();

    resource.mockReturnValue(state({ ...profile, photoUrl: 'avatars/ana.jpg' }));
    const second = render(<ProfilePage />);
    expect(screen.getByRole('img', { name: 'Sin foto de perfil' })).toBeVisible();
    second.unmount();

    resource.mockReturnValue(state(profile));
    render(<ProfilePage />);
    fireEvent.error(screen.getByRole('img', { name: 'Foto de Ana María López' }));
    expect(screen.getByRole('img', { name: 'Sin foto de perfil' })).toBeVisible();
  });

  it('avisa cuando la licencia está vencida', () => {
    resource.mockReturnValue(state({ ...profile, licenseExpiry: '2000-01-01' }));
    render(<ProfilePage />);
    expect(screen.getByText('Licencia vencida')).toBeVisible();
  });

  it('tolera datos opcionales vacíos', () => {
    resource.mockReturnValue(
      state({ ...profile, fullName: null, email: null, academicProgram: null, academicPeriod: null, rating: null }),
    );
    render(<ProfilePage />);
    expect(screen.getByText('Nombre sin registrar')).toBeVisible();
    expect(screen.getByText('Aún sin calificaciones')).toBeVisible();
    expect(screen.getAllByText('Sin registrar')).toHaveLength(2);
    expect(document.body.textContent).not.toMatch(/NaN|undefined|null/);
  });

  it('muestra carga y error con reintento', () => {
    resource.mockReturnValue(state(null, { loading: true }));
    const { unmount } = render(<ProfilePage />);
    expect(screen.getByRole('status')).toHaveTextContent('Cargando tu perfil');
    unmount();
    resource.mockReturnValue(state(null, { error: 'Servicio no disponible' }));
    render(<ProfilePage />);
    expect(screen.getByRole('alert')).toHaveTextContent('Servicio no disponible');
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
});

describe('dashboard', () => {
const data: DriverDashboardData = {
  completed: 5,
  cancelled: 1,
  ongoing: 2,
  scheduled: 4,
  totalTrips: 12,
  passengers: 7,
  occupancy: 55,
  revenue: 134.75,
  paid: 45.25,
  pending: 89.5,
  timezone: 'America/Monterrey',
  currency: 'MXN',
  trend: [{ date: '2026-10-07', completed: 5, cancelled: 1, revenue: 134.75 }],
  topRoutes: [{ route: 'ITNL → Centro', trips: 5, occupancy: 55, revenue: 134.75 }],
};
const empty: DriverDashboardData = {
  ...data,
  completed: 0,
  cancelled: 0,
  ongoing: 0,
  scheduled: 0,
  totalTrips: 0,
  passengers: 0,
  occupancy: 0,
  revenue: 0,
  paid: 0,
  pending: 0,
  trend: [],
  topRoutes: [],
};
const state = (
  value: DriverDashboardData | null,
  extra: Partial<{ loading: boolean; error: string | null }> = {},
) => ({ data: value, loading: false, error: null, reload, ...extra });

describe('dashboard del conductor', () => {
  beforeEach(() => {
    resource.mockReset();
    reload.mockReset();
  });

  it('consulta su resumen del último mes y muestra los importes con centavos', () => {
    resource.mockReturnValue(state(data));
    render(<DriverDashboard />);
    const month = rangeFromDays(30);
    expect(resource).toHaveBeenCalledWith(
      `/drivers/me/dashboard-summary?from=${month.from}&to=${month.to}`,
    );
    expect(screen.getByRole('button', { name: '1 mes' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getAllByText(money(134.75))).toHaveLength(2);
    expect(screen.getByText(money(45.25))).toBeVisible();
    expect(screen.getByText(money(89.5))).toBeVisible();
    expect(
      screen.getByText('Pasajeros transportados').closest('article'),
    ).toHaveTextContent('7');
    expect(
      screen.queryByRole('heading', { name: 'Conductores' }),
    ).not.toBeInTheDocument();
  });

  it('cambia de periodo con Semana y 3 meses', () => {
    resource.mockReturnValue(state(data));
    render(<DriverDashboard />);
    fireEvent.click(screen.getByRole('button', { name: 'Semana' }));
    let selected = rangeFromDays(7);
    expect(resource).toHaveBeenLastCalledWith(
      `/drivers/me/dashboard-summary?from=${selected.from}&to=${selected.to}`,
    );
    fireEvent.click(screen.getByRole('button', { name: '3 meses' }));
    selected = rangeFromDays(90);
    expect(resource).toHaveBeenLastCalledWith(
      `/drivers/me/dashboard-summary?from=${selected.from}&to=${selected.to}`,
    );
  });

  it('muestra el estado de carga inicial', () => {
    resource.mockReturnValue(state(null, { loading: true }));
    render(<DriverDashboard />);
    expect(screen.getByRole('status')).toHaveTextContent('Cargando indicadores');
  });

  it('presenta el error y permite reintentar sin datos de ejemplo', () => {
    resource.mockReturnValue(state(null, { error: 'Servicio no disponible' }));
    render(<DriverDashboard />);
    expect(screen.getByRole('alert')).toHaveTextContent('Servicio no disponible');
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('admite periodos vacíos sin NaN ni gráfica', () => {
    resource.mockReturnValue(state(empty));
    render(<DriverDashboard />);
    expect(screen.getByText(/No hay viajes en este periodo/)).toBeVisible();
    expect(
      screen.getByText('No hay rutas con actividad en este periodo.'),
    ).toBeVisible();
    expect(screen.queryByText('Viajes por día')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
  });

  it('no inventa cobros cuando no hay registro de efectivo', () => {
    resource.mockReturnValue(state({ ...data, paid: null, pending: null }));
    render(<DriverDashboard />);
    expect(screen.getAllByText('Sin registro')).toHaveLength(2);
  });

  it('enlaza al historial de viajes realizados', () => {
    resource.mockReturnValue(state(data));
    render(<DriverDashboard />);
    expect(
      screen.getByRole('link', { name: /historial de viajes realizados/i }),
    ).toHaveAttribute('href', '/conductor/viajes');
  });
});
});

describe('historial', () => {
const page: DriverPage<DriverRide> = {
  items: [
    {
      rideId: 'r1',
      departureTime: '2026-10-05T20:30:00Z',
      originAddress: 'ITNL',
      destinationAddress: 'Centro',
      passengers: 3,
      amount: 90.5,
    },
    {
      rideId: 'r2',
      departureTime: '2026-10-04T14:00:00Z',
      originAddress: null,
      destinationAddress: null,
      passengers: 1,
      amount: 30,
    },
  ],
  total: 25,
  page: 1,
  pageSize: 10,
};
const state = (
  value: DriverPage<DriverRide> | null,
  extra: Partial<{ loading: boolean; error: string | null }> = {},
) => ({ data: value, loading: false, error: null, reload, ...extra });
const path = (days: number, pageNumber = 1) => {
  const r = rangeFromDays(days);
  return `/drivers/me/rides?status=completed&from=${r.from}&to=${r.to}&page=${pageNumber}&pageSize=10`;
};

describe('historial de viajes del conductor', () => {
  beforeEach(() => {
    resource.mockReset();
    reload.mockReset();
  });

  it('pide solo los viajes realizados del último mes', () => {
    resource.mockReturnValue(state(page));
    render(<DriverTripHistory />);
    expect(resource).toHaveBeenCalledWith(path(30));
  });

  it('lista fecha, ruta, pasajeros e importe, y tolera direcciones ausentes', () => {
    resource.mockReturnValue(state(page));
    render(<DriverTripHistory />);
    const row = screen.getByRole('row', { name: /ITNL/ });
    expect(row).toHaveTextContent('ITNL → Centro');
    expect(within(row).getByText(money(90.5))).toBeVisible();
    expect(
      screen.getByRole('row', { name: /Origen sin registrar/ }),
    ).toHaveTextContent('Destino sin registrar');
    expect(screen.getByText('25 viajes realizados')).toBeVisible();
  });

  it('pagina y vuelve a la página 1 al cambiar de periodo', () => {
    resource.mockReturnValue(state(page));
    render(<DriverTripHistory />);
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    expect(screen.getByText('Página 1 de 3')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(resource).toHaveBeenLastCalledWith(path(30, 2));
    fireEvent.click(screen.getByRole('button', { name: 'Semana' }));
    expect(resource).toHaveBeenLastCalledWith(path(7, 1));
  });

  it('muestra el estado vacío', () => {
    resource.mockReturnValue(state({ ...page, items: [], total: 0 }));
    render(<DriverTripHistory />);
    expect(
      screen.getByText('No hay viajes realizados en este periodo.'),
    ).toBeVisible();
    expect(screen.getByText('Página 1 de 1')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
  });

  it('muestra el error y permite reintentar', () => {
    resource.mockReturnValue(state(null, { error: 'Servicio no disponible' }));
    render(<DriverTripHistory />);
    expect(screen.getByRole('alert')).toHaveTextContent('Servicio no disponible');
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
});

describe('finanzas', () => {
const thisWeek = currentWeekStart();
const make = (weekStart: string): DriverWeeklyReport => ({
  driverName: 'Ana López',
  weekStart,
  weekEnd: weekEnd(weekStart),
  currency: 'MXN',
  timezone: 'America/Monterrey',
  payPerPassenger: 20,
  // 5 pasajeros a $35.00: el conductor recibe $20.00 por cada uno.
  totals: { trips: 2, passengers: 5, gross: 175, retained: 75, net: 100 },
  byMethod: [
    { method: 'cash', payments: 3, passengers: 3, gross: 105, retained: 45, net: 60 },
    { method: 'card', payments: 2, passengers: 2, gross: 70, retained: 30, net: 40 },
  ],
  trips: [
    {
      rideId: 'r1',
      departureTime: '2026-10-21T15:00:00Z',
      originAddress: 'ITNL',
      destinationAddress: 'Centro',
      passengers: 3,
      gross: 105,
      retained: 45,
      net: 60,
    },
    {
      rideId: 'r2',
      departureTime: '2026-10-22T15:00:00Z',
      originAddress: null,
      destinationAddress: null,
      passengers: 2,
      gross: 70,
      retained: 30,
      net: 40,
    },
  ],
});
const state = (
  data: DriverWeeklyReport | null,
  extra: Partial<{ loading: boolean; error: string | null }> = {},
) => ({ data, loading: false, error: null, reload, ...extra });
const path = (weekStart: string) => `/drivers/me/weekly-report?weekStart=${weekStart}`;

describe('finanzas semanales del conductor', () => {
  beforeEach(() => {
    resource.mockReset();
    reload.mockReset();
    download.mockReset();
  });

  it('consulta la semana en curso y resume cuánto ganó', () => {
    resource.mockReturnValue(state(make(thisWeek)));
    render(<DriverFinance />);
    expect(resource).toHaveBeenCalledWith(path(thisWeek));
    expect(screen.getByText(/semana en curso/)).toBeVisible();
    expect(screen.getByText(/ganaste/)).toHaveTextContent(money(100));
    expect(screen.getByText('Viajes realizados').closest('article')).toHaveTextContent('2');
    expect(screen.getByText('Pasajeros transportados').closest('article')).toHaveTextContent('5');
    expect(screen.getByText('Cobrado a pasajeros').closest('article')).toHaveTextContent(money(175));
    expect(screen.getByText('Cargo por servicio').closest('article')).toHaveTextContent(money(75));
    expect(screen.getByText('Tu ganancia').closest('article')).toHaveTextContent(money(100));
  });

  it('explica el pago por pasajero y muestra el desglose y los pasajeros por viaje', () => {
    resource.mockReturnValue(state(make(thisWeek)));
    render(<DriverFinance />);
    expect(screen.getByText(/Recibes \$20\.00 por cada pasajero/)).toBeVisible();
    expect(screen.getByRole('row', { name: /Efectivo/ })).toHaveTextContent(money(60));
    expect(screen.getByRole('row', { name: /Tarjeta/ })).toHaveTextContent(money(40));
    expect(document.body.textContent).not.toMatch(/38\.41|26\.24|Margen/);
    const trip = screen.getByRole('row', { name: /ITNL/ });
    expect(trip).toHaveTextContent('ITNL → Centro');
    expect(trip).toHaveTextContent('3');
    expect(trip).toHaveTextContent(money(105));
    expect(trip).toHaveTextContent(money(45));
    expect(trip).toHaveTextContent(money(60));
    expect(screen.getByRole('row', { name: /Origen sin registrar/ })).toHaveTextContent('Destino sin registrar');
  });

  it('navega entre semanas y no permite pasar de la semana actual', () => {
    resource.mockReturnValue(state(make(thisWeek)));
    render(<DriverFinance />);
    expect(screen.getByRole('button', { name: 'Semana siguiente' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Semana anterior' }));
    expect(resource).toHaveBeenLastCalledWith(path(shiftWeek(thisWeek, -1)));
    expect(screen.getByRole('button', { name: 'Semana siguiente' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Ir a la semana actual' }));
    expect(resource).toHaveBeenLastCalledWith(path(thisWeek));
  });

  it('no muestra ni descarga el reporte de otra semana mientras carga la elegida', () => {
    resource.mockReturnValue(state(make(thisWeek)));
    render(<DriverFinance />);
    fireEvent.click(screen.getByRole('button', { name: 'Semana anterior' }));
    expect(screen.queryByText(/ganaste/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Descargar reporte PDF' })).toBeDisabled();
  });

  it('descarga el PDF del reporte mostrado', async () => {
    const report = make(thisWeek);
    resource.mockReturnValue(state(report));
    render(<DriverFinance />);
    fireEvent.click(screen.getByRole('button', { name: 'Descargar reporte PDF' }));
    await waitFor(() => expect(download).toHaveBeenCalledWith(report));
  });

  it('avisa si no se pudo generar el PDF', async () => {
    download.mockImplementation(() => {
      throw new Error('fallo');
    });
    resource.mockReturnValue(state(make(thisWeek)));
    render(<DriverFinance />);
    fireEvent.click(screen.getByRole('button', { name: 'Descargar reporte PDF' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos generar el PDF');
  });

  it('admite semanas sin viajes sin NaN', () => {
    const empty = {
      ...make(thisWeek),
      totals: { trips: 0, passengers: 0, gross: 0, retained: 0, net: 0 },
      byMethod: make(thisWeek).byMethod.map((m) => ({ ...m, payments: 0, passengers: 0, gross: 0, retained: 0, net: 0 })),
      trips: [],
    };
    resource.mockReturnValue(state(empty));
    render(<DriverFinance />);
    expect(screen.getByText('No hubo viajes realizados en esta semana.')).toBeVisible();
    expect(screen.getByText(/ganaste/)).toHaveTextContent(money(0));
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
  });

  it('muestra carga y error con reintento', () => {
    resource.mockReturnValue(state(null, { loading: true }));
    const { unmount } = render(<DriverFinance />);
    expect(screen.getByRole('status')).toHaveTextContent('Cargando reporte');
    unmount();
    resource.mockReturnValue(state(null, { error: 'Servicio no disponible' }));
    render(<DriverFinance />);
    expect(screen.getByRole('alert')).toHaveTextContent('Servicio no disponible');
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
});

describe('ayudas de fechas y perfil', () => {
const base: DriverDashboardData = {
  completed: 5,
  cancelled: 1,
  ongoing: 0,
  scheduled: 2,
  totalTrips: 8,
  passengers: 7,
  occupancy: 55,
  revenue: 134.75,
  paid: 45.25,
  pending: 89.5,
  timezone: 'America/Monterrey',
  currency: 'MXN',
  trend: [],
  topRoutes: [{ route: 'ITNL → Centro', trips: 5, occupancy: 55, revenue: 134.75 }],
};

describe('periodos y formatos del conductor', () => {
  it('usa la fecha de Monterrey aunque en UTC ya sea el siguiente día', () => {
    expect(rangeFromDays(7, new Date('2026-10-08T01:00:00Z'))).toEqual({
      from: '2026-10-01',
      to: '2026-10-07',
    });
  });
  it('calcula 30 y 90 días cruzando meses y años', () => {
    expect(rangeFromDays(30, new Date('2026-10-25T18:00:00Z'))).toEqual({
      from: '2026-09-26',
      to: '2026-10-25',
    });
    expect(rangeFromDays(90, new Date('2026-02-10T18:00:00Z'))).toEqual({
      from: '2025-11-13',
      to: '2026-02-10',
    });
  });
  it('no divide entre cero y conserva centavos', () => {
    expect(percent(3, 0)).toBe(0);
    expect(money(10.25)).toContain('10.25');
  });
});

describe('lectura rápida', () => {
  it('resume viajes, ruta principal y efectivo pendiente', () => {
    const text = driverInsights(base).join(' ');
    expect(text).toContain('5 viajes realizados y 1 cancelados de 8');
    expect(text).toContain('ITNL → Centro');
    expect(text).toContain('efectivo pendiente');
  });
  it('no inventa cobros ni rutas cuando no hay datos', () => {
    expect(
      driverInsights({ ...base, pending: null, topRoutes: [] }).join(' '),
    ).not.toMatch(/efectivo pendiente|ruta con mayor/);
    expect(driverInsights({ ...base, totalTrips: 0 })).toEqual([
      'No tienes viajes con salida en este periodo.',
    ]);
  });
});


describe('semanas de lunes a domingo (hora de Monterrey)', () => {
  it('encuentra el lunes de cualquier día', () => {
    expect(mondayOf('2026-10-19')).toBe('2026-10-19'); // lunes
    expect(mondayOf('2026-10-21')).toBe('2026-10-19'); // miércoles
    expect(mondayOf('2026-10-25')).toBe('2026-10-19'); // domingo
    expect(mondayOf('2026-01-01')).toBe('2025-12-29'); // cruza de año
  });
  it('usa la fecha local aunque en UTC ya sea el día siguiente', () => {
    // domingo 25 de octubre 19:00 en Monterrey = lunes 26 01:00 UTC
    expect(currentWeekStart(new Date('2026-10-26T01:00:00Z'))).toBe('2026-10-19');
    expect(currentWeekStart(new Date('2026-10-26T06:00:00Z'))).toBe('2026-10-26');
  });
  it('avanza y retrocede semanas completas', () => {
    expect(shiftWeek('2026-10-19', -1)).toBe('2026-10-12');
    expect(shiftWeek('2026-10-26', 1)).toBe('2026-11-02');
    expect(weekEnd('2026-10-19')).toBe('2026-10-25');
  });
});

describe('perfil', () => {
  it('solo acepta fotos con URL http(s)', () => {
    expect(safePhotoUrl('https://cdn.example/a.jpg')).toBe('https://cdn.example/a.jpg');
    expect(safePhotoUrl('javascript:alert(1)')).toBeNull();
    expect(safePhotoUrl('avatars/a.jpg')).toBeNull();
    expect(safePhotoUrl(null)).toBeNull();
  });
  it('genera iniciales de respaldo', () => {
    expect(initials('Ana María López')).toBe('AM');
    expect(initials('  ')).toBe('K');
    expect(initials(null)).toBe('K');
  });
  it('clasifica la vigencia de la licencia', () => {
    const now = new Date('2026-10-27T18:00:00Z');
    expect(licenseStatus('2026-10-26', now)).toMatchObject({ tone: 'expired', days: -1 });
    expect(licenseStatus('2026-10-27', now)).toMatchObject({ tone: 'soon', days: 0 });
    expect(licenseStatus('2026-11-26', now)).toMatchObject({ tone: 'soon', days: 30 });
    expect(licenseStatus('2026-11-27', now)).toMatchObject({ tone: 'ok', days: 31 });
  });
});
});

describe('verificación de conductor', () => {
const fetchMock = vi.fn();

describe('verifyDriverSession', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:3000');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('consulta /v1/drivers/me con el token de la sesión', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ driver_id: 'd1' }), { status: 200 }),
    );
    await expect(verifyDriverSession({ access_token: 'tok' })).resolves.toEqual(
      { driver_id: 'd1' },
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3000/v1/drivers/me');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it.each([401, 403, 404])(
    'rechaza con mensaje claro cuando la API responde %i',
    async (status) => {
      fetchMock.mockResolvedValue(new Response(null, { status }));
      await expect(
        verifyDriverSession({ access_token: 'tok' }),
      ).rejects.toThrow(/conductor registrado y activo/);
    },
  );

  it('distingue una falla del servidor de una cuenta no habilitada', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    await expect(verifyDriverSession({ access_token: 'tok' })).rejects.toThrow(
      /No pudimos verificar/,
    );
  });

  it('avisa cuando no hay conexión', async () => {
    fetchMock.mockRejectedValue(new TypeError('failed'));
    await expect(verifyDriverSession({ access_token: 'tok' })).rejects.toThrow(
      /No pudimos conectar/,
    );
  });
});
});

describe('pdf', () => {
let buildWeeklyReportPdf: typeof import('@/components/driver/driver-report-pdf').buildWeeklyReportPdf;
beforeAll(async () => {
  ({ buildWeeklyReportPdf } = await vi.importActual<typeof import('@/components/driver/driver-report-pdf')>(
    '@/components/driver/driver-report-pdf',
  ));
});

const base: DriverWeeklyReport = {
  driverName: 'Ana María López',
  weekStart: '2026-10-19',
  weekEnd: '2026-10-25',
  currency: 'MXN',
  timezone: 'America/Monterrey',
  payPerPassenger: 20,
  // 15 pasajeros a $35.00: el conductor recibe $20.00 por cada uno = $300.00.
  totals: { trips: 1, passengers: 15, gross: 525, retained: 225, net: 300 },
  byMethod: [
    { method: 'cash', payments: 9, passengers: 9, gross: 315, retained: 135, net: 180 },
    { method: 'card', payments: 6, passengers: 6, gross: 210, retained: 90, net: 120 },
  ],
  trips: [
    {
      rideId: 'r1',
      departureTime: '2026-10-21T15:00:00Z',
      originAddress: 'ITNL',
      destinationAddress: 'Centro',
      passengers: 15,
      gross: 525,
      retained: 225,
      net: 300,
    },
  ],
};

describe('PDF del reporte semanal', () => {
  it('es un PDF con el total ganado, los márgenes y el detalle de viajes', () => {
    const raw = buildWeeklyReportPdf(base).output();
    expect(raw.startsWith('%PDF')).toBe(true);
    expect(raw).toContain('ganaste $300.00');
    expect(raw).toContain('Ana Mar');
    expect(raw).toContain('19 de octubre de 2026');
    expect(raw).toContain('Cargo por servicio');
    expect(raw).toContain('$180.00');
    expect(raw).toContain('$120.00');
    expect(raw).not.toContain('38.41');
    expect(raw).toContain('Efectivo');
    expect(raw).toContain('Tarjeta');
    expect(raw).toContain('ITNL a Centro');
    expect(raw).not.toContain('→');
  });

  it('indica cuando no hubo viajes', () => {
    const raw = buildWeeklyReportPdf({
      ...base,
      totals: { trips: 0, passengers: 0, gross: 0, retained: 0, net: 0 },
      trips: [],
    }).output();
    expect(raw).toContain('ganaste $0.00');
    expect(raw).toContain('No hubo viajes realizados en esta semana.');
  });

  it('reparte muchos viajes en varias páginas y numera cada una', () => {
    const trips = Array.from({ length: 60 }, (_, i) => ({
      ...base.trips[0],
      rideId: `r${i}`,
      destinationAddress: null,
    }));
    const doc = buildWeeklyReportPdf({ ...base, trips });
    const pages = doc.getNumberOfPages();
    expect(pages).toBeGreaterThan(1);
    expect(doc.output()).toContain(`Pagina ${pages} de ${pages}`);
  });
});
});

