import { createHash } from 'node:crypto';
import type {
  AddressDerivationSource,
  ChainNetwork,
  DerivedAddress
} from '@xht/contracts';

/**
 * Deterministic fake derivation for tests — never produces real keys.
 * The same (network, index) always yields the same address text.
 */
export class FakeDerivationSource implements AddressDerivationSource {
  public async deriveAddress(
    network: ChainNetwork,
    index: number
  ): Promise<DerivedAddress> {
    const hash = createHash('sha256')
      .update(`${network}:${index}`)
      .digest('hex')
      .slice(0, 40);
    const prefix =
      network === 'TRON' ? 'T' : network === 'ETHEREUM' ? '0x' : 'bc1q';
    return Object.freeze({
      addressText: `${prefix}${hash}`,
      derivationPath: `m/44'/${this.#coinType(network)}'/0'/0/${index}`
    });
  }

  #coinType(network: ChainNetwork): number {
    if (network === 'TRON') return 195;
    if (network === 'ETHEREUM') return 60;
    return 0;
  }
}

Object.freeze(FakeDerivationSource.prototype);
