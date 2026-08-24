import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LoggingMetrics
} from '../../src/infrastructure/telemetry/logging-metrics.js';

describe('S10-2 observability', () => {
  it('S10OB01: counters accumulate and flush resets', () => {
    const metrics = new LoggingMetrics();
    metrics.incrementCounter('ledger_posting_total');
    metrics.incrementCounter('ledger_posting_total');
    metrics.incrementCounter('withdrawal_settled_total');
    const rows = metrics.flush();
    const byName = new Map(rows.map((row) => [row.name, row]));
    expect(byName.get('ledger_posting_total')?.values.count).toBe(2);
    expect(byName.get('withdrawal_settled_total')?.values.count).toBe(1);
    expect(metrics.flush()).toEqual([]);
  });

  it('S10OB02: attributes round-trip into flush rows', () => {
    const metrics = new LoggingMetrics();
    metrics.incrementCounter('payout_submitted_total', {
      domain: 'payout', outcome: 'accepted'
    });
    const rows = metrics.flush();
    expect(rows[0]?.attributes).toEqual({
      domain: 'payout', outcome: 'accepted'
    });
  });

  it('S10OB03: histograms track count/sum/min/max', () => {
    const metrics = new LoggingMetrics();
    metrics.recordHistogram('ledger_posting_duration_ms', 10);
    metrics.recordHistogram('ledger_posting_duration_ms', 30);
    metrics.recordHistogram('ledger_posting_duration_ms', 20);
    const rows = metrics.flush();
    expect(rows[0]?.values).toEqual({
      count: 3, sum: 60, min: 10, max: 30
    });
  });

  it('S10OB04: all six domain services carry metrics instrumentation', async () => {
    const sources = await Promise.all([
      'withdrawal-request.service.ts',
      'withdrawal-settlement.service.ts',
      'exchange-settlement.service.ts',
      'payout-submission.service.ts',
      'payout-settlement.service.ts',
      'post-money.service.ts'
    ].map((name) =>
      readFile(
        resolve(
          import.meta.dirname,
          '../../src/modules',
          name.startsWith('withdrawal') ? 'withdrawals' : '',
          name.startsWith('exchange') ? 'exchange' : '',
          name.startsWith('payout') ? 'fiatpayout' : '',
          name.startsWith('post-money') ? 'ledger/application' : '',
          'application',
          name
        ).replace(/\/{2,}/u, '/'),
        'utf8'
      ).catch(() =>
        readFile(
          resolve(
            import.meta.dirname,
            '../../src/modules/ledger/application',
            name
          ),
          'utf8'
        )
      )
    ));
    for (const source of sources) {
      expect(source).toContain('incrementCounter(');
      expect(source).toContain('MetricsPort');
    }
  });

  it('S10OB05: alert rules carry all five fields per rule', async () => {
    const raw = await readFile(
      resolve(import.meta.dirname, '../../../../deploy/alert-rules.yml'),
      'utf8'
    );
    const ruleCount = (raw.match(/- name:/gu) ?? []).length;
    expect(ruleCount).toBeGreaterThanOrEqual(6);
    for (const field of ['name:', 'metric:', 'threshold:', 'severity:', 'description:']) {
      const occurrences = (raw.match(new RegExp(`${field}`, 'gu')) ?? []).length;
      expect(occurrences).toBeGreaterThanOrEqual(ruleCount);
    }
    expect(raw).toContain('P0');
  });

  it('S10OB06: new log events all have logging-policy entries', async () => {
    const observabilitySource = await readFile(
      resolve(
        import.meta.dirname,
        '../../../../packages/contracts/src/observability.ts'
      ),
      'utf8'
    );
    const policySource = await readFile(
      resolve(
        import.meta.dirname,
        '../../../../packages/config/src/logging-policy.ts'
      ),
      'utf8'
    );
    for (const event of [
      'ledger_posting_rejected',
      'payout_provider_unavailable',
      'backup_completed',
      'backup_failed',
      'restore_validated',
      'release_gate_passed',
      'release_gate_blocked'
    ]) {
      expect(observabilitySource).toContain(event);
      expect(policySource).toContain(`${event}:`);
    }
  });
});
