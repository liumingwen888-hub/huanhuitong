import type {
  ChainNetwork,
  ConfirmationPolicySnapshot,
  DepositAddressSnapshot,
  DepositDetectionStatus,
  Uid
} from '@xht/contracts';
import type { TransactionContext } from '../../../infrastructure/database/transaction-context.js';
import type { AddressDerivationSource } from '@xht/contracts';

export interface DepositAddressRepository {
  findAssignedAddress(
    context: TransactionContext,
    input: { readonly uid: Uid; readonly assetCode: string }
  ): Promise<DepositAddressSnapshot | null>;
  createNextAddress(
    context: TransactionContext,
    input: {
      readonly uid: Uid;
      readonly assetCode: string;
      readonly network: ChainNetwork;
      readonly derivation: AddressDerivationSource;
    }
  ): Promise<DepositAddressSnapshot>;
}

export interface ConfirmationPolicyRepository {
  activePolicy(
    context: TransactionContext,
    network: ChainNetwork
  ): Promise<ConfirmationPolicySnapshot>;
}

export interface DepositDetectionRepository {
  upsertDetection(
    context: TransactionContext,
    input: {
      readonly addressId: string;
      readonly network: ChainNetwork;
      readonly networkTxid: string;
      readonly networkTimestamp: Date;
      readonly amount: string;
      readonly confirmations: number;
    }
  ): Promise<{ created: boolean; detectionId: string }>;
  findConfirmedDetections(
    context: TransactionContext,
    network: ChainNetwork
  ): Promise<
    readonly {
      readonly detectionId: string;
      readonly addressId: string;
      readonly uid: Uid;
      readonly assetCode: string;
      readonly amount: string;
      readonly networkTxid: string;
    }[]
  >;
  transitionStatus(
    context: TransactionContext,
    detectionId: string,
    from: DepositDetectionStatus,
    to: DepositDetectionStatus
  ): Promise<boolean>;
}
