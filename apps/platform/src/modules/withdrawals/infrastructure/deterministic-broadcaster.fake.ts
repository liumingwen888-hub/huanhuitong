import { createHash } from 'node:crypto';
import type {
  BroadcastInput,
  BroadcastResult,
  BroadcastStatus,
  TransactionBroadcasterPort
} from '../../deposits/domain/transaction-broadcaster.port.js';

/**
 * Deterministic broadcaster fake for withdrawal tests: the txid is
 * derived from the broadcast input content, so re-submitting the same
 * signed withdrawal replays the same on-chain transaction — the chain
 * idempotency layer of the S6-5 double-pay safety argument.
 */
export class DeterministicBroadcasterFake
  implements TransactionBroadcasterPort
{
  readonly broadcasts: BroadcastInput[] = [];
  readonly #statuses = new Map<string, BroadcastStatus>();
  #shouldThrow = false;
  #defaultStatus: BroadcastStatus = 'PENDING';

  public setShouldThrow(shouldThrow: boolean): void {
    this.#shouldThrow = shouldThrow;
  }

  public setDefaultStatus(status: BroadcastStatus): void {
    this.#defaultStatus = status;
  }

  public setStatus(txid: string, status: BroadcastStatus): void {
    this.#statuses.set(txid, status);
  }

  public async broadcast(input: BroadcastInput): Promise<BroadcastResult> {
    this.broadcasts.push(input);
    if (this.#shouldThrow) {
      throw new Error('BROADCAST_OUTCOME_UNKNOWN');
    }
    const txid = deterministicBroadcastTxid(input);
    if (!this.#statuses.has(txid)) {
      this.#statuses.set(txid, this.#defaultStatus);
    }
    return { broadcastTxid: txid, actualFee: input.feeRate };
  }

  public async getStatus(
    _network: Parameters<TransactionBroadcasterPort['getStatus']>[0],
    txid: string
  ): Promise<BroadcastStatus> {
    return this.#statuses.get(txid) ?? 'PENDING';
  }
}

export function deterministicBroadcastTxid(input: BroadcastInput): string {
  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        network: input.network,
        fromAddress: input.fromAddress,
        toAddress: input.toAddress,
        amount: input.amount,
        feeRate: input.feeRate
      })
    )
    .digest('base64url');
  return `wd-${digest.slice(0, 40)}`;
}

Object.freeze(DeterministicBroadcasterFake.prototype);
