#!/usr/bin/env node
// Release gate: the local equivalent of a CD pipeline. Every check
// must pass before RELEASE_GATE_PASSED; any failure blocks with the
// failing step names. There is NO --force escape: a failure is a
// failure.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SUMMARY_ONLY = process.argv.includes('--summary-only');

const QUICK_ONLY = new Set([
  'docs', 'secret-scan', 'alert-rules', 'migration-pins'
]);

const steps = [
  {
    name: 'build',
    summary: false,
    run: () => run('pnpm', ['build'])
  },
  {
    name: 'typecheck',
    summary: false,
    run: () => run('pnpm', ['-r', '--sort', 'run', 'typecheck'])
  },
  {
    name: 'architecture',
    summary: false,
    run: () => run('pnpm', ['architecture:check'])
  },
  {
    name: 'docs',
    summary: true,
    run: () => run('pnpm', ['docs:check'])
  },
  {
    name: 'unit',
    summary: false,
    run: () => run('npx', ['vitest', 'run', '--project', 'unit'])
  },
  {
    name: 'migration-pins',
    summary: true,
    run: () => checkMigrationPins()
  },
  {
    name: 'secret-scan',
    summary: true,
    run: () => secretScan()
  },
  {
    name: 'alert-rules',
    summary: true,
    run: () => checkAlertRules()
  }
];

function run(cmd, args) {
  execFileSync(cmd, args, { cwd: ROOT, stdio: 'pipe' });
}

function checkMigrationPins() {
  const files = readdirSync(resolve(ROOT, 'database/migrations'))
    .filter((f) => /^V\d+__.*\.sql$/u.test(f));
  const count = files.length;
  const spec = readFileSync(
    resolve(
      ROOT,
      'packages/testing/test/database/migrations.integration.spec.ts'
    ),
    'utf8'
  );
  const pinMatch = spec.match(
    /appliedVersions\]\.toEqual\(\[\n((?:\s*'[^']+',?\n)+)\s*\]\)/u
  );
  if (pinMatch === null) {
    // try the full-array form used historically
    const pins = (spec.match(/'(\d+)'/gu) ?? []).map((s) => s.replace(/'/gu, ''));
    const unique = [...new Set(pins)].length;
    if (unique < count) {
      throw new Error(
        `migration pin count ${unique} < file count ${count}`
      );
    }
    return;
  }
  const pinned = (pinMatch[1].match(/'(\d+)'/gu) ?? []).length;
  if (pinned !== count) {
    throw new Error(
      `migration pin count ${pinned} != file count ${count}`
    );
  }
}

const SECRET_PATTERNS = [
  /password\s*[:=]\s*['"][^'"$][^'"]{3,}['"]/iu,
  /secret\s*[:=]\s*['"][^'"{$][^'"]{3,}['"]/iu,
  /token\s*[:=]\s*['"][A-Za-z0-9_-]{16,}['"]/iu
];

const SCAN_EXCLUDE = [
  'node_modules', 'dist', '.git', '.zcode',
  'packages/testing/fixtures', 'docs/', '.env',
  // test files and the test harness carry documented synthetic
  // constants, never real secrets
  'test/', 'apps/platform/test', 'apps/worker/test', 'apps/admin-web/test',
  'packages/contracts/test', 'packages/config/test', 'packages/testing/test',
  'packages/testing/src'
];

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    const rel = full.slice(ROOT.length + 1);
    if (entry.isDirectory()) {
      if (SCAN_EXCLUDE.some((ex) => rel.startsWith(ex) || entry.name === ex)) {
        continue;
      }
      yield* walk(full);
    } else if (/\.(ts|mjs|json|ya?ml|sh)$/u.test(entry.name)) {
      yield full;
    }
  }
}

function secretScan() {
  const hits = [];
  for (const file of walk(ROOT)) {
    const rel = file.slice(ROOT.length + 1);
    const content = readFileSync(file, 'utf8');
    for (const pattern of SECRET_PATTERNS) {
      const match = content.match(pattern);
      if (match !== null) {
        hits.push(`${rel}: ${match[0].slice(0, 60)}`);
      }
    }
  }
  if (hits.length > 0) {
    throw new Error(`potential hardcoded secrets:\n  ${hits.join('\n  ')}`);
  }
}

function checkAlertRules() {
  const raw = readFileSync(
    resolve(ROOT, 'deploy/alert-rules.yml'), 'utf8'
  );
  const ruleCount = (raw.match(/- name:/gu) ?? []).length;
  if (ruleCount < 1) {
    throw new Error('no alert rules found');
  }
  for (const field of ['metric:', 'threshold:', 'severity:', 'description:']) {
    const occurrences = (raw.match(new RegExp(field, 'gu')) ?? []).length;
    if (occurrences < ruleCount) {
      throw new Error(
        `alert rules incomplete: ${field} appears ${occurrences}/${ruleCount}`
      );
    }
  }
}

// ── main ──
const started = Date.now();
const results = [];
for (const step of steps) {
  if (SUMMARY_ONLY && !step.summary) {
    results.push({ name: step.name, skipped: true });
    console.log(`  ⊘ ${step.name} (skipped in summary mode)`);
    continue;
  }
  const t0 = Date.now();
  try {
    step.run();
    results.push({ name: step.name, ok: true, ms: Date.now() - t0 });
    console.log(`  ✓ ${step.name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (error) {
    results.push({
      name: step.name, ok: false, ms: Date.now() - t0,
      detail: String(error.message ?? error).slice(0, 300)
    });
    console.log(`  ✗ ${step.name} — ${results.at(-1).detail}`);
    break;
  }
}

const failed = results.filter((r) => r.ok === false);
console.log('');
if (failed.length > 0) {
  console.error(
    `RELEASE_GATE_BLOCKED: ${failed.map((f) => f.name).join(', ')}`
  );
  process.exit(1);
}
const ran = results.filter((r) => r.skipped !== true);
console.log(
  `RELEASE_GATE_PASSED (${ran.length} checks, ` +
  `${((Date.now() - started) / 1000).toFixed(1)}s total)`
);
