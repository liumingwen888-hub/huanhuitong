import { describe, expect, it } from 'vitest';
import { contractPackageName } from '@xht/contracts';

describe('workspace contract package', () => {
  it('exports the stable package identity', () => {
    expect(contractPackageName).toBe('@xht/contracts');
  });
});
