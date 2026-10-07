export interface ApiErrorContract {
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

export interface HealthContract {
  status: 'ok';
  service: 'krow-api';
  timestamp: string;
}
export type * from './realtime.js';
