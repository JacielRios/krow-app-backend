export interface AuthenticatedUser {
  id: string;
  email: string | null;
  accessToken: string;
  userMetadata: Record<string, unknown>;
  appMetadata: Record<string, unknown>;
}
