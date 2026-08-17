import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('dependency boundaries', () => {
  it('T12C01: rejects a domain import of a telegram adapter with the rule name', async () => {
    const fixtureRoot = resolve(
      import.meta.dirname,
      '../../fixtures/architecture/invalid-domain-to-telegram'
    );
    const configPath = resolve(
      fixtureRoot,
      '../../../../..',
      '.dependency-cruiser.cjs'
    );
    const failure = await execFileAsync(
      'pnpm',
      ['exec', 'depcruise', 'apps', '--config', configPath],
      { cwd: fixtureRoot }
    ).then(
      () => { throw new Error('EXPECTED_NON_ZERO_EXIT'); },
      (error: unknown) => error as { stdout: string; code: number }
    );
    expect(failure.code).not.toBe(0);
    expect(failure.stdout).toContain('no-domain-to-telegram');
  });

  it('T12C02: the real graph passes the gate with a non-empty module set', async () => {
    const projectRoot = resolve(import.meta.dirname, '../../../..');
    const result = await execFileAsync('pnpm', ['run', 'architecture:check'], {
      cwd: projectRoot
    });
    expect(result.stdout).toContain('no dependency violations found');
    expect(result.stdout).toMatch(/\d+ modules/);
  }, 120_000);

  it('T12C03: the config encodes only approved boundaries without broad ignores', async () => {
    const config = await readFile(
      resolve(import.meta.dirname, '../../../../.dependency-cruiser.cjs'),
      'utf8'
    );
    for (const rule of [
      'no-domain-to-telegram',
      'no-packages-to-apps',
      'no-worker-to-platform-internals',
      'no-circular'
    ]) {
      expect(config).toContain(rule);
    }
    expect(config.match(/exclude|ignoreOnly|pathNot/u) ?? []).toEqual([]);
  });
});
