import type {
  ChainNetwork
} from '@xht/contracts';
import type {
  ChainScannerPort,
  OnChainTransaction
} from './chain-scanner.port.js';

interface QueuedTransaction extends OnChainTransaction {
  readonly network: ChainNetwork;
}

/**
 * Deterministic fake chain scanner for tests: transactions are explicitly
 * injected and returned per (network, address) with block-range filtering.
 */
export class FakeChainScanner implements ChainScannerPort {
  readonly #transactions: QueuedTransaction[] = [];
  readonly #latestBlocks = new Map<ChainNetwork, string>();
  readonly #addressBalances = new Map<string, string>();

  public inject(
    network: ChainNetwork,
    transaction: Omit<OnChainTransaction, 'confirmations'> & {
      confirmations?: number;
    }
  ): void {
    this.#transactions.push({
      ...transaction,
      confirmations: transaction.confirmations ?? 1,
      network
    });
  }

  public setLatestBlock(network: ChainNetwork, blockNumber: string): void {
    this.#latestBlocks.set(network, blockNumber);
  }

  public setAddressBalance(
    network: ChainNetwork,
    addressText: string,
    balance: string
  ): void {
    this.#addressBalances.set(`${network}:${addressText}`, balance);
  }

  public async getAddressBalance(
    network: ChainNetwork,
    addressText: string
  ): Promise<string> {
    return this.#addressBalances.get(`${network}:${addressText}`) ?? '0';
  }

  public async getLatestBlockNumber(
    network: ChainNetwork
  ): Promise<string> {
    return this.#latestBlocks.get(network) ?? '0';
  }

  public async getTransactionsForAddress(
    network: ChainNetwork,
    addressText: string,
    fromBlock: string,
    toBlock: string
  ): Promise<readonly OnChainTransaction[]> {
    const from = BigInt(fromBlock);
    const to = BigInt(toBlock);
    return this.#transactions.filter(
      (tx) =>
        tx.network === network &&
        tx.toAddress === addressText &&
        BigInt(tx.blockNumber) >= from &&
        BigInt(tx.blockNumber) <= to
    );
  }

  public updateConfirmations(
    network: ChainNetwork,
    networkTxid: string,
    confirmations: number
  ): void {
    for (const tx of this.#transactions) {
      if (tx.network === network && tx.networkTxid === networkTxid) {
        (tx as { confirmations: number }).confirmations = confirmations;
      }
    }
  }
}

Object.freeze(FakeChainScanner.prototype);
