import type {
  AddressDerivationSource,
  ChainNetwork,
  DepositAddressSnapshot,
  Uid
} from '@xht/contracts';
import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';
import { DepositError } from '../domain/deposit.errors.js';
import type { DepositAddressRepository } from './deposit.repository.js';

const ASSET_TO_NETWORK: ReadonlyMap<string, ChainNetwork> = new Map([
  ['USDT-TRC20', 'TRON'],
  ['USDT-ERC20', 'ETHEREUM'],
  ['ETH', 'ETHEREUM'],
  ['BTC', 'BITCOIN']
]);

/**
 * Find-or-create deposit address service with address reuse: the same
 * (uid, asset) pair always returns the same ACTIVE address until it is
 * retired or marked compromised. Fiat assets have no on-chain address.
 */
export class DepositAddressService {
  readonly #unitOfWork: UnitOfWork;
  readonly #addresses: DepositAddressRepository;
  readonly #derivation: AddressDerivationSource;

  constructor(
    unitOfWork: UnitOfWork,
    addresses: DepositAddressRepository,
    derivation: AddressDerivationSource
  ) {
    this.#unitOfWork = unitOfWork;
    this.#addresses = addresses;
    this.#derivation = derivation;
  }

  public async getOrCreateAddress(
    uid: Uid,
    assetCode: string
  ): Promise<DepositAddressSnapshot> {
    if (typeof assetCode !== 'string' || assetCode.length === 0) {
      throw new DepositError('DEPOSIT_COMMAND_INVALID');
    }
    const network = ASSET_TO_NETWORK.get(assetCode);
    if (network === undefined) {
      throw new DepositError('DEPOSIT_NETWORK_UNSUPPORTED');
    }
    return this.#unitOfWork.execute((context) => {
      return this.#addresses.findAssignedAddress(context, {
        uid,
        assetCode
      }).then((existing) => {
        if (existing !== null) return existing;
        return this.#addresses.createNextAddress(context, {
          uid,
          assetCode,
          network,
          derivation: this.#derivation
        });
      });
    });
  }

  public async retireAddress(addressId: string): Promise<boolean> {
    return this.#transitionStatus(addressId, 'ACTIVE', 'RETIRED');
  }

  public async markCompromised(addressId: string): Promise<boolean> {
    return this.#transitionStatus(addressId, 'ACTIVE', 'COMPROMISED');
  }

  async #transitionStatus(
    addressId: string,
    from: DepositAddressSnapshot['status'],
    to: DepositAddressSnapshot['status']
  ): Promise<boolean> {
    if (typeof addressId !== 'string' || addressId.length !== 36) {
      throw new DepositError('DEPOSIT_COMMAND_INVALID');
    }
    return this.#unitOfWork.execute(async (context) => {
      const result = await context.executeSql(
        `UPDATE deposit_addresses
            SET status = $3
          WHERE address_id = $1::uuid AND status = $2
          RETURNING address_id`,
        [addressId, from, to]
      );
      return result.rows.length === 1;
    });
  }

  public networkForAsset(assetCode: string): ChainNetwork {
    const network = ASSET_TO_NETWORK.get(assetCode);
    if (network === undefined) {
      throw new DepositError('DEPOSIT_NETWORK_UNSUPPORTED');
    }
    return network;
  }
}

Object.freeze(DepositAddressService.prototype);
