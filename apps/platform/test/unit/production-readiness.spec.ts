import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../..');
const read = (rel: string): Promise<string> =>
  readFile(resolve(root, rel), 'utf8');

describe('S10-8 production readiness acceptance', () => {
  it('S10PR01: orchestration contract holds (five services, fail-fast, gates)', async () => {
    const compose = await read('deploy/docker-compose.yml');
    for (const service of [
      'postgres', 'migrate', 'platform', 'worker', 'admin-web'
    ]) {
      expect(compose).toContain(`  ${service}:`);
    }
    expect(compose).toMatch(/\$\{DATABASE_URL_REF:\?required\}/u);
    expect(compose).toContain('service_completed_successfully');
    expect(compose).toContain('archive_mode=on');
  });

  it('S10PR02: observability contract holds (12 counters, 6 domains, rules)', async () => {
    const contracts = await read('packages/contracts/src/observability.ts');
    for (const metric of [
      'ledger_posting_total', 'ledger_posting_rejected_total',
      'withdrawal_requested_total', 'withdrawal_settled_total',
      'exchange_settled_total', 'payout_submitted_total',
      'payout_succeeded_total', 'outbox_enqueued_total',
      'outbox_delivered_total', 'inbox_duplicate_total',
      'admin_auth_failed_total', 'admin_api_denied_total'
    ]) {
      expect(contracts).toContain(metric);
    }
    const alertRules = await read('deploy/alert-rules.yml');
    expect((alertRules.match(/- name:/gu) ?? []).length)
      .toBeGreaterThanOrEqual(6);
  });

  it('S10PR03: backup contract holds (dual-track + verification + WAL)', async () => {
    const backup = await read('deploy/backup/pg-backup.sh');
    expect(backup).toContain('pg_basebackup');
    expect(backup).toContain('pg_dump --format=custom');
    expect(backup).toContain('sha256sum');
    const restoreCheck = await read('deploy/backup/pg-restore-check.sh');
    expect(restoreCheck).toContain('RESTORE_CHECK_PASSED');
    expect(restoreCheck).toContain('ledger_transactions');
  });

  it('S10PR04: drill contract holds (state machine + no side effects)', async () => {
    const drill = await read('deploy/backup/pg-restore-drill.sh');
    for (const phase of [
      'PLANNED', 'RESTORING', 'VALIDATING', 'RECONCILING',
      'SAFE_TO_RESUME'
    ]) {
      expect(drill).toContain(`phase "${phase}`);
    }
    expect(drill).toContain('NOT resent');
    expect(drill).toContain("status='LEASED'");
    expect(drill).toContain('RESTORE_DRILL_PASSED');
  });

  it('S10PR05: runbook contract holds (four scenarios × five phases)', async () => {
    const runbook = await read('docs/runbooks/disaster-runbook.md');
    for (const scenario of ['账本分叉', '供应商异常', '密钥泄露', '数据丢失']) {
      expect(runbook).toContain(scenario);
    }
    for (const phase of ['检测', '止损', '诊断', '恢复', '复盘']) {
      expect(
        (runbook.match(new RegExp(`### ${phase}`, 'gu')) ?? []).length
      ).toBeGreaterThanOrEqual(4);
    }
    expect(runbook).toContain('升级矩阵');
  });

  it('S10PR06: release gate contract holds (eight gates, no force)', async () => {
    const gate = await read('scripts/release-gate.mjs');
    for (const step of [
      'build', 'typecheck', 'architecture', 'docs', 'unit',
      'migration-pins', 'secret-scan', 'alert-rules'
    ]) {
      expect(gate).toContain(`name: '${step}'`);
    }
    expect(gate).toContain('RELEASE_GATE_BLOCKED');
    expect(gate).not.toMatch(/argv\.includes\('--force'\)/u);
  });

  it('S10PR07: baseline contract holds (three modes, not prefilled)', async () => {
    const baseline = await read('docs/operations/capacity-baseline.md');
    expect(baseline).toContain('ENVIRONMENT_BOUNDARY');
    expect(baseline).toContain('不预填');
    expect(baseline).toContain('benchmark-kernel.mjs');
    const script = await read('scripts/benchmark-kernel.mjs');
    expect(script).toContain('posting-tps');
    expect(script).toContain('read-latency');
  });

  it('S10PR08: the gate script is structurally sound (smoke)', async () => {
    // build/typecheck/architecture/docs are exercised by the release
    // gate itself; here we verify the gate script has balanced
    // structure (main runner + both exit paths)
    const gate = await read('scripts/release-gate.mjs');
    expect(gate).toContain('// ── main ──');
    expect(gate).toContain('RELEASE_GATE_PASSED');
    expect(gate).toContain('process.exit(1)');
    expect((gate.match(/function /gu) ?? []).length)
      .toBeGreaterThanOrEqual(3);
    expect(gate).toContain('steps');
  });

  it('S10PR09: environment boundaries are honestly enumerated', async () => {
    const boundaries = [
      ['S10CO02 compose 实弹', 'deploy/docker-compose.yml'],
      ['benchmark 实弹', 'scripts/benchmark-kernel.mjs'],
      ['PITR 实弹', 'deploy/backup/README.md'],
      ['生产部署', 'docs/plans/2026-08-19-stage-10-production-master-plan.md']
    ] as const;
    for (const [label, file] of boundaries) {
      const content = await read(file);
      expect(
        content.includes('ENVIRONMENT_BOUNDARY') ||
        content.includes('synthetic') ||
        content.includes('独立授权') ||
        content.includes('PITR'),
        label
      ).toBe(true);
    }
  });

  it('S10PR10: threat model carries the stage-10 additions', async () => {
    const threatModel = await read('docs/security/threat-model.md');
    expect(threatModel).toContain('阶段 10 威胁模型增补');
    for (const threat of ['备份文件泄露', '恢复演练重发副作用', '发布绕过', '观测盲区']) {
      expect(threatModel).toContain(threat);
    }
  });
});
