import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const backupDir = resolve(import.meta.dirname, '../../../../deploy/backup');

describe('S10-3 backup scripts and strategy', () => {
  it('S10BK01: pg-backup.sh structure is fail-fast with checksums', async () => {
    const script = await readFile(
      resolve(backupDir, 'pg-backup.sh'), 'utf8'
    );
    expect(script).toContain('set -euo pipefail');
    expect(script).toMatch(/case "\$KIND" in[\s\S]*physical\|logical\|both/u);
    expect(script).toContain('pg_basebackup');
    expect(script).toContain('--wal-method=stream');
    expect(script).toContain('pg_dump --format=custom');
    expect(script).toContain('sha256sum');
    expect(script).toContain('backup-manifest.txt');
    // zero hardcoded credentials — connection via PG* env only
    expect(script).toContain(': "${PGHOST:?PGHOST required}"');
    expect(script).not.toMatch(/postgres:\/\/[^$]/u);
    expect(script).not.toMatch(/PGPASSWORD=[^\$"]/u);
  });

  it('S10BK02: pg-restore-check.sh verifies tables and cleans up', async () => {
    const script = await readFile(
      resolve(backupDir, 'pg-restore-check.sh'), 'utf8'
    );
    expect(script).toContain('set -euo pipefail');
    expect(script).toContain('trap cleanup EXIT');
    expect(script).toContain('pg_restore --list');
    expect(script).toContain('docker run -d');
    for (const table of ['users', 'ledger_transactions', 'audit_events']) {
      expect(script).toContain(`from $table`);
    }
    expect(script).toContain('RESTORE_CHECK_PASSED');
    expect(script).toContain('docker rm -f');
  });

  it('S10BK03: compose enables WAL archiving for the physical track', async () => {
    const compose = await readFile(
      resolve(import.meta.dirname, '../../../../deploy/docker-compose.yml'),
      'utf8'
    );
    expect(compose).toContain('archive_mode=on');
    expect(compose).toContain('wal_level=replica');
    expect(compose).toContain('archive_command');
    expect(compose).toContain('walarchive:/wal_archive');
    expect(compose).toContain('walarchive:');
  });

  it('S10BK04: the runbook covers RPO/RTO, dual-track and the red line', async () => {
    const readme = await readFile(
      resolve(backupDir, 'README.md'), 'utf8'
    );
    expect(readme).toContain('备份必须验证');
    expect(readme).toContain('RPO');
    expect(readme).toContain('RTO');
    expect(readme).toMatch(/物理[\s\S]*pg_basepadding|pg_basebackup/u.test(readme)
      ? /pg_basebackup/u
      : /pg_basebackup/u);
    expect(readme).toContain('pg_dump');
    expect(readme).toContain('pg-restore-check.sh');
    expect(readme).toContain('SAFE_TO_RESUME');
    expect(readme).toContain('对账');
  });
});
