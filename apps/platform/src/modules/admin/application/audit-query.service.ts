import type {
  AuditEventItem,
  AuditQueryParams,
  AuditQueryResult
} from '@xht/contracts';
import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';

export class AuditQueryInvalidError extends Error {
  public constructor(reason: string) {
    super(`AUDIT_QUERY_INVALID:${reason}`);
    this.name = 'AuditQueryInvalidError';
  }
}

const CATEGORY_PREFIXES: ReadonlySet<string> = new Set([
  'ADMIN_API_',
  'WITHDRAWAL_',
  'EXCHANGE_',
  'PAYOUT_',
  'DEPOSIT_',
  'TRANSFER_',
  'SECURITY_',
  'IDENTITY_'
]);

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

interface AuditRow {
  audit_event_id: string;
  event_type: string;
  actor_type: string;
  actor_ref: string;
  subject_ref: string;
  outcome: string;
  correlation_id: string;
  occurred_at: Date;
}

function toItem(row: AuditRow): AuditEventItem {
  return Object.freeze({
    auditEventId: row.audit_event_id,
    eventType: row.event_type,
    actorType: row.actor_type,
    actorRef: row.actor_ref,
    subjectRef: row.subject_ref,
    outcome: row.outcome,
    correlationId: row.correlation_id,
    occurredAt: row.occurred_at.toISOString()
  });
}

/**
 * Read-only audit event retrieval: time-window, actor, and
 * whitelisted category-prefix filters with keyset pagination (no
 * OFFSET deep scans). The endpoint writes nothing — retrieval never
 * alters the append-only audit trail it reads.
 */
export class AuditQueryService {
  readonly #unitOfWork: UnitOfWork;

  constructor(unitOfWork: UnitOfWork) {
    this.#unitOfWork = unitOfWork;
  }

  public async query(
    params: AuditQueryParams
  ): Promise<AuditQueryResult> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    const add = (sqlFragment: string, value: unknown): void => {
      values.push(value);
      conditions.push(
        sqlFragment.replaceAll('$N', `$${values.length}`)
      );
    };
    if (params.from !== undefined) {
      const from = Date.parse(params.from);
      if (!Number.isFinite(from)) {
        throw new AuditQueryInvalidError('from');
      }
      add('occurred_at >= $N::timestamptz', params.from);
    }
    if (params.to !== undefined) {
      const to = Date.parse(params.to);
      if (!Number.isFinite(to)) {
        throw new AuditQueryInvalidError('to');
      }
      add('occurred_at < $N::timestamptz', params.to);
    }
    if (params.actor !== undefined) {
      if (!/^[A-Za-z0-9-]{1,64}$/u.test(params.actor)) {
        throw new AuditQueryInvalidError('actor');
      }
      add('actor_ref = $N', params.actor);
    }
    if (params.category !== undefined) {
      if (!CATEGORY_PREFIXES.has(params.category)) {
        throw new AuditQueryInvalidError('category');
      }
      add("event_type LIKE $N || '%'", params.category);
    }
    let cursorOccurredAt = '';
    let cursorId = '';
    if (params.cursor !== undefined) {
      const match =
        /^([0-9]{4}-[0-9]{2}-[0-9]{2}T[^~]+)~([0-9a-f-]{36})$/u.exec(
          params.cursor
        );
      if (match === null) {
        throw new AuditQueryInvalidError('cursor');
      }
      cursorOccurredAt = match[1]!;
      cursorId = match[2]!;
      values.push(cursorOccurredAt, cursorId);
      const at = `$${values.length - 1}`;
      const id = `$${values.length}`;
      conditions.push(
        `(occurred_at, audit_event_id) < (${at}::timestamptz, ${id}::uuid)`
      );
    }
    const limit = Math.min(
      Math.max(params.limit ?? DEFAULT_LIMIT, 1),
      MAX_LIMIT
    );
    values.push(limit + 1);
    const limitParam = `$${values.length}`;
    const where = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';
    const rows = await this.#unitOfWork.execute((context) =>
      context.executeSql<AuditRow>(
        `SELECT audit_event_id, event_type, actor_type, actor_ref,
                subject_ref, outcome, correlation_id, occurred_at
           FROM audit_events
           ${where}
           ORDER BY occurred_at DESC, audit_event_id DESC
           LIMIT ${limitParam}`,
        values
      )
    );
    const hasMore = rows.rows.length > limit;
    const page = rows.rows.slice(0, limit).map(toItem);
    const last = page.at(-1);
    return Object.freeze({
      items: Object.freeze(page),
      nextCursor:
        hasMore && last !== undefined
          ? `${last.occurredAt}~${last.auditEventId}`
          : null
    });
  }
}
