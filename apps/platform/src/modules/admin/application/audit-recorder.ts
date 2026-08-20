import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';

export interface AuditRecordInput {
  readonly eventType: string;
  readonly actorType: 'ADMIN' | 'ANONYMOUS' | 'SYSTEM';
  readonly actorRef: string;
  readonly subjectRef: string;
  readonly outcome: string;
  readonly correlationId: string;
}

/**
 * Append-only audit writer: every admin API request — granted or
 * denied — lands here exactly once; the underlying table grants
 * INSERT only, so recorded history cannot be rewritten through the
 * application role.
 */
export class AuditRecorder {
  readonly #unitOfWork: UnitOfWork;

  constructor(unitOfWork: UnitOfWork) {
    this.#unitOfWork = unitOfWork;
  }

  public async record(input: AuditRecordInput): Promise<void> {
    await this.#unitOfWork.execute((context) =>
      context.executeSql(
        `INSERT INTO audit_events
           (event_type, actor_type, actor_ref, subject_ref, outcome,
            correlation_id, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6::uuid, clock_timestamp())`,
        [
          input.eventType,
          input.actorType,
          input.actorRef,
          input.subjectRef,
          input.outcome,
          input.correlationId
        ]
      )
    );
  }
}
