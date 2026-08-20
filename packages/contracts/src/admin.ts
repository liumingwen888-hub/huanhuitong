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

export type AdminApiErrorCode =
  | 'ADMIN_API_NOT_FOUND'
  | 'ADMIN_API_METHOD_INVALID'
  | 'ADMIN_API_SESSION_REQUIRED'
  | 'ADMIN_API_ROLE_DENIED'
  | 'ADMIN_API_ELEVATION_REQUIRED';

export interface AdminApiRequest {
  readonly method: 'GET' | 'POST' | 'DELETE';
  readonly path: string;
  readonly bearerToken?: string;
  readonly body?: unknown;
}

export interface AdminApiResponse {
  readonly status: number;
  readonly body: unknown;
}

export type ApprovalItemKind =
  | 'WITHDRAWAL_APPROVAL'
  | 'PAYOUT_UNKNOWN';

export interface ApprovalItem {
  readonly itemId: string;
  readonly kind: ApprovalItemKind;
  readonly uid: string;
  readonly amount: string;
  readonly assetOrRoute: string;
  readonly status: string;
  readonly createdAt: string;
}
