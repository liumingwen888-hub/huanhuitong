import type { Uid } from '@xht/contracts';
import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';

export interface FeeCalculationInput {
  readonly assetCode: string;
  readonly amount: string;
}

export interface FeeCalculationResult {
  readonly feeVersion: number;
  readonly feeAmount: string;
}

export type RiskOperationType =
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'INTERNAL_TRANSFER'
  | 'CLAIM'
  | 'RED_PACKET'
  | 'EXCHANGE'
  | 'FIAT_PAYOUT';

export interface RiskDecision {
  readonly allowed: boolean;
  readonly reasonCode: string;
}

export type RiskErrorCode =
  | 'FEE_SCHEDULE_NOT_FOUND'
  | 'FEE_CALCULATION_INVALID'
  | 'RISK_CHECK_FAILED'
  | 'RISK_LIMIT_EXCEEDED'
  | 'CONFIG_NOT_FOUND'
  | 'ADMIN_NOT_AUTHORIZED';

export class CrosscuttingError extends Error {
  public readonly code: RiskErrorCode;
  constructor(code: RiskErrorCode) {
    super(code);
    this.name = 'CrosscuttingError';
    this.code = code;
  }
}

export class FeeCalculator {
  readonly #unitOfWork: UnitOfWork;

  constructor(unitOfWork: UnitOfWork) {
    this.#unitOfWork = unitOfWork;
  }

  public async calculate(input: FeeCalculationInput): Promise<FeeCalculationResult> {
    if (
      typeof input.assetCode !== 'string' ||
      typeof input.amount !== 'string' ||
      !/^[0-9]+$/u.test(input.amount)
    ) {
      throw new CrosscuttingError('FEE_CALCULATION_INVALID');
    }
    const result = await this.#unitOfWork.execute(async (context) => {
      const rows = await context.executeSql<{
        fee_version: number;
        basis_points: number;
        fixed_amount: string;
      }>(
        `SELECT fee_version, basis_points, fixed_amount::text AS fixed_amount
           FROM fee_schedules
          WHERE asset_code = $1
            AND fee_version = (SELECT max(fee_version) FROM fee_schedules
                                WHERE asset_code = $1)`,
        [input.assetCode]
      );
      const row = rows.rows[0];
      if (row === undefined) return null;
      const amount = BigInt(input.amount);
      const basisFee = (amount * BigInt(row.basis_points)) / 10000n;
      const fee = basisFee + BigInt(row.fixed_amount);
      return {
        feeVersion: row.fee_version,
        feeAmount: fee.toString()
      };
    });
    if (result === null) {
      throw new CrosscuttingError('FEE_SCHEDULE_NOT_FOUND');
    }
    return result;
  }
}

export class RiskGate {
  readonly #unitOfWork: UnitOfWork;

  constructor(unitOfWork: UnitOfWork) {
    this.#unitOfWork = unitOfWork;
  }

  public async check(input: {
    readonly uid: Uid;
    readonly operationType: RiskOperationType;
    readonly amount: string;
    readonly idempotencyKey: string;
  }): Promise<RiskDecision> {
    try {
      return await this.#evaluate(input);
    } catch (error) {
      if (error instanceof CrosscuttingError) throw error;
      // fail-closed: any unexpected error denies the operation
      if (process.env.S34_DEBUG) console.log('RISK-CATCH', String(error).slice(0, 200));
      return { allowed: false, reasonCode: 'RISK_CHECK_FAILED' };
    }
  }

  async #evaluate(input: {
    readonly uid: Uid;
    readonly operationType: RiskOperationType;
    readonly amount: string;
    readonly idempotencyKey: string;
  }): Promise<RiskDecision> {
    return this.#unitOfWork.execute(async (context) => {
      const existing = await context.executeSql<{ allowed: boolean; reason_code: string }>(
        `SELECT allowed, reason_code FROM risk_decisions
          WHERE idempotency_key = $1`,
        [input.idempotencyKey]
      );
      if (existing.rows.length > 0) {
        const prior = existing.rows[0]!;
        return { allowed: prior.allowed, reasonCode: prior.reason_code };
      }
      const limitRows = await context.executeSql<{
        window_seconds: number;
        max_count: number;
        max_amount: string;
      }>(
        `SELECT window_seconds, max_count, max_amount::text AS max_amount
           FROM operation_limits
          WHERE uid = $1::uuid AND operation_type = $2`,
        [input.uid, input.operationType]
      );
      const limit = limitRows.rows[0];
      let allowed = true;
      let reasonCode = 'NO_LIMIT_CONFIGURED';
      if (limit !== undefined) {
        const requestedAmount = BigInt(input.amount);
        if (requestedAmount > BigInt(limit.max_amount)) {
          allowed = false;
          reasonCode = 'RISK_LIMIT_EXCEEDED';
        }
      }
      await context.executeSql(
        `INSERT INTO risk_decisions
           (uid, operation_type, allowed, reason_code, idempotency_key)
         VALUES ($1::uuid, $2, $3, $4, $5)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [input.uid, input.operationType, allowed, reasonCode, input.idempotencyKey]
      );
      return { allowed, reasonCode };
    });
  }
}

export class ConfigStore {
  readonly #unitOfWork: UnitOfWork;

  constructor(unitOfWork: UnitOfWork) {
    this.#unitOfWork = unitOfWork;
  }

  public async current(key: string): Promise<{ readonly version: number; readonly payload: object }> {
    const result = await this.#unitOfWork.execute(async (context) => {
      const rows = await context.executeSql<{
        version: number;
        payload: object;
      }>(
        `SELECT version, payload FROM config_versions
          WHERE config_key = $1
            AND version = (SELECT max(version) FROM config_versions
                            WHERE config_key = $1)`,
        [key]
      );
      const row = rows.rows[0];
      return row === undefined ? null : { version: row.version, payload: row.payload };
    });
    if (result === null) {
      throw new CrosscuttingError('CONFIG_NOT_FOUND');
    }
    return result;
  }

  public async activate(key: string, payload: object): Promise<number> {
    return this.#unitOfWork.execute(async (context) => {
      const rows = await context.executeSql<{ next: number }>(
        `SELECT COALESCE(max(version), 0) + 1 AS next
           FROM config_versions WHERE config_key = $1`,
        [key]
      );
      const next = rows.rows[0]?.next ?? 1;
      await context.executeSql(
        `INSERT INTO config_versions (config_key, version, payload)
         VALUES ($1, $2, $3::jsonb)`,
        [key, next, JSON.stringify(payload)]
      );
      return next;
    });
  }
}

export class AdminAuthorizer {
  readonly #unitOfWork: UnitOfWork;

  constructor(unitOfWork: UnitOfWork) {
    this.#unitOfWork = unitOfWork;
  }

  public async isAuthorized(
    adminId: string,
    requiredRole: string
  ): Promise<boolean> {
    if (typeof adminId !== 'string' || adminId.length !== 36) {
      return false;
    }
    try {
      return await this.#unitOfWork.execute(async (context) => {
        const rows = await context.executeSql<{ n: number }>(
          `SELECT count(*)::int AS n
             FROM admin_principals p
             JOIN admin_role_grants g ON g.admin_id = p.admin_id
            WHERE p.admin_id = $1::uuid
              AND p.status = 'ACTIVE'
              AND g.role = $2
              AND g.revoked_at IS NULL`,
          [adminId, requiredRole]
        );
        return (rows.rows[0]?.n ?? 0) > 0;
      });
    } catch {
      return false;
    }
  }
}

Object.freeze(FeeCalculator.prototype);
Object.freeze(RiskGate.prototype);
Object.freeze(ConfigStore.prototype);
Object.freeze(AdminAuthorizer.prototype);
