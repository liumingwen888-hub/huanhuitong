import type {
  PayoutCapabilitySnapshot,
  PayoutContractErrorCode,
  PayoutQuoteSnapshot
} from '@xht/contracts';
import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';
import type { ProviderConfigRepository } from './payout.repository.js';

export interface QuotePayoutInput {
  readonly route: string;
  readonly sourceAmount: string;
}

export type QuotePayoutResult =
  | { readonly outcome: 'QUOTED'; readonly quote: PayoutQuoteSnapshot }
  | {
      readonly outcome: 'REJECTED';
      readonly reasonCode: PayoutContractErrorCode;
    };

/**
 * Read-only payout capability layer: capabilities are pure provider
 * config facts with zero derivation, and quotes are fee estimates
 * explicitly flagged as such — the 1:1 source-to-fiat conversion is a
 * documented FakeProvider synthetic semantic, never a schema promise.
 * Real provider rates arrive with production integrations.
 */
export class PayoutCapabilityService {
  readonly #unitOfWork: UnitOfWork;
  readonly #configs: ProviderConfigRepository;

  constructor(unitOfWork: UnitOfWork, configs: ProviderConfigRepository) {
    this.#unitOfWork = unitOfWork;
    this.#configs = configs;
  }

  public async getCapabilities(): Promise<
    readonly PayoutCapabilitySnapshot[]
  > {
    return this.#unitOfWork.execute((context) =>
      this.#configs.listCapabilities(context)
    );
  }

  public async quotePayout(
    input: QuotePayoutInput
  ): Promise<QuotePayoutResult> {
    if (!/^[A-Z]{2}:[A-Z]{3}$/u.test(input.route)) {
      return {
        outcome: 'REJECTED',
        reasonCode: 'PAYOUT_COMMAND_INVALID'
      };
    }
    if (
      !/^[0-9]{1,18}$/u.test(input.sourceAmount) ||
      input.sourceAmount === '0'
    ) {
      return {
        outcome: 'REJECTED',
        reasonCode: 'PAYOUT_COMMAND_INVALID'
      };
    }
    const config = await this.#unitOfWork.execute((context) =>
      this.#configs.findLatestByRoute(context, input.route)
    );
    if (config === null) {
      return {
        outcome: 'REJECTED',
        reasonCode: 'PAYOUT_PROVIDER_CONFIG_NOT_FOUND'
      };
    }
    const amount = BigInt(input.sourceAmount);
    if (
      amount < BigInt(config.minAmount) ||
      amount > BigInt(config.maxAmount)
    ) {
      return {
        outcome: 'REJECTED',
        reasonCode: 'PAYOUT_AMOUNT_OUT_OF_RANGE'
      };
    }
    const fee = BigInt(config.fixedFee);
    const estimatedFiat = amount - fee;
    if (estimatedFiat <= 0n) {
      return {
        outcome: 'REJECTED',
        reasonCode: 'PAYOUT_AMOUNT_OUT_OF_RANGE'
      };
    }
    return {
      outcome: 'QUOTED',
      quote: Object.freeze({
        providerId: config.providerId,
        configVersion: config.configVersion,
        route: config.route,
        sourceAssetCode: config.sourceAssetCode,
        sourceAmount: input.sourceAmount,
        fee: config.fixedFee,
        estimatedFiat: estimatedFiat.toString(),
        estimate: true
      })
    };
  }
}
