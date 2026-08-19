export interface ReconciliationTaskResult {
  readonly discrepancies: number;
  readonly alertsRecorded: number;
  readonly windowKey: string;
}

/**
 * Scheduled reconciliation: delegates to the platform ReconciliationService
 * via its built dist output. Runs the three ledger checks and records
 * discrepancy alerts into risk_decisions (idempotent per time window).
 * Discrepancies are never auto-repaired.
 */
export class ReconciliationTask {
  readonly #platformPool: { connect(): Promise<unknown>; end(): Promise<void> };
  readonly #username: string;
  readonly #distRoot: string;

  constructor(
    platformPool: { connect(): Promise<unknown>; end(): Promise<void> },
    platformUsername: string,
    distRoot?: string
  ) {
    this.#platformPool = platformPool;
    this.#username = platformUsername;
    this.#distRoot =
      distRoot ??
      new URL('../../../../apps/platform/dist/', import.meta.url).pathname;
  }

  public async runOnce(windowKey?: string): Promise<ReconciliationTaskResult> {
    const key = windowKey ?? this.#currentWindowKey();
    const [reconciliationModule, repositoryModule, uowModule, dbModule, kyselyModule] =
      await Promise.all([
        import(/* @vite-ignore */ `${this.#distRoot}modules/ledger/application/reconciliation.service.js`),
        import(/* @vite-ignore */ `${this.#distRoot}modules/ledger/infrastructure/postgres-ledger.repository.js`),
        import(/* @vite-ignore */ `${this.#distRoot}infrastructure/database/unit-of-work.js`),
        import(/* @vite-ignore */ `${this.#distRoot}infrastructure/database/database.js`),
        import('kysely')
      ]);
    const kysely = new kyselyModule.Kysely({
      dialect: new kyselyModule.PostgresDialect({
        pool: new dbModule.RoleEnforcingPostgresPool(
          this.#platformPool as never,
          this.#username
        )
      })
    });
    const unitOfWork = uowModule.createUnitOfWork(kysely);
    const reconciliation = new reconciliationModule.ReconciliationService(
      unitOfWork,
      new repositoryModule.PostgresLedgerAccountRepository()
    );
    const report = await reconciliation.runAll();
    const alerts = await reconciliation.recordDiscrepancyAlerts(report, key);
    return {
      discrepancies: report.discrepancies.length,
      alertsRecorded: alerts,
      windowKey: key
    };
  }

  #currentWindowKey(): string {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(
      now.getUTCDate()
    ).padStart(2, '0')}T${String(now.getUTCHours()).padStart(2, '0')}`;
  }
}
