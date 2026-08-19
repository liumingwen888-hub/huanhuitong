import type { ChainNetwork } from '@xht/contracts';

export interface OnChainTransaction {
  readonly networkTxid: string;
  readonly toAddress: string;
  readonly amount: string;
  readonly blockNumber: string;
  readonly blockTimestamp: Date;
  readonly confirmations: number;
}

export interface ChainScannerPort {
  getLatestBlockNumber(network: ChainNetwork): Promise<string>;
  getTransactionsForAddress(
    network: ChainNetwork,
    addressText: string,
    fromBlock: string,
    toBlock: string
  ): Promise<readonly OnChainTransaction[]>;
  getAddressBalance(
    network: ChainNetwork,
    addressText: string
  ): Promise<string>;
}

export type ChainScanResult = {
  readonly network: ChainNetwork;
  readonly fromBlock: string;
  readonly toBlock: string;
  readonly addressesScanned: number;
  readonly detectionsUpserted: number;
  readonly checkpointAdvanced: boolean;
};
