import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '../../../..');

async function read(relative: string): Promise<string> {
  return readFile(resolve(projectRoot, relative), 'utf8');
}

describe('stage one documentation handoff', () => {
  it('links the plan and separates implementation readiness from authorization', async () => {
    const [index, current, next, activePlans] = await Promise.all([
      read('docs/00-index.md'),
      read('docs/status/current.md'),
      read('docs/status/next.md'),
      read('docs/plans/active-plan-index.md')
    ]);
    expect(index).toContain(
      '2026-07-20-stage-1-foundation-identity-implementation-plan.md'
    );
    expect(activePlans).toContain('阶段 1');
    expect(current).toContain('阶段 1 代码 | VERIFIED');
    expect(current).toContain('当前生产部署授权：0');
    expect(next).toMatch(/阶段 [2-9]|阶段 10/u);
    expect(next).not.toContain('自动获得部署授权');
  });

  it('records the full task verification chain without gaps', async () => {
    const current = await read('docs/status/current.md');
    for (const task of [
      'Task 1 工程骨架 | VERIFIED',
      'Task 2 代码与测试 | VERIFIED',
      'Task 3 详细计划、代码与测试 | VERIFIED',
      'Task 4 代码 | IMPLEMENTED / VERIFIED / EXTERNAL REVIEW PASS',
      'Task 5 代码 | IMPLEMENTED / VERIFIED / EXTERNAL REVIEW PASS',
      'Task 6 代码 | IMPLEMENTED / VERIFIED / EXTERNAL REVIEW PASS',
      'Task 7 代码 | IMPLEMENTED / VERIFIED / EXTERNAL REVIEW PASS',
      'Task 8 代码 | IMPLEMENTED / VERIFIED / EXTERNAL REVIEW PASS',
      'Task 9 代码 | IMPLEMENTED / VERIFIED / EXTERNAL REVIEW PASS',
      'Task 10 代码 | IMPLEMENTED / VERIFIED / EXTERNAL REVIEW PASS',
      'Task 11 代码 | IMPLEMENTED / VERIFIED / EXTERNAL REVIEW PASS',
      'Task 12 代码 | IMPLEMENTED / VERIFIED / EXTERNAL REVIEW PASS',
      'Task 13 代码 | IMPLEMENTED / VERIFIED / EXTERNAL REVIEW PASS'
    ]) {
      expect(current).toContain(task);
    }
  });

  it('architecture and domain documents state implementation facts only', async () => {
    const topology = await read('docs/architecture/runtime-topology.md');
    expect(topology).toContain('Tasks 1–13 已实施并通过外部复审');
    const identity = await read('docs/domains/identity-and-membership.md');
    expect(identity).toContain('ResolveOrCreateUid');
    const telegram = await read('docs/domains/telegram-experience.md');
    expect(telegram).toContain('mainMenuV1');
  });
});
