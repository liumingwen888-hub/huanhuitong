export interface OutboxEnvelopeV1<TPayload extends object = object> {
  readonly id: string;
  readonly topic: string;
  readonly eventKey: string;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly payload: TPayload;
}

export type OutboxStatus =
  | 'READY'
  | 'LEASED'
  | 'SUCCEEDED'
  | 'RETRY_WAIT'
  | 'DEAD_LETTER'
  | 'PAUSED'
  | 'WAITING_CONFIGURATION';

export type DurableJobStatus = OutboxStatus;

export interface LeasedOutboxMessage<TPayload extends object = object>
  extends OutboxEnvelopeV1<TPayload> {
  readonly workerId: string;
  readonly leaseToken: string;
  readonly lockGeneration: number;
  readonly lockedUntil: string;
}

export interface OutboxHandler<TPayload extends object = object> {
  handle(message: LeasedOutboxMessage<TPayload>): Promise<void>;
}

export interface OutboxRunResult {
  readonly claimed: number;
  readonly succeeded: number;
  readonly retrying: number;
}

export type WorkerErrorClassification =
  | 'TRANSIENT'
  | 'PERMANENT'
  | 'DISABLED';

export interface WorkerFailureMarker {
  readonly workerFailureClassification: WorkerErrorClassification;
}

export function isWorkerFailureMarker(
  value: unknown
): value is WorkerFailureMarker {
  if (typeof value !== 'object' || value === null) return false;
  const marker = (
    value as Record<string, unknown>
  ).workerFailureClassification;
  return (
    marker === 'TRANSIENT' ||
    marker === 'PERMANENT' ||
    marker === 'DISABLED'
  );
}

export const WORKER_BACKOFF_BASE_MILLIS = 1_000;
export const WORKER_BACKOFF_CAP_MILLIS = 900_000;
export const WORKER_MAX_TRANSIENT_ATTEMPTS = 8;

export interface DurableJobEnvelopeV1<TPayload extends object = object> {
  readonly jobType: string;
  readonly businessKey: string;
  readonly payload: TPayload;
}

export type ReliabilityErrorCode =
  | 'OUTBOX_COMMAND_INVALID'
  | 'OUTBOX_DUPLICATE_EVENT_KEY'
  | 'OUTBOX_STALE_LEASE'
  | 'JOB_COMMAND_INVALID'
  | 'JOB_DUPLICATE_BUSINESS_KEY';
