import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';
import type {
  ConfigStore
} from '../../crosscutting/application/crosscutting.services.js';
import type {
  MarketRepository
} from '../../exchange/application/market.repository.js';
import type {
  ProviderConfigRepository
} from '../../fiatpayout/application/payout.repository.js';
import type {
  SignerPolicyRepository
} from '../../withdrawals/application/withdrawal.repository.js';

export type ConfigTargetTable =
  | 'market_configs'
  | 'provider_configs'
  | 'signer_policies'
  | 'config_versions';

export const CONFIG_TARGET_TABLES: ReadonlySet<string> = new Set([
  'market_configs',
  'provider_configs',
  'signer_policies',
  'config_versions'
]);

export type ConfigReleaseErrorCode =
  | 'CONFIG_TARGET_INVALID'
  | 'CONFIG_DRAFT_NOT_FOUND'
  | 'CONFIG_SELF_REVIEW_REJECTED'
  | 'CONFIG_DRAFT_ALREADY_SETTLED'
  | 'CONFIG_PAYLOAD_INVALID';

export class ConfigReleaseError extends Error {
  public readonly code: ConfigReleaseErrorCode;

  public constructor(code: ConfigReleaseErrorCode) {
    super(code);
    this.name = 'ConfigReleaseError';
    this.code = code;
  }
}

export interface ConfigDraftInput {
  readonly targetTable: ConfigTargetTable;
  readonly targetKey: string;
  readonly payload: Record<string, unknown>;
}

export interface ConfigDraftSnapshot {
  readonly draftId: string;
  readonly targetTable: ConfigTargetTable;
  readonly targetKey: string;
  readonly makerAdminId: string;
  readonly draftStatus: string;
  readonly createdAt: string;
  readonly payload: Record<string, unknown>;
}

type PublishOutcome =
  | { readonly outcome: 'PUBLISHED'; readonly newVersion: number }
  | { readonly outcome: 'REJECTED' };

/**
 * Maker-Checker config release: a maker drafts a new version as a
 * `draft.` prefixed config_versions row (append-only — the draft
 * status lives inside the payload, never an UPDATE), and a
 * DIFFERENT admin reviews and publishes by writing the payload into
 * the target domain's versioned table through its existing insert
 * path. The maker can never settle their own draft.
 */
export class ConfigReleaseService {
  readonly #unitOfWork: UnitOfWork;
  readonly #configStore: ConfigStore;
  readonly #markets: MarketRepository;
  readonly #providers: ProviderConfigRepository;
  readonly #policies: SignerPolicyRepository;

  constructor(
    unitOfWork: UnitOfWork,
    configStore: ConfigStore,
    markets: MarketRepository,
    providers: ProviderConfigRepository,
    policies: SignerPolicyRepository
  ) {
    this.#unitOfWork = unitOfWork;
    this.#configStore = configStore;
    this.#markets = markets;
    this.#providers = providers;
    this.#policies = policies;
  }

  public async createDraft(
    makerAdminId: string,
    input: ConfigDraftInput
  ): Promise<ConfigDraftSnapshot> {
    if (!CONFIG_TARGET_TABLES.has(input.targetTable)) {
      throw new ConfigReleaseError('CONFIG_TARGET_INVALID');
    }
    if (
      typeof input.targetKey !== 'string' ||
      input.targetKey.length === 0 ||
      input.targetKey.length > 128
    ) {
      throw new ConfigReleaseError('CONFIG_PAYLOAD_INVALID');
    }
    const draftKey = `draft.${input.targetTable}.${input.targetKey}`;
    const occurredAt = new Date().toISOString();
    const version = await this.#configStore.activate(draftKey, {
      draftStatus: 'PENDING_REVIEW',
      makerAdminId,
      targetTable: input.targetTable,
      targetKey: input.targetKey,
      payload: input.payload,
      createdAt: occurredAt
    });
    return Object.freeze({
      draftId: `${draftKey}~${version}`,
      targetTable: input.targetTable,
      targetKey: input.targetKey,
      makerAdminId,
      draftStatus: 'PENDING_REVIEW',
      createdAt: occurredAt,
      payload: input.payload
    });
  }

  public async listDrafts(): Promise<readonly ConfigDraftSnapshot[]> {
    const rows = await this.#unitOfWork.execute((context) =>
      context.executeSql<{
        config_key: string;
        version: number;
        payload: {
          draftStatus: string;
          makerAdminId: string;
          targetTable: string;
          targetKey: string;
          payload: Record<string, unknown>;
          createdAt: string;
        };
        activated_at: Date;
      }>(
        `SELECT DISTINCT ON (config_key) config_key, version, payload,
                activated_at
           FROM config_versions
          WHERE config_key LIKE 'draft.%'
          ORDER BY config_key, version DESC`
      )
    );
    return rows.rows
      .filter((row) => row.payload?.draftStatus === 'PENDING_REVIEW')
      .map((row) =>
        Object.freeze({
          draftId: `${row.config_key}~${row.version}`,
          targetTable: row.payload.targetTable as ConfigTargetTable,
          targetKey: row.payload.targetKey,
          makerAdminId: row.payload.makerAdminId,
          draftStatus: row.payload.draftStatus,
          createdAt: row.payload.createdAt ?? row.activated_at.toISOString(),
          payload: row.payload.payload ?? {}
        })
      );
  }

  public async settle(
    checkerAdminId: string,
    draftId: string,
    decision: 'publish' | 'reject'
  ): Promise<PublishOutcome> {
    const match =
      /^(draft\.[a-z_]+\.[A-Za-z0-9:_.-]+)~([0-9]+)$/u.exec(draftId);
    if (match === null) {
      throw new ConfigReleaseError('CONFIG_DRAFT_NOT_FOUND');
    }
    const draftKey = match[1]!;
    const draftVersion = Number(match[2]);
    const rows = await this.#unitOfWork.execute((context) =>
      context.executeSql<{
        payload: {
          draftStatus: string;
          makerAdminId: string;
          targetTable: ConfigTargetTable;
          targetKey: string;
          payload: Record<string, unknown>;
        };
      }>(
        `SELECT payload FROM config_versions
          WHERE config_key = $1
          ORDER BY version DESC LIMIT 1`,
        [draftKey]
      )
    );
    const draft = rows.rows[0]?.payload;
    // the latest state of the draft key decides settleability — a
    // published or rejected draft keeps its original row but its
    // newest version marks it settled
    if (draft === undefined || draft.draftStatus !== 'PENDING_REVIEW') {
      throw new ConfigReleaseError('CONFIG_DRAFT_NOT_FOUND');
    }
    if (draft.makerAdminId === checkerAdminId) {
      throw new ConfigReleaseError('CONFIG_SELF_REVIEW_REJECTED');
    }
    if (decision === 'reject') {
      await this.#configStore.activate(draftKey, {
        ...draft,
        draftStatus: 'REJECTED',
        checkerAdminId
      });
      return { outcome: 'REJECTED' };
    }
    const newVersion = await this.#writeTarget(draft);
    await this.#configStore.activate(draftKey, {
      ...draft,
      draftStatus: 'PUBLISHED',
      checkerAdminId,
      publishedVersion: newVersion
    });
    return { outcome: 'PUBLISHED', newVersion };
  }

  async #writeTarget(draft: {
    targetTable: ConfigTargetTable;
    targetKey: string;
    payload: Record<string, unknown>;
  }): Promise<number> {
    const p = draft.payload;
    const str = (key: string): string => {
      const value = p[key];
      if (typeof value !== 'string') {
        throw new ConfigReleaseError('CONFIG_PAYLOAD_INVALID');
      }
      return value;
    };
    const num = (key: string): number => {
      const value = p[key];
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new ConfigReleaseError('CONFIG_PAYLOAD_INVALID');
      }
      return value;
    };
    switch (draft.targetTable) {
      case 'market_configs':
        return this.#unitOfWork.execute((context) =>
          this.#markets.insert(context, {
            marketKey: str('marketKey'),
            configVersion: num('configVersion'),
            sellAssetCode: str('sellAssetCode'),
            buyAssetCode: str('buyAssetCode'),
            quoteScale: num('quoteScale'),
            spreadBp: num('spreadBp'),
            minSellAmount: str('minSellAmount'),
            maxSellAmount: str('maxSellAmount'),
            quoteTtlSeconds: num('quoteTtlSeconds'),
            deviationToleranceBp: num('deviationToleranceBp')
          }).then((snapshot) => snapshot.configVersion)
        );
      case 'provider_configs':
        return this.#unitOfWork.execute((context) =>
          this.#providers.insert(context, {
            providerId: str('providerId'),
            configVersion: num('configVersion'),
            providerName: str('providerName'),
            route: str('route'),
            sourceAssetCode: str('sourceAssetCode'),
            fixedFee: str('fixedFee'),
            minAmount: str('minAmount'),
            maxAmount: str('maxAmount'),
            callbackSecretRef: str('callbackSecretRef')
          }).then((snapshot) => snapshot.configVersion)
        );
      case 'signer_policies':
        return this.#unitOfWork.execute((context) =>
          this.#policies.insert(context, {
            policyVersion: num('policyVersion'),
            network: str('network'),
            hotWalletAddress: str('hotWalletAddress'),
            feeAmount: str('feeAmount'),
            minAutoAmount: str('minAutoAmount'),
            maxAmount: str('maxAmount')
          }).then((snapshot) => snapshot.policyVersion)
        );
      case 'config_versions':
        return this.#configStore.activate(
          draft.targetKey,
          p as Record<string, unknown>
        );
    }
  }
}
