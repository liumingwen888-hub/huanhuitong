import { randomUUID } from 'node:crypto';
import type {
  PayoutContractErrorCode,
  PayoutOrderSnapshot,
  MetricsPort,
} from '@xht/contracts';
import { NOOP_METRICS } from '../../../infrastructure/telemetry/compose-metrics.js';
import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';
import type {
  PayoutProviderPort,
  ProviderSubmitInput
} from '../domain/payout-provider.port.js';
import type { OutboxRepository } from '../../reliability/outbox/outbox.repository.js';
import type { PayoutOrderRepository } from './payout.repository.js';

export type PayoutSubmitResult =
  | { readonly outcome: 'ACCEPTED'; readonly order: PayoutOrderSnapshot }
  | { readonly outcome: 'FAILED'; readonly order: PayoutOrderSnapshot }
  | { readonly outcome: 'UNKNOWN' }
  | {
      readonly outcome: 'DENIED';
      readonly reasonCode: PayoutContractErrorCode;
    };

/**
 * Submits frozen payout orders to the provider port. FUNDS_RESERVED
 * orders are CAS-moved to SUBMITTING (idempotent re-entry after a
 * crash); the submission replays the order's provider idempotency
 * key, which the provider deduplicates — the third layer of the
 * structural double-pay defense. A throwing submit is an UNKNOWN
 * outcome: zero state writes, order stays retryable in SUBMITTING.
 */
export class PayoutSubmissionService {
  readonly #unitOfWork: UnitOfWork;
  readonly #orders: PayoutOrderRepository;
  readonly #provider: PayoutProviderPort;
  readonly #outbox: OutboxRepository;

  readonly #metrics: MetricsPort;

  constructor(
    unitOfWork: UnitOfWork,
    orders: PayoutOrderRepository,
    provider: PayoutProviderPort,
    outbox: OutboxRepository,
    metrics: MetricsPort = NOOP_METRICS
  ) {
    this.#unitOfWork = unitOfWork;
    this.#orders = orders;
    this.#provider = provider;
    this.#outbox = outbox;
    this.#metrics = metrics;
  }

  public async submit(payoutOrderId: string): Promise<PayoutSubmitResult> {
    const order = await this.#load(payoutOrderId);
    if (order === null) {
      return {
        outcome: 'DENIED',
        reasonCode: 'PAYOUT_ORDER_NOT_FOUND'
      };
    }
    if (order.status === 'FUNDS_RESERVED') {
      const moved = await this.#unitOfWork.execute((context) =>
        this.#orders.markSubmitting(context, payoutOrderId)
      );
      if (!moved) {
        const current = await this.#reload(payoutOrderId, order);
        if (
          current.status === 'SUBMITTING' ||
          current.status === 'ACCEPTED'
        ) {
          return this.submit(payoutOrderId);
        }
        return { outcome: 'DENIED', reasonCode: 'PAYOUT_INVALID_TRANSITION' };
      }
    } else if (order.status !== 'SUBMITTING') {
      return { outcome: 'DENIED', reasonCode: 'PAYOUT_INVALID_TRANSITION' };
    }
    const input: ProviderSubmitInput = {
      providerIdempotencyKey: order.providerIdempotencyKey,
      route: order.route,
      sourceAssetCode: order.sourceAssetCode,
      amount: order.amount,
      estimatedFiat:
        (BigInt(order.amount) - BigInt(order.feeAmount)).toString(),
      beneficiaryRef: order.beneficiaryRef,
      beneficiaryDigest: order.beneficiaryDigest
    };
    let providerResult;
    try {
      providerResult = await this.#provider.submit(input);
    } catch {
      // UNKNOWN outcome: no inference, no state write — retry replays
      // the same key which the provider deduplicates
      return { outcome: 'UNKNOWN' };
    }
    if (providerResult.status === 'REJECTED') {
      const failed = await this.#unitOfWork.execute((context) =>
        this.#orders.markFailed(context, {
          payoutOrderId,
          reason: `PROVIDER_REJECTED:${providerResult.reasonCode}`
        })
      );
      const current = await this.#reload(payoutOrderId, order);
      if (!failed) {
        if (current.status === 'FAILED') {
          return { outcome: 'FAILED', order: current };
        }
        return {
          outcome: 'DENIED',
          reasonCode: 'PAYOUT_INVALID_TRANSITION'
        };
      }
      await this.#notify(current, 'telegram.payout-failed.v1');
      return { outcome: 'FAILED', order: current };
    }
    const accepted = await this.#unitOfWork.execute((context) =>
      this.#orders.markAccepted(context, payoutOrderId)
    );
    const current = await this.#reload(payoutOrderId, order);
    if (!accepted) {
      // idempotent replay already notified on its own first transition
      if (current.status === 'ACCEPTED') {
        return { outcome: 'ACCEPTED', order: current };
      }
      return { outcome: 'DENIED', reasonCode: 'PAYOUT_INVALID_TRANSITION' };
    }
    this.#metrics.incrementCounter('payout_submitted_total', {
      domain: 'payout', outcome: 'accepted'
    });
    await this.#notify(current, 'telegram.payout-submitted.v1');
    return { outcome: 'ACCEPTED', order: current };
  }

  async #load(payoutOrderId: string): Promise<PayoutOrderSnapshot | null> {
    return this.#unitOfWork.execute((context) =>
      this.#orders.findById(context, payoutOrderId)
    );
  }

  async #reload(
    payoutOrderId: string,
    fallback: PayoutOrderSnapshot
  ): Promise<PayoutOrderSnapshot> {
    return (await this.#load(payoutOrderId)) ?? fallback;
  }

  async #notify(
    order: PayoutOrderSnapshot,
    topic: string
  ): Promise<void> {
    const eventId = randomUUID();
    await this.#unitOfWork.execute((context) =>
      this.#outbox.enqueue(context, {
        id: eventId,
        topic,
        eventKey: `${topic}:${order.orderRef}`,
        occurredAt: new Date().toISOString(),
        correlationId: randomUUID(),
        payload: {
          type: topic,
          uid: order.uid,
          orderRef: order.orderRef,
          route: order.route,
          amount: order.amount,
          status: order.status
        }
      })
    );
  }
}
