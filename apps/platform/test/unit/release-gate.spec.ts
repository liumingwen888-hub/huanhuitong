import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const gateSource = () =>
  readFile(resolve(import.meta.dirname, '../../../../scripts/release-gate.mjs'), 'utf8');

describe('S10-6 release gate', () => {
  it('S10RG01: all eight gates are present in order', async () => {
    const source = await gateSource();
    const order = [
      'build', 'typecheck', 'architecture', 'docs', 'unit',
      'migration-pins', 'secret-scan', 'alert-rules'
    ];
    let last = -1;
    for (const gate of order) {
      const pos = source.indexOf(`name: '${gate}'`);
      expect(pos, gate).toBeGreaterThanOrEqual(0);
      expect(pos).toBeGreaterThan(last);
      last = pos;
    }
  });

  it('S10RG02: failures block with step names and fail-fast', async () => {
    const source = await gateSource();
    expect(source).toContain('RELEASE_GATE_BLOCKED');
    expect(source).toContain('process.exit(1)');
    expect(source).toMatch(/failed\.map\(\(f\) => f\.name\)/u);
    expect(source).toContain('break;');
  });

  it('S10RG03: --summary-only skips test-heavy gates', async () => {
    const source = await gateSource();
    expect(source).toContain('--summary-only');
    expect(source).toContain('QUICK_ONLY');
    for (const gate of ['docs', 'secret-scan', 'alert-rules', 'migration-pins']) {
      expect(source).toContain(`'${gate}'`);
    }
    expect(source).toContain('skipped in summary mode');
  });

  it('S10RG04: secret-scan excludes fixtures and docs', async () => {
    const source = await gateSource();
    expect(source).toContain('SCAN_EXCLUDE');
    expect(source).toContain('packages/testing/fixtures');
    expect(source).toContain("'docs/'");
    expect(source).not.toMatch(/process\.argv\.includes\('--force'\)/u);
    expect(source).not.toMatch(/--force['"]\s*\)/u);
  });

  it('S10RG05: package.json mounts both gate scripts', async () => {
    const pkg = JSON.parse(await readFile(
      resolve(import.meta.dirname, '../../../../package.json'), 'utf8'
    ));
    expect(pkg.scripts['release:gate']).toContain('release-gate.mjs');
    expect(pkg.scripts['release:gate:quick']).toContain('--summary-only');
  });
});
