import { randomUUID } from 'node:crypto';
import type { ChainNetwork } from '@xht/contracts';
import type {
  BroadcastInput,
  BroadcastResult,
  BroadcastStatus,
  TransactionBroadcasterPort
} from './transaction-broadcaster.port.js';

/**
 * Deterministic fake broadcaster for tests: returns a synthetic txid
 * and configurable fee. Status defaults to CONFIRMED unless overridden.
 */
export class FakeBroadcaster implements TransactionBroadcasterPort {
  readonly #statuses = new Map<string, BroadcastStatus>();
  #feeRate = '1000';
  #shouldFail = false;
  readonly broadcasts: BroadcastInput[] = [];

  public setFeeRate(rate: string): void {
    this.#feeRate = rate;
  }

  public setShouldFail(fail: boolean): void {
    this.#shouldFail = fail;
  }

  public setStatus(txid: string, status: BroadcastStatus): void {
    this.#statuses.set(txid, status);
  }

  public async broadcast(input: BroadcastInput): Promise<BroadcastResult> {
    this.broadcasts.push(input);
    if (this.#shouldFail) {
      throw new Error('BROADCAST_FAILED');
    }
    const txid = `sweep-${randomUUID()}`;
    this.#statuses.set(txid, 'CONFIRMED');
    return {
      broadcastTxid: txid,
      actualFee: this.#feeRate
    };
  }

  public async getStatus(
    _network: ChainNetwork,
    txid: string
  ): Promise<BroadcastStatus> {
    return this.#statuses.get(txid) ?? 'PENDING';
  }
}

Object.freeze(FakeBroadcaster.prototype);
