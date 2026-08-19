import { randomUUID } from 'node:crypto';
import type {
  PayoutOrderSnapshot,
  PayoutQueryResult
} from '@xht/contracts';
import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';
import type { PayoutProviderPort } from '../domain/payout-provider.port.js';
import type { OutboxRepository } from '../../reliability/outbox/outbox.repository.js';
import type { PayoutOrderRepository } from './payout.repository.js';

/**
 * Query-first resolution for uncertain payouts: when a callback is
 * missing or the outcome is unclear, the provider is queried
 * authoritatively. An UNKNOWN answer writes nothing — never infer
 * failure, never re-pay; a SUCCEEDED answer only queues settlement.
 */
export class PayoutQueryService {
  readonly #unitOfWork: UnitOfWork;
  readonly #orders: PayoutOrderRepository;
  readonly #provider: PayoutProviderPort;
  readonly #outbox: OutboxRepository;

  constructor(
    unitOfWork: UnitOfWork,
    orders: PayoutOrderRepository,
    provider: PayoutProviderPort,
    outbox: OutboxRepository
  ) {
    this.#unitOfWork = unitOfWork;
    this.#orders = orders;
    this.#provider = provider;
    this.#outbox = outbox;
  }

  public async queryFirst(payoutOrderId: string): Promise<PayoutQueryResult> {
    const order = await this.#unitOfWork.execute((context) =>
      this.#orders.findById(context, payoutOrderId)
    );
    if (order === null) {
      return {
        outcome: 'DENIED',
        reasonCode: 'PAYOUT_ORDER_NOT_FOUND'
      };
    }
    if (
      order.status !== 'SUBMITTING' &&
      order.status !== 'ACCEPTED' &&
      order.status !== 'UNKNOWN'
    ) {
      return {
        outcome: 'DENIED',
        reasonCode: 'PAYOUT_INVALID_TRANSITION'
      };
    }
    const result = await this.#provider.query(order.providerIdempotencyKey);
    if (result.status === 'UNKNOWN') {
      return {
        outcome: 'UNKNOWN',
        reasonCode: 'PAYOUT_UNKNOWN_PENDING_QUERY'
      };
    }
    if (result.status === 'FAILED') {
      await this.#unitOfWork.execute((context) =>
        this.#orders.markFailed(context, {
          payoutOrderId,
          reason: 'PROVIDER_QUERY:FAILED'
        })
      );
      return { outcome: 'FAILED_REPORTED', orderRef: order.orderRef };
    }
    const topic =
      result.status === 'SUCCEEDED'
        ? 'payout.settlement-pending.v1'
        : 'payout.reversal-pending.v1';
    const eventId = randomUUID();
    await this.#unitOfWork.execute((context) =>
      this.#outbox.enqueue(context, {
        id: eventId,
        topic,
        eventKey: `${topic}:${order.orderRef}:${eventId.slice(0, 8)}`,
        occurredAt: new Date().toISOString(),
        correlationId: randomUUID(),
        payload: {
          type: topic,
          uid: order.uid,
          orderRef: order.orderRef,
          providerIdempotencyKey: order.providerIdempotencyKey,
          reportedStatus: result.status
        }
      })
    );
    return result.status === 'SUCCEEDED'
      ? { outcome: 'SUCCEEDED_REPORTED', orderRef: order.orderRef }
      : { outcome: 'REVERSED_REPORTED', orderRef: order.orderRef };
  }
}
