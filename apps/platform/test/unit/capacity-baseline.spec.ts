import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const scriptPath = () =>
  readFile(resolve(import.meta.dirname, '../../../../scripts/benchmark-kernel.mjs'), 'utf8');
const docPath = () =>
  readFile(resolve(import.meta.dirname, '../../../../docs/operations/capacity-baseline.md'), 'utf8');

describe('S10-7 capacity baseline', () => {
  it('S10CP01: benchmark script covers three modes with parameters', async () => {
    const source = await scriptPath();
    for (const mode of ['posting-tps', 'concurrent-registration', 'read-latency']) {
      expect(source).toContain(mode);
    }
    expect(source).toContain("opt('posting'");
    expect(source).toContain("opt('registrations'");
    expect(source).toContain("opt('queries'");
    expect(source).toContain('JSON.stringify(result');
  });

  it('S10CP02: environment metadata enters the result', async () => {
    const source = await scriptPath();
    expect(source).toContain('nodeVersion: process.version');
    expect(source).toContain('timestamp');
    expect(source).toContain("environment: 'synthetic-container'");
    expect(source).toContain('ENVIRONMENT_BOUNDARY');
  });

  it('S10CP03: baseline doc has method, boundary and trend table', async () => {
    const doc = await docPath();
    expect(doc).toContain('ENVIRONMENT_BOUNDARY');
    expect(doc).toContain('benchmark-kernel.mjs');
    expect(doc).toContain('posting-tps');
    expect(doc).toContain('concurrent-registration');
    expect(doc).toContain('read-latency');
    expect(doc).toContain('趋势表');
    expect(doc).toContain('不预填');
  });

  it('S10CP04: degradation plan covers three triggers', async () => {
    const doc = await docPath();
    expect(doc).toContain('p99');
    expect(doc).toContain('max_amount=1');
    expect(doc).toContain('连接池');
    expect(doc).toContain('只读副本');
    expect(doc).toContain('降级预案');
  });

  it('S10CP05: the baseline doc is under docs and passes the docs gate', async () => {
    const doc = await docPath();
    expect(doc.length).toBeGreaterThan(500);
    expect(doc).not.toMatch(/生产承诺/u);
  });
});
