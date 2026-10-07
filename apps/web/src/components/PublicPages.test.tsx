import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LandingPage from './LandingPage';
import ContactoPage from './ContactoPage';
import TerminosPage from './TerminosPage';
import { contactDraft } from './public-config';

const { config } = vi.hoisted(() => ({
  config: {
    supportEmail: null as string | null,
    supportUrl: null as string | null,
    privacyUrl: null as string | null,
    termsUrl: null as string | null,
    androidDownloadUrl: null as string | null,
  },
}));
vi.mock('./public-config', async (importOriginal) => {
  const module = await importOriginal<typeof import('./public-config')>();
  return { ...module, publicConfig: config };
});

beforeEach(() => {
  Object.keys(config).forEach((key) => {
    config[key as keyof typeof config] = null;
  });
});

describe('landing integrada de Persona 2', () => {
  it('conserva las secciones, enlaza al login y comunica el piloto sin cifras inventadas ni rutas rotas', () => {
    render(<LandingPage />);
    expect(
      screen.getByRole('link', { name: 'Acceso administrativo' }),
    ).toHaveAttribute('href', '/admin/login');
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Comparte el camino, no el costo' }),
    ).toBeVisible();
    expect(screen.getByText('Punto de salida de los viajes')).toBeVisible();
    expect(document.body.textContent).not.toMatch(
      /12,000|3,200|4\.8\/5|8 Ciudades/,
    );
    expect(document.querySelector('a[href="/registro"]')).toBeNull();
    expect(document.querySelector('a[href="/Dashboards"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Conductores' }));
    expect(
      screen.getByText(
        'Recibe el pago en efectivo y registra su recepción desde la app.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Conductores' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
  it('el menú móvil informa su estado y se cierra al seguir un enlace', () => {
    render(<LandingPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú' }));
    expect(screen.getByRole('button', { name: 'Cerrar menú' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'Principal' })).getByRole(
        'link',
        { name: 'Contacto' },
      ),
    );
    expect(screen.getByRole('button', { name: 'Abrir menú' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
  it('muestra el APK público únicamente si hay una URL configurada', () => {
    config.androidDownloadUrl = 'https://example.test/krow.apk';
    render(<LandingPage />);
    expect(
      screen.getAllByRole('link', { name: 'Probar en Android' })[0],
    ).toHaveAttribute('href', config.androidDownloadUrl);
  });
});

describe('contacto y documentos públicos', () => {
  it('no confirma envíos ni muestra un correo ficticio cuando no hay canal configurado', () => {
    render(<ContactoPage />);
    expect(
      screen.getByText(/canal de contacto del piloto aún no está publicado/),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /enviar/i }),
    ).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('contacto@krow.app');
  });
  it('prepara un borrador real para el correo configurado sin afirmar que ya fue enviado', () => {
    config.supportEmail = 'piloto@example.test';
    render(<ContactoPage />);
    fireEvent.change(screen.getByLabelText('Nombre'), {
      target: { value: 'Ana' },
    });
    fireEvent.change(screen.getByLabelText('Correo electrónico'), {
      target: { value: 'ana@example.test' },
    });
    fireEvent.change(screen.getByLabelText('Mensaje'), {
      target: { value: 'Consulta & reserva' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preparar correo' }));
    const draft = screen
      .getByRole('link', { name: 'Abrir borrador' })
      .getAttribute('href')!;
    expect(draft).toMatch(/^mailto:piloto@example.test\?/);
    expect(new URLSearchParams(draft.split('?')[1]).get('body')).toContain(
      'Consulta & reserva',
    );
    expect(screen.queryByText(/Mensaje enviado/)).not.toBeInTheDocument();
  });
  it('distingue información funcional de un aviso legal todavía no aprobado', () => {
    render(<TerminosPage privacy />);
    expect(screen.getByText(/no sustituye ese documento/)).toBeVisible();
    expect(screen.getByText(/plazos de conservación/)).toBeVisible();
    expect(document.body.textContent).not.toContain('[Placeholder]');
  });
  it('enlaza a la política publicada cuando se configura', () => {
    config.privacyUrl = 'https://example.test/aviso';
    render(<TerminosPage privacy />);
    expect(
      screen.getByRole('link', { name: 'Abrir aviso de privacidad' }),
    ).toHaveAttribute('href', config.privacyUrl);
  });
  it('codifica el correo y los saltos de línea al preparar el borrador', () => {
    const draft = contactDraft('piloto@example.test', {
      name: 'Ana',
      sender: 'ana@example.test',
      topic: 'Consulta & soporte',
      message: 'Línea 1\nLínea 2',
    });
    const query = new URLSearchParams(draft.split('?')[1]);
    expect(query.get('subject')).toBe('KROW · Consulta & soporte');
    expect(query.get('body')).toContain('Línea 1\nLínea 2');
  });
});
