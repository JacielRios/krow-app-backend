import type { ApiErrorContract } from '@krow/contracts';

export interface KrowApiClientOptions {
  baseUrl: string;
  getAccessToken?: () => Promise<string | null>;
}

export function createKrowApiClient(options: KrowApiClientOptions) {
  return {
    async request<T>(path: string, init: RequestInit = {}): Promise<T> {
      const token = await options.getAccessToken?.();
      const response = await fetch(`${options.baseUrl}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...init.headers,
        },
      });

      if (!response.ok) {
        const error = (await response.json()) as ApiErrorContract;
        throw new Error(error.message ?? 'No fue posible completar la solicitud');
      }

      return (await response.json()) as T;
    },
  };
}
