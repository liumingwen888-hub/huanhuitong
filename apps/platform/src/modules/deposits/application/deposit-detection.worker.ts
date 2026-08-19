import type {
  ChainNetwork,
  DepositAddressSnapshot
} from '@xht/contracts';
import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';
import type {
  ChainScannerPort,
  ChainScanResult
} from '../domain/chain-scanner.port.js';
import type {
  DepositAddressRepository,
  DepositDetectionRepository
} from './deposit.repository.js';

export class DepositDetectionWorker {
  readonly #unitOfWork: UnitOfWork;
  readonly #addresses: DepositAddressRepository;
  readonly #detections: DepositDetectionRepository;
  readonly #scanner: ChainScannerPort;

  constructor(
    unitOfWork: UnitOfWork,
    addresses: DepositAddressRepository,
    detections: DepositDetectionRepository,
    scanner: ChainScannerPort
  ) {
    this.#unitOfWork = unitOfWork;
    this.#addresses = addresses;
    this.#detections = detections;
    this.#scanner = scanner;
  }

  public async runOnce(network: ChainNetwork): Promise<ChainScanResult> {
    const latestBlock = await this.#scanner.getLatestBlockNumber(network);
    if (latestBlock === '0') {
      return {
        network, fromBlock: '0', toBlock: '0',
        addressesScanned: 0, detectionsUpserted: 0, checkpointAdvanced: false
      };
    }
    const activeAddresses = await this.#getActiveAddresses(network);
    if (activeAddresses.length === 0) {
      return {
        network, fromBlock: '0', toBlock: latestBlock,
        addressesScanned: 0, detectionsUpserted: 0, checkpointAdvanced: false
      };
    }
    const fromBlock = await this.#readCheckpoint(network);
    let upserted = 0;
    for (const address of activeAddresses) {
      const transactions = await this.#scanner.getTransactionsForAddress(
        network, address.addressText, fromBlock, latestBlock
      );
      process.stdout.write(`SCAN addr=${address.addressText.slice(0, 20)} from=${fromBlock} to=${latestBlock} found=${transactions.length}\n`);
      for (const tx of transactions) {
        if (typeof tx.amount !== 'string' || !/^[0-9]+$/.test(tx.amount)) {
          continue;
        }
        process.stdout.write(`UPSERT-START txid=${tx.networkTxid}\n`);
        await this.#unitOfWork.execute((context) =>
          this.#detections.upsertDetection(context, {
            addressId: address.addressId,
            network,
            networkTxid: tx.networkTxid,
            networkTimestamp: tx.blockTimestamp,
            amount: tx.amount,
            confirmations: tx.confirmations
          })
        );
        process.stdout.write(`UPSERT-OK txid=${tx.networkTxid}\n`);
        upserted += 1;
      }
    }
    process.stdout.write(`PRE-CHKPT from=${fromBlock} to=${latestBlock}\n`);
    const advanced = await this.#advanceCheckpoint(
      network, fromBlock, latestBlock
    );
    process.stdout.write(`POST-CHKPT advanced=${advanced}\n`);
    return {
      network, fromBlock, toBlock: latestBlock,
      addressesScanned: activeAddresses.length,
      detectionsUpserted: upserted, checkpointAdvanced: advanced
    };
  }

  async #getActiveAddresses(
    network: ChainNetwork
  ): Promise<
    readonly Pick<
      DepositAddressSnapshot,
      'addressId' | 'addressText' | 'uid' | 'assetCode'
    >[]
  > {
    return this.#unitOfWork.execute(async (context) => {
      const rows = await context.executeSql<{
        address_id: string;
        address_text: string;
        uid: string;
        asset_code: string;
      }>(
        `SELECT address_id, address_text, uid, asset_code
           FROM deposit_addresses
          WHERE network = $1 AND status = 'ACTIVE'`,
        [network]
      );
      return rows.rows.map((row) => ({
        addressId: row.address_id,
        addressText: row.address_text,
        uid: row.uid as DepositAddressSnapshot['uid'],
        assetCode: row.asset_code
      }));
    });
  }

  async #readCheckpoint(network: ChainNetwork): Promise<string> {
    return this.#unitOfWork.execute(async (context) => {
      const rows = await context.executeSql<{
        last_scanned_block: string;
      }>(
        `SELECT last_scanned_block::text AS last_scanned_block
           FROM chain_scan_checkpoints WHERE network = $1`,
        [network]
      );
      return rows.rows[0]?.last_scanned_block ?? '0';
    });
  }

  async #advanceCheckpoint(
    network: ChainNetwork,
    fromBlock: string,
    toBlock: string
  ): Promise<boolean> {
    if (BigInt(toBlock) <= BigInt(fromBlock)) return false;
    return this.#unitOfWork.execute(async (context) => {
      await context.executeSql(
        `INSERT INTO chain_scan_checkpoints (network, last_scanned_block)
         VALUES ($1, $2::bigint)
         ON CONFLICT (network) DO NOTHING`,
        [network, toBlock]
      );
      await context.executeSql(
        `UPDATE chain_scan_checkpoints
            SET last_scanned_block = $2::bigint,
                updated_at = clock_timestamp()
          WHERE network = $1 AND last_scanned_block < $2::bigint`,
        [network, toBlock]
      );
      return true;
    });
  }
}
