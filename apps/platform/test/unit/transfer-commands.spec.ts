import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyTransferUpdate } from '../../src/modules/telegram/application/transfer-commands.js';
import { TRANSFER_REPLIES } from '../../src/modules/telegram/application/transfer-replies.js';

function privateMessage(text: string): object {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      from: { id: 8501, is_bot: false, first_name: 'T' },
      chat: { id: 8501, type: 'private' },
      date: 1,
      text
    }
  };
}

describe('transfer command classification', () => {
  it('S5UX-U01: recognizes the full command matrix', () => {
    expect(classifyTransferUpdate(privateMessage('/balance'))?.command).toEqual({ kind: 'balance' });
    expect(classifyTransferUpdate(privateMessage('/transfer 8502 500000'))?.command).toEqual({
      kind: 'transfer', recipientExternalId: '8502', amount: '500000'
    });
    expect(classifyTransferUpdate(privateMessage('/claim clm-abc123'))?.command).toEqual({
      kind: 'claim', claimCode: 'clm-abc123'
    });
    expect(classifyTransferUpdate(privateMessage('/redpacket 600000 3'))?.command).toEqual({
      kind: 'red-packet', totalAmount: '600000', packetCount: 3
    });
  });

  it('S5UX-U02: rejects malformed input', () => {
    expect(classifyTransferUpdate(privateMessage('/transfer'))).toBeNull();
    expect(classifyTransferUpdate(privateMessage('/transfer abc 100'))).toBeNull();
    expect(classifyUpdate(privateMessage('/transfer 8502 0'))).toBeNull();
    expect(classifyTransferUpdate(privateMessage('/redpacket 100 0'))).toBeNull();
    expect(classifyTransferUpdate(privateMessage('/claim'))).toBeNull();
    expect(classifyTransferUpdate(privateMessage('random text'))).toBeNull();
    expect(classifyTransferUpdate({ update_id: 2 })).toBeNull();
    const group = {
      update_id: 3,
      message: { chat: { id: -100, type: 'group' }, text: '/transfer 8502 100' }
    };
    expect(classifyTransferUpdate(group)).toBeNull();
  });

  it('S5UX-U03: replies are frozen constants with zero dynamic interpolation', async () => {
    const source = await readFile(
      resolve(import.meta.dirname, '../../src/modules/telegram/application/transfer-replies.ts'),
      'utf8'
    );
    expect(source.match(/\\$\{|`/u) ?? []).toEqual([]);
    for (const text of Object.values(TRANSFER_REPLIES)) {
      expect(typeof text).toBe('string');
      expect(text.includes('$')).toBe(false);
    }
  });
});

function classifyUpdate(msg: object): unknown {
  return classifyTransferUpdate(msg);
}
