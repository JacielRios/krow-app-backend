'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAdminAuth } from './admin-auth';
import { apiBaseUrl, readableError } from './admin-utils';

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  signal?: AbortSignal;
};
export function useAdminApi() {
  const { getAccessToken, invalidate } = useAdminAuth();
  return useCallback(
    async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
      const token = await getAccessToken();
      const response = await fetch(
        `${apiBaseUrl(process.env.NEXT_PUBLIC_API_URL)}${path}`,
        {
          method: options.method ?? 'GET',
          signal: options.signal,
          cache: 'no-store',
          headers: {
            Authorization: `Bearer ${token}`,
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        },
      );
      if (response.status === 401 || response.status === 403) {
        const message =
          response.status === 401
            ? 'Tu sesión expiró. Vuelve a iniciar sesión.'
            : 'Tu cuenta ya no tiene permiso para esta acción.';
        invalidate(message);
        throw new Error(message);
      }
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        const message = result?.message;
        throw new Error(
          typeof message === 'string'
            ? message
            : Array.isArray(message)
              ? message.join('. ')
              : 'No se pudo completar la acción. Intenta nuevamente.',
        );
      }
      return response.status === 204 ? (undefined as T) : response.json();
    },
    [getAccessToken, invalidate],
  );
}

export interface AdminPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export function useAdminResource<T>(path: string) {
  const request = useAdminApi();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void request<T>(path, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(readableError(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [request, path, revision]);
  return { data, loading, error, reload };
}
