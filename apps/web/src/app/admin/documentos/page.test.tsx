import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  resource: vi.fn(),
  reload: vi.fn(),
  upload: vi.fn(),
  storage: vi.fn(),
}));
vi.mock('@/lib/admin-api', () => ({
  useAdminApi: () => mocks.request,
  useAdminResource: mocks.resource,
}));
vi.mock('@/lib/admin-supabase', () => ({
  getAdminSupabase: () => ({ storage: { from: mocks.storage } }),
}));
import DocumentsPage from './page';
const pending = {
  documentId: 'document-1',
  driverId: 'driver-1',
  vehicleId: null,
  driverName: 'Ana Test',
  kind: 'license',
  status: 'pending',
  uploadState: 'pending',
  expiresAt: null,
  fileName: 'license.pdf',
  contentType: 'application/pdf',
  sizeBytes: 10,
  createdAt: '2026-10-07T15:00:00Z',
  reviewNotes: null,
  isExpired: false,
};
describe('private document administration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    mocks.resource.mockImplementation((path: string) => ({
      data: {
        items: path.startsWith('/admin/drivers')
          ? [
              {
                driverId: 'driver-1',
                fullName: 'Ana Test',
                email: 'ana@example.com',
              },
            ]
          : path.startsWith('/admin/documents')
            ? [pending]
            : [],
        total: 1,
        page: 1,
        pageSize: 20,
      },
      loading: false,
      error: null,
      reload: mocks.reload,
    }));
    mocks.upload.mockResolvedValue({ error: null });
    mocks.storage.mockReturnValue({ uploadToSignedUrl: mocks.upload });
    mocks.request.mockImplementation((path: string) =>
      Promise.resolve(
        path === '/admin/documents/uploads'
          ? {
              document: pending,
              path: 'private-test-file',
              token: 'signed-test-token',
              signedUrl: 'https://project.example',
            }
          : {},
      ),
    );
  });
  it('cannot approve a document before the private file is uploaded', () => {
    render(<DocumentsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Revisar' }));
    expect(
      within(screen.getByRole('dialog')).getByRole('option', {
        name: 'Aprobado',
      }),
    ).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'Abrir archivo' }),
    ).not.toBeInTheDocument();
  });
  it('rejects unsupported files before asking the backend for an upload URL', async () => {
    render(<DocumentsPage />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Registrar documento' }),
    );
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('Conductor'), {
      target: { value: 'driver-1' },
    });
    fireEvent.change(dialog.getByLabelText(/Archivo PDF/), {
      target: {
        files: [new File(['html'], 'script.html', { type: 'text/html' })],
      },
    });
    fireEvent.submit(
      dialog.getByRole('button', { name: 'Subir documento' }).closest('form')!,
    );
    await waitFor(() =>
      expect(dialog.getByRole('alert')).toHaveTextContent('Selecciona un PDF'),
    );
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('retries confirmation without uploading twice or creating another document', async () => {
    let completed = 0;
    mocks.request.mockImplementation((path: string) => {
      if (path === '/admin/documents/uploads')
        return Promise.resolve({
          document: pending,
          path: 'private-test-file',
          token: 'signed-test-token',
        });
      if (path.endsWith('/complete') && ++completed === 1)
        return Promise.reject(new Error('Intenta nuevamente'));
      return Promise.resolve({});
    });
    render(<DocumentsPage />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Registrar documento' }),
    );
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('Conductor'), {
      target: { value: 'driver-1' },
    });
    const file = new File(['pdf'], 'license.pdf', { type: 'application/pdf' });
    fireEvent.change(dialog.getByLabelText(/Archivo PDF/), {
      target: { files: [file] },
    });
    fireEvent.submit(
      dialog.getByRole('button', { name: 'Subir documento' }).closest('form')!,
    );
    await waitFor(() =>
      expect(dialog.getByRole('button', { name: 'Reintentar' })).toBeEnabled(),
    );
    expect(mocks.storage).toHaveBeenCalledWith('krow-admin-documents');
    expect(mocks.upload).toHaveBeenCalledWith(
      'private-test-file',
      'signed-test-token',
      file,
      { contentType: 'application/pdf' },
    );
    fireEvent.click(dialog.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Documento recibido',
      ),
    );
    expect(
      mocks.request.mock.calls.filter(
        ([path]) => path === '/admin/documents/uploads',
      ),
    ).toHaveLength(1);
    expect(mocks.upload).toHaveBeenCalledOnce();
    expect(completed).toBe(2);
  });
});
