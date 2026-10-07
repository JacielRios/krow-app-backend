import { describe, it, expect } from 'vitest';
import {
  apiBaseUrl,
  formatDate,
  formatMoney,
  queryString,
  validateDocumentFile,
  MAX_DOCUMENT_BYTES,
} from './admin-utils';
import { decodeRoutePolyline } from './admin-route';
describe('admin API and document inputs', () => {
  it('normalizes API prefixes without producing duplicate v1', () => {
    expect(apiBaseUrl('https://api.example/v1/')).toBe(
      'https://api.example/v1',
    );
    expect(apiBaseUrl('http://localhost:3000/')).toBe(
      'http://localhost:3000/v1',
    );
    expect(() => apiBaseUrl('javascript:alert(1)')).toThrow();
  });
  it('encodes search and omits empty optional filters', () => {
    expect(
      queryString({
        q: 'Ana & José',
        status: '',
        page: 2,
        driverId: undefined,
      }),
    ).toBe('q=Ana+%26+Jos%C3%A9&page=2');
  });
  it('rejects disallowed MIME types, empty files and documents above 10 MB', () => {
    expect(validateDocumentFile({ type: 'text/html', size: 1 })).toMatch(/PDF/);
    expect(validateDocumentFile({ type: 'application/pdf', size: 0 })).toMatch(
      /10 MB/,
    );
    expect(
      validateDocumentFile({ type: 'image/png', size: MAX_DOCUMENT_BYTES + 1 }),
    ).toMatch(/10 MB/);
    expect(
      validateDocumentFile({
        type: 'application/pdf',
        size: MAX_DOCUMENT_BYTES,
      }),
    ).toBeNull();
  });
  it('retains monetary cents and handles absent dates', () => {
    expect(formatMoney(12345)).toContain('123.45');
    expect(formatMoney(null)).toBe('No disponible');
    expect(formatDate('not a date')).toBe('Sin registrar');
  });
});
describe('administrative route overview', () => {
  it('decodes real route coordinates', () => {
    expect(decodeRoutePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ]);
  });
  it('recovers from missing and truncated native geometry', () => {
    expect(decodeRoutePolyline(null)).toEqual([]);
    expect(decodeRoutePolyline('_p~iF~ps|')).toEqual([]);
    expect(decodeRoutePolyline('!!')).toEqual([]);
    expect(decodeRoutePolyline('_'.repeat(200_001))).toEqual([]);
  });
});
