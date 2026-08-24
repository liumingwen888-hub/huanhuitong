import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const drillScript = () =>
  readFile(
    resolve(
      import.meta.dirname,
      '../../../../deploy/backup/pg-restore-drill.sh'
    ),
    'utf8'
  );

describe('S10-4 restore drill script', () => {
  it('S10DR01: all five state-machine phases appear in order', async () => {
    const script = await drillScript();
    const positions = [
      ['PLANNED', script.indexOf('phase "PLANNED')],
      ['RESTORING', script.indexOf('phase "RESTORING')],
      ['VALIDATING', script.indexOf('phase "VALIDATING')],
      ['RECONCILING', script.indexOf('phase "RECONCILING')],
      ['SAFE_TO_RESUME', script.indexOf('phase "SAFE_TO_RESUME')]
    ] as const;
    for (const [name, pos] of positions) {
      expect(pos, name).toBeGreaterThanOrEqual(0);
    }
    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i]![1]).toBeGreaterThan(positions[i - 1]![1]);
    }
    expect(script).toContain('FAILED');
    expect(script).toContain('kept for inspection');
  });

  it('S10DR02: row-count parity covers the four critical tables', async () => {
    const script = await drillScript();
    expect(script).toContain(
      'for table in users ledger_transactions audit_events withdrawal_orders'
    );
    expect(script).toContain('row-count mismatch');
    expect(script).toMatch(/SRC_N.*RST_N/u);
  });

  it('S10DR03: reconciliation asserts balance and projection drift', async () => {
    const script = await drillScript();
    expect(script).toContain("direction='DEBIT'");
    expect(script).toContain("direction='CREDIT'");
    expect(script).toContain('ledger unbalanced');
    expect(script).toContain('projection drift');
    expect(script).toMatch(/signed_balance[\s\S]*ledger_entries/u);
  });

  it('S10DR04: no-new-side-effects assertions are present', async () => {
    const script = await drillScript();
    expect(script).toContain('outbox_messages where delivered_at is null');
    expect(script).toContain('NOT resent');
    expect(script).toContain("durable_jobs where status='LEASED'");
    expect(script).toContain('no new leases');
    expect(script).toContain('unexpected LEASED jobs');
  });

  it('S10DR05: cleanup defaults to destroy with --keep escape', async () => {
    const script = await drillScript();
    expect(script).toContain('KEEP=0');
    expect(script).toContain('--keep) KEEP=1');
    expect(script).toContain('trap cleanup EXIT');
    expect(script).toContain('docker rm -f');
    expect(script).toContain('preserved');
    // failure path keeps the container for inspection
    expect(script).toContain('container kept for inspection');
  });
});
