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
  readonly query?: Readonly<Record<string, string>>;
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

export type WatchItemKind =
  | 'SETTLE_PENDING'
  | 'RELEASE_PENDING'
  | 'UNKNOWN';

export interface WatchItem {
  readonly itemId: string;
  readonly kind: WatchItemKind;
  readonly domain: 'WITHDRAWAL' | 'EXCHANGE' | 'PAYOUT';
  readonly uid: string;
  readonly amount: string;
  readonly assetOrRoute: string;
  readonly status: string;
  readonly ageMinutes: number;
}

export interface AuditEventItem {
  readonly auditEventId: string;
  readonly eventType: string;
  readonly actorType: string;
  readonly actorRef: string;
  readonly subjectRef: string;
  readonly outcome: string;
  readonly correlationId: string;
  readonly occurredAt: string;
}

export interface AuditQueryParams {
  readonly from?: string;
  readonly to?: string;
  readonly actor?: string;
  readonly category?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface AuditQueryResult {
  readonly items: readonly AuditEventItem[];
  readonly nextCursor: string | null;
}
