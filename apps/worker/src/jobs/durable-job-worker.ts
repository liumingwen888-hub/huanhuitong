import {
  isWorkerFailureMarker,
  type WorkerErrorClassification
} from '@xht/contracts';
import type {
  StoreClient,
  StoreConnectionFactory
} from '../outbox/outbox-store.js';

export interface DurableJobHandler {
  handleJob(job: LeasedDurableJob): Promise<void>;
}

export interface LeasedDurableJob {
  readonly jobId: string;
  readonly jobType: string;
  readonly businessKey: string;
  readonly payload: Record<string, unknown>;
  readonly workerId: string;
  readonly leaseToken: string;
  readonly lockGeneration: number;
  readonly attemptCount: number;
}

export interface DurableJobRunResult {
  readonly claimed: number;
  readonly succeeded: number;
  readonly retrying: number;
}

interface ClaimedJobRow {
  readonly job_id: string;
  readonly job_type: string;
  readonly business_key: string;
  readonly payload: Record<string, unknown>;
  readonly locked_by: string;
  readonly lease_token: string;
  readonly lock_generation: number;
  readonly attempt_count: number;
}

export function classifyJobWorkerError(
  error: unknown
): WorkerErrorClassification {
  if (isWorkerFailureMarker(error)) {
    return error.workerFailureClassification;
  }
  return 'TRANSIENT';
}

export class DurableJobWorker {
  readonly #connections: StoreConnectionFactory;
  readonly #handler: DurableJobHandler;
  readonly #workerId: string;
  readonly #limit: number;
  readonly #leaseMilliseconds: number;

  public constructor(
    connections: StoreConnectionFactory,
    handler: DurableJobHandler,
    workerId: string,
    options?: {
      limit?: number;
      leaseMilliseconds?: number;
    }
  ) {
    this.#connections = connections;
    this.#handler = handler;
    this.#workerId = workerId;
    this.#limit = options?.limit ?? 10;
    this.#leaseMilliseconds = options?.leaseMilliseconds ?? 30_000;
  }

  public async runOnce(): Promise<DurableJobRunResult> {
    const claimed = await this.#connections.withClient((client) =>
      client.query<ClaimedJobRow>(
        `WITH database_time AS (
           SELECT clock_timestamp() AS value
         ),
         candidates AS (
           SELECT jobs.job_id
             FROM durable_jobs AS jobs, database_time
            WHERE (
                jobs.status = 'READY'
                AND jobs.available_at <= database_time.value
              )
               OR (
                jobs.status = 'RETRY_WAIT'
                AND jobs.available_at <= database_time.value
              )
               OR (
                jobs.status = 'LEASED'
                AND jobs.locked_until <= database_time.value
              )
            ORDER BY jobs.created_at, jobs.job_id
            LIMIT $2
            FOR UPDATE OF jobs SKIP LOCKED
         )
         UPDATE durable_jobs AS jobs
            SET status = 'LEASED',
                locked_by = $1,
                lease_token = gen_random_uuid(),
                lock_generation = jobs.lock_generation + 1,
                locked_until =
                  (SELECT value FROM database_time) + make_interval(secs => $3 / 1000.0),
                attempt_count = jobs.attempt_count + 1
          FROM candidates
         WHERE jobs.job_id = candidates.job_id
         RETURNING jobs.job_id, jobs.job_type, jobs.business_key, jobs.payload,
                   jobs.locked_by, jobs.lease_token, jobs.lock_generation,
                   jobs.attempt_count`,
        [this.#workerId, this.#limit, this.#leaseMilliseconds]
      )
    );
    let succeeded = 0;
    let retrying = 0;
    for (const job of claimed.rows) {
      const leased: LeasedDurableJob = Object.freeze({
        jobId: job.job_id,
        jobType: job.job_type,
        businessKey: job.business_key,
        payload: Object.freeze(job.payload),
        workerId: job.locked_by,
        leaseToken: job.lease_token,
        lockGeneration: Number(job.lock_generation),
        attemptCount: Number(job.attempt_count)
      });
      const ok = await this.#deliver(leased);
      if (ok) succeeded += 1;
      else retrying += 1;
    }
    return { claimed: claimed.rows.length, succeeded, retrying };
  }

  async #deliver(job: LeasedDurableJob): Promise<boolean> {
    let classification: WorkerErrorClassification;
    try {
      await this.#handler.handleJob(job);
      const confirmed = await this.#connections.withClient((client) =>
        client.query(
          `WITH database_time AS (
             SELECT clock_timestamp() AS value
           )
           UPDATE durable_jobs AS jobs
              SET status = 'SUCCEEDED',
                  locked_by = NULL,
                  lease_token = NULL,
                  locked_until = NULL,
                  succeeded_at = (SELECT value FROM database_time)
            WHERE jobs.job_id = $1::uuid
              AND jobs.locked_by = $2
              AND jobs.lease_token = $3::uuid
              AND jobs.lock_generation = $4
              AND jobs.status = 'LEASED'
            RETURNING jobs.job_id`,
          [job.jobId, job.workerId, job.leaseToken, job.lockGeneration]
        )
      );
      return confirmed.rows.length === 1;
    } catch (error: unknown) {
      classification = classifyJobWorkerError(error);
    }
    await this.#connections.withClient((client) =>
      client.query(
        `WITH database_time AS (
           SELECT clock_timestamp() AS value
         )
         UPDATE durable_jobs AS jobs
            SET status = CASE
                  WHEN $5 = 'PERMANENT' THEN 'DEAD_LETTER'
                  WHEN $5 = 'DISABLED' THEN 'WAITING_CONFIGURATION'
                  WHEN $6::boolean THEN 'DEAD_LETTER'
                  ELSE 'RETRY_WAIT'
                END,
                locked_by = NULL,
                lease_token = NULL,
                locked_until = NULL,
                available_at = CASE
                  WHEN $5 = 'DISABLED' THEN jobs.available_at
                  ELSE (SELECT value FROM database_time) + interval '1 second'
                END
          WHERE jobs.job_id = $1::uuid
            AND jobs.locked_by = $2
            AND jobs.lease_token = $3::uuid
            AND jobs.lock_generation = $4
            AND jobs.status = 'LEASED'
          RETURNING jobs.job_id`,
        [
          job.jobId,
          job.workerId,
          job.leaseToken,
          job.lockGeneration,
          classification,
          job.attemptCount >= 8
        ]
      )
    );
    return false;
  }
}

export async function resumeWaitingConfigurationJobs(
  connections: StoreConnectionFactory,
  jobType: string
): Promise<number> {
  const result = await connections.withClient((client) =>
    client.query(
      `UPDATE durable_jobs
          SET status = 'READY', available_at = clock_timestamp()
        WHERE job_type = $1 AND status = 'WAITING_CONFIGURATION'`,
      [jobType]
    )
  );
  return result.rows.length;
}
