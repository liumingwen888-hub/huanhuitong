import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const runbook = () =>
  readFile(
    resolve(import.meta.dirname, '../../../../docs/runbooks/disaster-runbook.md'),
    'utf8'
  );

describe('S10-5 disaster runbook', () => {
  it('S10DM01: all four scenarios are covered', async () => {
    const doc = await runbook();
    for (const scenario of ['账本分叉', '供应商异常', '密钥泄露', '数据丢失']) {
      expect(doc).toContain(`场景`);
      expect(doc).toContain(scenario);
    }
  });

  it('S10DM02: every scenario carries all five phases', async () => {
    const doc = await runbook();
    for (const phase of ['检测', '止损', '诊断', '恢复', '复盘']) {
      const occurrences = (doc.match(new RegExp(`### ${phase}`, 'gu')) ?? []).length;
      expect(occurrences).toBeGreaterThanOrEqual(4);
    }
  });

  it('S10DM03: red lines are stated (query-first / no auto-repay / no re-send)', async () => {
    const doc = await runbook();
    expect(doc).toContain('绝不推断失败');
    expect(doc).toContain('绝不自动重付');
    expect(doc).toContain('查询优先');
    expect(doc).toContain('原样保留');
  });

  it('S10DM04: mitigation actions reference concrete operations', async () => {
    const doc = await runbook();
    expect(doc).toContain('max_amount=1');
    expect(doc).toContain('DELETE /admin/auth/session');
    expect(doc).toContain('docker compose down');
    expect(doc).toContain('pg-restore-drill');
    expect(doc).toContain('pg-restore-check');
  });

  it('S10DM05: an escalation matrix with three severity tiers exists', async () => {
    const doc = await runbook();
    expect(doc).toContain('升级矩阵');
    for (const tier of ['P0', 'P1', 'P2']) {
      expect(doc).toContain(tier);
    }
    expect(doc).toMatch(/P0[\s\S]*账本分叉[\s\S]*数据丢失[\s\S]*密钥泄露/u);
  });
});
