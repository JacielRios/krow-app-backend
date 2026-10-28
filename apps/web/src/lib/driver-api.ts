'use client';

import { useCallback, useEffect, useState } from 'react';
import { useDriverAuth } from './driver-session';
import { apiBaseUrl, readableError } from './admin-utils';

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
};

export function useDriverApi() {
  const { getAccessToken, invalidate } = useDriverAuth();
  return useCallback(
    async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
      const token = await getAccessToken();
      const controller = new AbortController();
      const cancel = () => controller.abort();
      if (options.signal?.aborted) cancel();
      else options.signal?.addEventListener('abort', cancel, { once: true });
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(
          `${apiBaseUrl(process.env.NEXT_PUBLIC_API_URL)}${path}`,
          {
            method: options.method ?? 'GET',
            signal: controller.signal,
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
          invalidate();
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
        return response.status === 204
          ? (undefined as T)
          : await response.json();
      } catch (error) {
        if (controller.signal.aborted && !options.signal?.aborted)
          throw new Error(
            'KROW tardó demasiado en responder. Revisa tu conexión e intenta de nuevo.',
          );
        throw error;
      } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener('abort', cancel);
      }
    },
    [getAccessToken, invalidate],
  );
}

export interface DriverPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function useDriverResource<T>(path: string) {
  const request = useDriverApi();
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
