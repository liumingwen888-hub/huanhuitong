import type { ChainNetwork } from '@xht/contracts';

export interface BroadcastInput {
  readonly network: ChainNetwork;
  readonly fromAddress: string;
  readonly toAddress: string;
  readonly amount: string;
  readonly feeRate: string;
}

export interface BroadcastResult {
  readonly broadcastTxid: string;
  readonly actualFee: string;
}

export type BroadcastStatus = 'PENDING' | 'CONFIRMED' | 'FAILED';

export interface TransactionBroadcasterPort {
  broadcast(input: BroadcastInput): Promise<BroadcastResult>;
  getStatus(
    network: ChainNetwork,
    txid: string
  ): Promise<BroadcastStatus>;
}
