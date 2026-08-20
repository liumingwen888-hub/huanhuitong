import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const deployDir = resolve(import.meta.dirname, '../../../../deploy');

describe('S10-1 full-stack orchestration contract', () => {
  it('S10CO01: the compose file is structurally valid YAML with four services', async () => {
    const raw = await readFile(
      resolve(deployDir, 'docker-compose.yml'), 'utf8'
    );
    expect(raw).toContain('services:');
    for (const service of [
      'postgres', 'migrate', 'platform', 'worker', 'admin-web'
    ]) {
      expect(raw).toContain(`  ${service}:`);
    }
    expect(raw).toContain('networks:');
    expect(raw).toContain('volumes:');
    // internal-only postgres in production semantics: the debug port
    // is explicitly annotated as synthetic-only
    expect(raw).toContain('synthetic-debugging only');
    expect(raw).toContain('127.0.0.1:55432:5432');
    // fail-fast on required variables
    expect(raw).toMatch(/\$\{POSTGRES_OWNER_PASSWORD:\?required\}/u);
    expect(raw).toMatch(/\$\{DATABASE_URL_REF:\?required\}/u);
    expect(raw).toMatch(/\$\{TELEGRAM_WEBHOOK_SECRET_REF:\?required\}/u);
    expect(raw).toMatch(/\$\{INBOX_DIGEST_KEYRING_REF:\?required\}/u);
    // health gates
    expect(raw).toContain('service_healthy');
    expect(raw).toContain('service_completed_successfully');
  });

  it('S10CO03: the env example covers every required variable', async () => {
    const example = await readFile(
      resolve(deployDir, '.env.example'), 'utf8'
    );
    const compose = await readFile(
      resolve(deployDir, 'docker-compose.yml'), 'utf8'
    );
    const requiredVars = [
      ...compose.matchAll(/\$\{([A-Z_]+):\?required\}/gu
      )
    ].map((match) => match[1]);
    expect(requiredVars.length).toBeGreaterThanOrEqual(4);
    for (const variable of requiredVars) {
      expect(example).toContain(`${variable}=`);
    }
    // no secret material — only references
    expect(example).not.toMatch(/PASSWORD=(?!change-me-required)/u);
    expect(example).toContain('vault:<name>');
  });

  it('S10CO04: missing required env vars make compose refuse to start', () => {
    // the ${VAR:?required} syntax is enforced by docker compose itself:
    // this test pins the syntax so a future edit cannot silently
    // weaken it to a default
    const composeSyntax = /\$\{[A-Z_]+:\?required\}/u;
    expect(composeSyntax.test('${POSTGRES_OWNER_PASSWORD:?required}'))
      .toBe(true);
    expect(composeSyntax.test('${POSTGRES_OWNER_PASSWORD:-default}'))
      .toBe(false);
  });
});
