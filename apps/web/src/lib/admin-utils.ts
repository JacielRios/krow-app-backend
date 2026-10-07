export function apiBaseUrl(value: string | undefined) {
  if (!value) throw new Error('Falta configurar NEXT_PUBLIC_API_URL.');
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol))
    throw new Error('La URL de la API no es válida.');
  return `${url.origin}${url.pathname.replace(/\/+$/, '').replace(/\/v1$/, '')}/v1`;
}

export function queryString(
  values: Record<string, string | number | undefined>,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && String(value).trim())
      params.set(key, String(value));
  }
  return params.toString();
}

const labels: Record<string, string> = {
  approved: 'Aprobado',
  pending: 'Pendiente',
  suspended: 'Suspendido',
  inactive: 'Inactivo',
  active: 'Activo',
  rejected: 'Rechazado',
  expired: 'Vencido',
  valid: 'En regla',
  incomplete: 'Documentación incompleta',
  scheduled: 'Programado',
  full: 'Sin asientos',
  in_progress: 'En curso',
  completed: 'Finalizado',
  cancelled: 'Cancelado',
  canceled: 'Cancelado',
  confirmed: 'Confirmado',
  boarded: 'A bordo',
  dropped_off: 'Descenso completado',
  no_show: 'Ausente',
  paid: 'Cobrado',
  collected: 'Cobrado',
  voided: 'Anulado',
  void: 'Anulado',
  not_required: 'No requerido',
  ready: 'En regla',
  attention: 'Requiere revisión',
  identity: 'Identificación',
  other: 'Otro',
  license: 'Licencia',
  identification: 'Identificación',
  insurance: 'Seguro',
  registration: 'Tarjeta de circulación',
  driver_license: 'Licencia',
  vehicle_registration: 'Tarjeta de circulación',
};
export function statusLabel(value: string) {
  return labels[value] ?? value.replace(/_/g, ' ');
}

export function formatMoney(cents: number | null | undefined) {
  return cents === null || cents === undefined
    ? 'No disponible'
    : new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: 'MXN',
      }).format(cents / 100);
}

export function formatDate(value: string | null | undefined, withTime = false) {
  if (!value) return 'Sin registrar';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00`)
    : new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Sin registrar';
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short', timeZone: 'America/Monterrey' } : {}),
  }).format(date);
}

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
];
export function validateDocumentFile(file: { size: number; type: string }) {
  if (!DOCUMENT_MIME_TYPES.includes(file.type))
    return 'Selecciona un PDF, JPG o PNG.';
  if (file.size <= 0 || file.size > MAX_DOCUMENT_BYTES)
    return 'El archivo debe pesar entre 1 byte y 10 MB.';
  return null;
}

export function readableError(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'No se pudo completar la acción. Intenta nuevamente.';
}
