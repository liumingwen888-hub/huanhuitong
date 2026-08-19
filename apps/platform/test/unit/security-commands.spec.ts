import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifySecurityUpdate } from '../../src/modules/telegram/application/security-commands.js';
import { SECURITY_REPLIES } from '../../src/modules/telegram/application/security-replies.js';

function privateMessage(text: string): object {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      from: { id: 8901, is_bot: false, first_name: 'S' },
      chat: { id: 8901, type: 'private' },
      date: 1,
      text
    }
  };
}

describe('security command classification', () => {
  it('S6U01: recognizes the full command matrix', () => {
    expect(classifySecurityUpdate(privateMessage('/setpassword'))?.command).toEqual({ kind: 'begin-setup' });
    expect(classifySecurityUpdate(privateMessage('/cancel'))?.command).toEqual({ kind: 'cancel' });
    expect(classifySecurityUpdate(privateMessage('/done'))?.command).toEqual({ kind: 'done' });
    expect(classifySecurityUpdate(privateMessage('/authorize order-9'))?.command).toEqual({ kind: 'begin-authorize', orderRef: 'order-9' });
    expect(classifySecurityUpdate(privateMessage('135790'))?.command).toEqual({ kind: 'digits', value: '135790' });
    expect(classifySecurityUpdate(privateMessage(' 42 '))?.externalUserId).toBe('8901');
  });

  it('S6U02: rejects non-private, malformed, and unrelated input', () => {
    const group = {
      update_id: 2,
      message: { chat: { id: -100, type: 'group' }, text: '/setpassword' }
    };
    expect(classifySecurityUpdate(group)).toBeNull();
    expect(classifySecurityUpdate({ update_id: 3 })).toBeNull();
    expect(classifySecurityUpdate(privateMessage('hello world'))).toBeNull();
    expect(classifySecurityUpdate(privateMessage('/authorize '))).toBeNull();
    expect(classifySecurityUpdate(privateMessage('1234567890123'))).toBeNull();
    expect(classifySecurityUpdate('not-an-object')).toBeNull();
  });

  it('S6U03: replies are frozen constants with zero dynamic interpolation', async () => {
    const source = await readFile(
      resolve(import.meta.dirname, '../../src/modules/telegram/application/security-replies.ts'),
      'utf8'
    );
    expect(source.match(/\$\{|`/u) ?? []).toEqual([]);
    for (const text of Object.values(SECURITY_REPLIES)) {
      expect(typeof text).toBe('string');
      expect(text.includes('$')).toBe(false);
    }
    const handlerSource = await readFile(
      resolve(import.meta.dirname, '../../src/modules/telegram/application/security-command.handler.ts'),
      'utf8'
    );
    expect(
      handlerSource.match(/text:\s*message\.text|payload[\s\S]{0,80}\bvalue:|digits:\s*command/u) ?? []
    ).toEqual([]);
  });
});
