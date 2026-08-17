import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { UserFromGetMe } from 'grammy/types';
import { GrammyWebhookAdapter } from '../../src/modules/telegram/http/grammy-webhook.adapter.js';

const botInfo: UserFromGetMe = {
  id: 1,
  is_bot: true,
  first_name: 'Test',
  username: 'test_bot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false
} as unknown as UserFromGetMe;

describe('grammy webhook adapter', () => {
  it('T9C13: adapter source never calls bot.start and injects BotInfo', async () => {
    const source = await readFile(
      resolve(
        import.meta.dirname,
        '../../src/modules/telegram/http/grammy-webhook.adapter.ts'
      ),
      'utf8'
    );
    expect(source.match(/bot\.start/u) ?? []).toEqual([]);
    expect(source).toContain('botInfo: options.injectedBotInfo');
  });

  it('T9C12: any api call trips the forbidden-network hook', async () => {
    const forbidden: string[] = [];
    const adapter = new GrammyWebhookAdapter({
      fakeToken: '1:test',
      injectedBotInfo: botInfo,
      onForbiddenNetworkCall: (detail) => forbidden.push(detail)
    });
    expect(adapter.networkCallCount()).toBe(0);
    expect(forbidden).toEqual([]);
    expect(adapter).toBeDefined();
  });

  it('T9C14: identity and reliability sources contain zero grammy imports', async () => {
    const roots = [
      'apps/platform/src/modules/identity',
      'apps/platform/src/modules/reliability'
    ];
    const projectRoot = resolve(import.meta.dirname, '../../../..');
    const { readdir } = await import('node:fs/promises');
    for (const root of roots) {
      await assertNoGrammy(projectRoot, root, readdir);
    }
  });
});

async function assertNoGrammy(
  projectRoot: string,
  dir: string,
  readdir: (path: string) => Promise<string[]>
): Promise<void> {
  const entries = await readdir(resolve(projectRoot, dir));
  for (const entry of entries) {
    if (!entry.endsWith('.ts')) continue;
    const content = await readFile(resolve(projectRoot, dir, entry), 'utf8');
    expect(content.match(/from 'grammy|import.*grammy/u) ?? []).toEqual([]);
  }
}
