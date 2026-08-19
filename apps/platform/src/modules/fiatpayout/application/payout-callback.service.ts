import { randomUUID } from 'node:crypto';
import type {
  CallbackIngestResult,
  PayoutOrderSnapshot,
  ProviderCallbackInput,
  ProviderReportedStatus
} from '@xht/contracts';
import {
  UnitOfWorkError,
  type UnitOfWork
} from '../../../infrastructure/database/unit-of-work.js';
import type {
  CallbackSignaturePort
} from '../domain/callback-signature.port.js';
import type { OutboxRepository } from '../../reliability/outbox/outbox.repository.js';
import type { CallbackInboxRepository } from './callback-inbox.repository.js';
import type {
  PayoutOrderRepository,
  ProviderConfigRepository
} from './payout.repository.js';

interface ParsedCallback {
  readonly providerEventId: string;
  readonly providerIdempotencyKey: string;
  readonly reportedStatus: ProviderReportedStatus;
}

/**
 * Verifies and records provider callbacks: HMAC verification is the
 * single trust gate (failures reject permanently with zero writes),
 * events are deduplicated by (provider, eventId) in the callback
 * inbox, and a SUCCEEDED report never becomes a terminal order state
 * by itself — it queues the internal settlement pipeline instead.
 */
export class PayoutCallbackService {
  readonly #unitOfWork: UnitOfWork;
  readonly #configs: ProviderConfigRepository;
  readonly #orders: PayoutOrderRepository;
  readonly #inbox: CallbackInboxRepository;
  readonly #signatures: CallbackSignaturePort;
  readonly #outbox: OutboxRepository;

  constructor(
    unitOfWork: UnitOfWork,
    configs: ProviderConfigRepository,
    orders: PayoutOrderRepository,
    inbox: CallbackInboxRepository,
    signatures: CallbackSignaturePort,
    outbox: OutboxRepository
  ) {
    this.#unitOfWork = unitOfWork;
    this.#configs = configs;
    this.#orders = orders;
    this.#inbox = inbox;
    this.#signatures = signatures;
    this.#outbox = outbox;
  }

  public async ingest(
    input: ProviderCallbackInput
  ): Promise<CallbackIngestResult> {
    const config = await this.#unitOfWork.execute((context) =>
      this.#configs.findLatestByProvider(context, input.providerId)
    );
    if (config === null) {
      return {
        outcome: 'REJECTED',
        reasonCode: 'PAYOUT_PROVIDER_CONFIG_NOT_FOUND'
      };
    }
    const verified = await this.#signatures.verify({
      providerId: input.providerId,
      secretRef: config.callbackSecretRef,
      payload: input.rawPayload,
      signature: input.signature
    });
    if (!verified) {
      return {
        outcome: 'REJECTED',
        reasonCode: 'PAYOUT_CALLBACK_VERIFICATION_FAILED'
      };
    }
    let parsed: ParsedCallback;
    try {
      parsed = parseCallback(input.rawPayload);
    } catch {
      return { outcome: 'REJECTED', reasonCode: 'PAYOUT_COMMAND_INVALID' };
    }
    const seen = await this.#unitOfWork.execute((context) =>
      this.#inbox.hasEvent(context, {
        providerId: input.providerId,
        providerEventId: parsed.providerEventId
      })
    );
    if (seen) {
      return { outcome: 'REJECTED', reasonCode: 'PAYOUT_CALLBACK_REPLAY' };
    }
    try {
      await this.#unitOfWork.execute((context) =>
        this.#inbox.insert(context, {
          providerId: input.providerId,
          providerEventId: parsed.providerEventId,
          providerIdempotencyKey: parsed.providerIdempotencyKey,
          reportedStatus: parsed.reportedStatus
        })
      );
    } catch (error: unknown) {
      if (
        error instanceof UnitOfWorkError &&
        error.code === 'TRANSACTION_CALLBACK_FAILED'
      ) {
        return { outcome: 'REJECTED', reasonCode: 'PAYOUT_CALLBACK_REPLAY' };
      }
      throw error;
    }
    const order = await this.#unitOfWork.execute((context) =>
      this.#orders.findByProviderKey(
        context,
        parsed.providerIdempotencyKey
      )
    );
    if (order === null) {
      return {
        outcome: 'REJECTED',
        reasonCode: 'PAYOUT_ORDER_NOT_FOUND'
      };
    }
    if (parsed.reportedStatus === 'FAILED') {
      await this.#unitOfWork.execute((context) =>
        this.#orders.markFailed(context, {
          payoutOrderId: order.payoutOrderId,
          reason: 'PROVIDER_CALLBACK:FAILED'
        })
      );
    } else {
      await this.#enqueueReported(order, parsed.reportedStatus);
    }
    return {
      outcome: 'RECORDED',
      reportedStatus: parsed.reportedStatus,
      orderRef: order.orderRef
    };
  }

  async #enqueueReported(
    order: PayoutOrderSnapshot,
    status: ProviderReportedStatus
  ): Promise<void> {
    const topic =
      status === 'SUCCEEDED'
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
          reportedStatus: status
        }
      })
    );
  }
}

function parseCallback(raw: string): ParsedCallback {
  const parsed = JSON.parse(raw) as {
    providerEventId?: unknown;
    providerIdempotencyKey?: unknown;
    reportedStatus?: unknown;
  };
  if (
    typeof parsed.providerEventId !== 'string' ||
    !/^[A-Za-z0-9-]{4,128}$/u.test(parsed.providerEventId) ||
    typeof parsed.providerIdempotencyKey !== 'string' ||
    parsed.providerIdempotencyKey.length === 0 ||
    (parsed.reportedStatus !== 'SUCCEEDED' &&
      parsed.reportedStatus !== 'FAILED' &&
      parsed.reportedStatus !== 'REVERSED')
  ) {
    throw new Error('CALLBACK_PAYLOAD_INVALID');
  }
  return {
    providerEventId: parsed.providerEventId,
    providerIdempotencyKey: parsed.providerIdempotencyKey,
    reportedStatus: parsed.reportedStatus
  };
}
