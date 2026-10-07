import { useEffect, useState } from "react";
import { createKrowApiClient } from "@krow/api-client";
import type { Range } from "./mockData";

// Debe coincidir con lo que regresa reports.service.ts en el backend.
export interface DashboardData {
  completed: number;
  cancelled: number;
  ongoing: number;
  activeDrivers: number;
  inactiveDrivers: number;
  passengers: number;
  occupancy: number;
  revenue: number;
  paid: number | null;
  pending: number | null;
  trend: { date: string; completed: number; cancelled: number; revenue: number }[];
  topRoutes: { route: string; trips: number; occupancy: number; revenue: number }[];
}

interface State {
  data: DashboardData | null;
  loading: boolean;
  error: string | null;
}

// AJUSTA ESTO: la URL donde corre tu apps/api en desarrollo.
// Si tu equipo usa otro puerto, cámbialo aquí.
const API_BASE_URL = "http://localhost:3001";

export function useDashboardData(range: Range, getAccessToken: () => Promise<string | null>) {
  const [state, setState] = useState<State>({ data: null, loading: true, error: null });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const client = createKrowApiClient({ baseUrl: API_BASE_URL, getAccessToken });
        const data = await client.request<DashboardData>(
          `/reports/dashboard-summary?from=${range.from}&to=${range.to}`,
        );
        if (!cancelled) setState({ data, loading: false, error: null });
      } catch (err) {
        if (!cancelled) {
          setState({
            data: null,
            loading: false,
            error: err instanceof Error ? err.message : "Error al cargar el dashboard",
          });
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to]);

  return state;
}
