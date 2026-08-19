import { randomUUID } from 'node:crypto';
import type {
  AddressDerivationSource,
  ChainNetwork,
  ConfirmationPolicySnapshot,
  DepositAddressSnapshot,
  DepositDetectionStatus,
  Uid
} from '@xht/contracts';
import type { TransactionContext } from '../../../infrastructure/database/transaction-context.js';
import { DepositError } from '../domain/deposit.errors.js';
import type {
  ConfirmationPolicyRepository,
  DepositAddressRepository,
  DepositDetectionRepository
} from '../application/deposit.repository.js';

interface AddressRow {
  address_id: string;
  uid: string;
  asset_code: string;
  network: string;
  address_text: string;
  derivation_path: string;
  derivation_index: number;
  status: string;
}

function toSnapshot(row: AddressRow): DepositAddressSnapshot {
  return Object.freeze({
    addressId: row.address_id,
    uid: row.uid as Uid,
    assetCode: row.asset_code,
    network: row.network as ChainNetwork,
    addressText: row.address_text,
    derivationPath: row.derivation_path,
    derivationIndex: row.derivation_index,
    status: row.status as DepositAddressSnapshot['status']
  });
}

const NETWORKS: ReadonlySet<string> = new Set(['TRON', 'ETHEREUM', 'BITCOIN']);

export class PostgresDepositAddressRepository implements DepositAddressRepository {
  public async findAssignedAddress(
    context: TransactionContext,
    input: { readonly uid: Uid; readonly assetCode: string }
  ): Promise<DepositAddressSnapshot | null> {
    const result = await context.executeSql<AddressRow>(
      `SELECT address_id, uid, asset_code, network, address_text,
              derivation_path, derivation_index, status
         FROM deposit_addresses
        WHERE uid = $1::uuid AND asset_code = $2 AND status = 'ACTIVE'
        ORDER BY created_at DESC LIMIT 1`,
      [input.uid, input.assetCode]
    );
    const row = result.rows[0];
    return row === undefined ? null : toSnapshot(row);
  }

  public async createNextAddress(
    context: TransactionContext,
    input: {
      readonly uid: Uid;
      readonly assetCode: string;
      readonly network: ChainNetwork;
      readonly derivation: AddressDerivationSource;
    }
  ): Promise<DepositAddressSnapshot> {
    if (!NETWORKS.has(input.network)) {
      throw new DepositError('DEPOSIT_NETWORK_UNSUPPORTED');
    }
    const nextIndexResult = await context.executeSql<{ next: number }>(
      `SELECT COALESCE(max(derivation_index), -1) + 1 AS next
         FROM deposit_addresses WHERE asset_code = $1`,
      [input.assetCode]
    );
    const index = nextIndexResult.rows[0]?.next ?? 0;
    if (index > 2_000_000_000) {
      throw new DepositError('DEPOSIT_DERIVATION_FAILED');
    }
    const derived = await input.derivation.deriveAddress(
      input.network,
      index
    );
    if (
      typeof derived.addressText !== 'string' ||
      derived.addressText.length < 10 ||
      derived.addressText.length > 255
    ) {
      throw new DepositError('DEPOSIT_DERIVATION_FAILED');
    }
    const inserted = await context.executeSql<AddressRow>(
      `INSERT INTO deposit_addresses
         (uid, asset_code, network, address_text, derivation_path,
          derivation_index)
       VALUES ($1::uuid, $2, $3, $4, $5, $6)
       ON CONFLICT (asset_code, derivation_index) DO NOTHING
       RETURNING address_id, uid, asset_code, network, address_text,
                 derivation_path, derivation_index, status`,
      [
        input.uid,
        input.assetCode,
        input.network,
        derived.addressText,
        derived.derivationPath,
        index
      ]
    );
    if (inserted.rows.length === 1) {
      const row = inserted.rows[0]!;
      await context.executeSql(
        `INSERT INTO address_assignments (address_id, uid, idempotency_key)
         VALUES ($1::uuid, $2::uuid, $3)`,
        [row.address_id, input.uid, `assign:${randomUUID()}`]
      );
      return toSnapshot(row);
    }
    const raced = await context.executeSql<AddressRow>(
      `SELECT address_id, uid, asset_code, network, address_text,
              derivation_path, derivation_index, status
         FROM deposit_addresses
        WHERE asset_code = $1 AND derivation_index = $2`,
      [input.assetCode, index]
    );
    if (raced.rows[0] !== undefined) {
      return toSnapshot(raced.rows[0]);
    }
    throw new DepositError('DEPOSIT_DERIVATION_FAILED');
  }
}

export class PostgresConfirmationPolicyRepository
  implements ConfirmationPolicyRepository
{
  public async activePolicy(
    context: TransactionContext,
    network: ChainNetwork
  ): Promise<ConfirmationPolicySnapshot> {
    const result = await context.executeSql<{
      policy_version: number;
      required_confirmations: number;
    }>(
      `SELECT policy_version, required_confirmations
         FROM confirmation_policies WHERE network = $1`,
      [network]
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new DepositError('DEPOSIT_NETWORK_UNSUPPORTED');
    }
    return {
      policyVersion: row.policy_version,
      network,
      requiredConfirmations: row.required_confirmations
    };
  }
}

export class PostgresDepositDetectionRepository
  implements DepositDetectionRepository
{
  public async upsertDetection(
    context: TransactionContext,
    input: {
      readonly addressId: string;
      readonly network: ChainNetwork;
      readonly networkTxid: string;
      readonly networkTimestamp: Date;
      readonly amount: string;
      readonly confirmations: number;
    }
  ): Promise<{ created: boolean; detectionId: string }> {
    const result = await context.executeSql<{ detection_id: string }>(
      `INSERT INTO deposit_detections
         (address_id, network, network_txid, network_timestamp,
          amount, confirmations, status)
       VALUES ($1::uuid, $2, $3, $4, $5::bigint, $6, 'DETECTED')
       ON CONFLICT (network, network_txid, address_id) DO UPDATE
         SET confirmations = GREATEST(
              deposit_detections.confirmations, $6
            ),
             updated_at = clock_timestamp()
       RETURNING detection_id`,
      [
        input.addressId,
        input.network,
        input.networkTxid,
        input.networkTimestamp,
        input.amount,
        input.confirmations
      ]
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new DepositError('DEPOSIT_COMMAND_INVALID');
    }
    return { created: true, detectionId: row.detection_id };
  }

  public async upsertDetectionDebug(input: {
    readonly addressId: string;
    readonly network: string;
    readonly networkTxid: string;
    readonly amount: string;
    readonly confirmations: number;
  }): Promise<string> {
    try {
      const result = await this.#directQuery(input);
      return result;
    } catch (error) {
      console.log('UPSERT-SQL-ERR', String(error).slice(0, 300));
      throw error;
    }
  }

  async #directQuery(input: {
    readonly addressId: string;
    readonly network: string;
    readonly networkTxid: string;
    readonly amount: string;
    readonly confirmations: number;
  }): Promise<string> {
    return 'stub';
  }

  public async findConfirmedDetections(
    context: TransactionContext,
    network: ChainNetwork
  ): Promise<
    readonly {
      detectionId: string;
      addressId: string;
      uid: Uid;
      assetCode: string;
      amount: string;
      networkTxid: string;
    }[]
  > {
    const result = await context.executeSql<{
      detection_id: string;
      address_id: string;
      uid: string;
      asset_code: string;
      amount: string;
      network_txid: string;
    }>(
      `SELECT d.detection_id, d.address_id, a.uid, a.asset_code,
              d.amount::text AS amount, d.network_txid
         FROM deposit_detections d
         JOIN deposit_addresses a ON a.address_id = d.address_id
        WHERE d.network = $1
          AND d.status = 'DETECTED'
          AND d.confirmations >= (
            SELECT required_confirmations FROM confirmation_policies
             WHERE network = $1
          )
        ORDER BY d.network_timestamp`,
      [network]
    );
    return result.rows.map((row) => ({
      detectionId: row.detection_id,
      addressId: row.address_id,
      uid: row.uid as Uid,
      assetCode: row.asset_code,
      amount: row.amount,
      networkTxid: row.network_txid
    }));
  }

  public async transitionStatus(
    context: TransactionContext,
    detectionId: string,
    from: DepositDetectionStatus,
    to: DepositDetectionStatus
  ): Promise<boolean> {
    const result = await context.executeSql(
      `UPDATE deposit_detections
          SET status = $3, updated_at = clock_timestamp()
        WHERE detection_id = $1::uuid AND status = $2
        RETURNING detection_id`,
      [detectionId, from, to]
    );
    return result.rows.length === 1;
  }
}
