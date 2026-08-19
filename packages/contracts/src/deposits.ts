import type { Uid } from './identity.js';

export type ChainNetwork = 'TRON' | 'ETHEREUM' | 'BITCOIN';

export type DepositAddressStatus = 'ACTIVE' | 'RETIRED' | 'COMPROMISED';

export type DepositDetectionStatus =
  | 'DETECTED'
  | 'CONFIRMED'
  | 'REORG_DETECTED'
  | 'POSTED'
  | 'FAILED_POST';

export interface DepositAddressSnapshot {
  readonly addressId: string;
  readonly uid: Uid;
  readonly assetCode: string;
  readonly network: ChainNetwork;
  readonly addressText: string;
  readonly derivationPath: string;
  readonly derivationIndex: number;
  readonly status: DepositAddressStatus;
}

export interface ConfirmationPolicySnapshot {
  readonly policyVersion: number;
  readonly network: ChainNetwork;
  readonly requiredConfirmations: number;
}

export interface DerivedAddress {
  readonly addressText: string;
  readonly derivationPath: string;
}

export interface AddressDerivationSource {
  deriveAddress(
    network: ChainNetwork,
    index: number
  ): Promise<DerivedAddress>;
}

export type DepositContractErrorCode =
  | 'DEPOSIT_COMMAND_INVALID'
  | 'DEPOSIT_ADDRESS_NOT_FOUND'
  | 'DEPOSIT_ADDRESS_ALREADY_ASSIGNED'
  | 'DEPOSIT_DERIVATION_FAILED'
  | 'DEPOSIT_NETWORK_UNSUPPORTED';
