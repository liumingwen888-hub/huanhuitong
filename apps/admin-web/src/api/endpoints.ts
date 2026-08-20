import { apiFetch } from './client.js';

const BASE = '/api';

export interface LoginResponse {
  readonly token: string;
  readonly expiresAt: string;
}

export interface ApprovalItem {
  readonly itemId: string;
  readonly kind: string;
  readonly uid: string;
  readonly amount: string;
  readonly assetOrRoute: string;
  readonly status: string;
  readonly createdAt: string;
}

export interface WatchItem {
  readonly itemId: string;
  readonly kind: string;
  readonly domain: string;
  readonly uid: string;
  readonly amount: string;
  readonly assetOrRoute: string;
  readonly status: string;
  readonly ageMinutes: number;
}

export interface AuditEvent {
  readonly auditEventId: string;
  readonly eventType: string;
  readonly actorType: string;
  readonly actorRef: string;
  readonly subjectRef: string;
  readonly outcome: string;
  readonly correlationId: string;
  readonly occurredAt: string;
}

export interface ConfigDraft {
  readonly draftId: string;
  readonly targetTable: string;
  readonly targetKey: string;
  readonly makerAdminId: string;
  readonly draftStatus: string;
  readonly payload: Record<string, unknown>;
}

export function login(
  fetchImpl: typeof fetch,
  body: { username: string; password: string; totpCode: string }
): Promise<LoginResponse> {
  return apiFetch(fetchImpl, 'POST', `${BASE}/admin/auth/session`, { body });
}

export function logout(fetchImpl: typeof fetch, token: string): Promise<null> {
  return apiFetch(fetchImpl, 'DELETE', `${BASE}/admin/auth/session`, {
    token
  });
}

export function elevate(
  fetchImpl: typeof fetch,
  token: string,
  body: { password: string; totpCode: string }
): Promise<unknown> {
  return apiFetch(fetchImpl, 'POST', `${BASE}/admin/auth/elevation`, {
    token, body
  });
}

export function pendingApprovals(
  fetchImpl: typeof fetch,
  token: string
): Promise<{ items: ApprovalItem[] }> {
  return apiFetch(fetchImpl, 'GET', `${BASE}/admin/approvals/pending`, {
    token
  });
}

export function decideWithdrawal(
  fetchImpl: typeof fetch,
  token: string,
  withdrawalId: string,
  body: { decision: 'APPROVE' | 'REJECT'; reason?: string }
): Promise<unknown> {
  return apiFetch(
    fetchImpl,
    'POST',
    `${BASE}/admin/approvals/withdrawal/${withdrawalId}/decide`,
    { token, body }
  );
}

export function resolvePayout(
  fetchImpl: typeof fetch,
  token: string,
  payoutOrderId: string
): Promise<unknown> {
  return apiFetch(
    fetchImpl,
    'POST',
    `${BASE}/admin/approvals/payout/${payoutOrderId}/resolve`,
    { token }
  );
}

export function reconciliation(
  fetchImpl: typeof fetch,
  token: string
): Promise<unknown> {
  return apiFetch(fetchImpl, 'GET', `${BASE}/admin/ops/reconciliation`, {
    token
  });
}

export function watchlist(
  fetchImpl: typeof fetch,
  token: string
): Promise<{ items: WatchItem[] }> {
  return apiFetch(fetchImpl, 'GET', `${BASE}/admin/ops/watchlist`, {
    token
  });
}

export function auditEvents(
  fetchImpl: typeof fetch,
  token: string,
  query: Record<string, string>
): Promise<{ items: AuditEvent[]; nextCursor: string | null }> {
  return apiFetch(fetchImpl, 'GET', `${BASE}/admin/audit/events`, {
    token, query
  });
}

export function createDraft(
  fetchImpl: typeof fetch,
  token: string,
  body: {
    targetTable: string;
    targetKey: string;
    payload: Record<string, unknown>;
  }
): Promise<ConfigDraft> {
  return apiFetch(fetchImpl, 'POST', `${BASE}/admin/config/drafts`, {
    token, body
  });
}

export function listDrafts(
  fetchImpl: typeof fetch,
  token: string
): Promise<{ items: ConfigDraft[] }> {
  return apiFetch(fetchImpl, 'GET', `${BASE}/admin/config/drafts`, {
    token
  });
}

export function settleDraft(
  fetchImpl: typeof fetch,
  token: string,
  draftId: string,
  action: 'publish' | 'reject'
): Promise<unknown> {
  return apiFetch(
    fetchImpl,
    'POST',
    `${BASE}/admin/config/drafts/${draftId}/${action}`,
    { token }
  );
}
