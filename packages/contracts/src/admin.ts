export interface AdminSessionSnapshot {
  readonly sessionId: string;
  readonly adminId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly elevatedUntil: string | null;
  readonly revokedAt: string | null;
}

export type AdminAuthErrorCode =
  | 'ADMIN_AUTH_INVALID'
  | 'ADMIN_AUTH_LOCKED'
  | 'ADMIN_AUTH_MFA_REQUIRED'
  | 'ADMIN_SESSION_INVALID'
  | 'ADMIN_SESSION_EXPIRED'
  | 'ADMIN_ELEVATION_REQUIRED';
