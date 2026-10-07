'use client';
import { useEffect, useState } from 'react';
import { useAdminApi } from '@/lib/admin-api';
import type { DashboardData, Range } from './dashboard-data';

interface State {
  key: string;
  data: DashboardData | null;
  loading: boolean;
  error: string | null;
}

export function useDashboardData(range: Range) {
  const request = useAdminApi();
  const key = `${range.from}:${range.to}`;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({
    key,
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();
    setState((previous) => ({
      key,
      data: previous.key === key ? previous.data : null,
      loading: true,
      error: null,
    }));
    const query = new URLSearchParams({ from: range.from, to: range.to });
    request<DashboardData>(`/reports/dashboard-summary?${query}`, {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted)
          setState({ key, data, loading: false, error: null });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState((previous) => ({
            ...previous,
            key,
            loading: false,
            error:
              error instanceof Error
                ? error.message
                : 'No fue posible consultar los indicadores.',
          }));
      });
    return () => controller.abort();
  }, [key, range.from, range.to, attempt, request]);

  return {
    data: state.key === key ? state.data : null,
    loading: state.key !== key || state.loading,
    error: state.key === key ? state.error : null,
    reload: () => setAttempt((value) => value + 1),
  };
}
