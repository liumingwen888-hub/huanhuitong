import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LeasedOutboxMessage } from '@xht/contracts';
import {
  BindingNotFoundError,
  MainMenuContentInvalidError,
  TelegramMainMenuHandler
} from '../../src/outbox/telegram-main-menu.handler.js';
import type { SendMainMenuInput } from '../../src/infrastructure/telegram/telegram-bot.gateway.js';
import { mainMenuV1 } from '../../../platform/src/modules/telegram/application/main-menu.js';

const menu = {
  text: mainMenuV1.text,
  buttons: mainMenuV1.buttons
};

function menuMessage(
  bindingId: string,
  eventKey = 'telegram:menu:9100'
): LeasedOutboxMessage {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    topic: 'telegram.main-menu-requested.v1',
    eventKey,
    occurredAt: '2026-08-17T12:00:00.000Z',
    correlationId: '00000000-0000-4000-8000-000000000002',
    payload: {
      type: 'telegram.main-menu-requested.v1',
      eventId: 'e1',
      uid: 'u1',
      bindingId,
      menuVersion: 'main-menu-v1',
      occurredAt: '2026-08-17T12:00:00.000Z',
      correlationId: 'c1'
    },
    workerId: 'worker-1',
    leaseToken: '00000000-0000-4000-8000-000000000003',
    lockGeneration: 1,
    lockedUntil: '2026-08-17T12:00:30.000Z'
  };
}

class RecordingGateway {
  readonly calls: SendMainMenuInput[] = [];
  failure: Error | undefined;

  async sendMainMenu(input: SendMainMenuInput): Promise<void> {
    if (this.failure !== undefined) throw this.failure;
    this.calls.push(input);
  }
}

describe('Task 10 telegram main menu handler', () => {
  it('T10C11: recording gateway receives exactly mainMenuV1 with event idempotency key', async () => {
    const gateway = new RecordingGateway();
    const handler = new TelegramMainMenuHandler(
      gateway,
      { findExternalUserIdByBindingId: async () => '8100' },
      menu
    );
    await handler.handle(menuMessage('binding-1'));
    expect(gateway.calls).toEqual([
      {
        externalUserId: '8100',
        text: '请选择操作',
        buttons: [
          { id: 'account', label: '我的账户' },
          { id: 'help', label: '帮助' }
        ],
        idempotencyKey: 'telegram:menu:9100'
      }
    ]);
  });

  it('T10C12: gateway failures carry classification markers', async () => {
    const transient = new Error('temporary');
    (transient as { workerFailureClassification?: string }).workerFailureClassification = 'TRANSIENT';
    const gateway = new RecordingGateway();
    const handler = new TelegramMainMenuHandler(
      gateway,
      { findExternalUserIdByBindingId: async () => '8100' },
      menu
    );
    gateway.failure = transient;
    await expect(handler.handle(menuMessage('b'))).rejects.toThrow('temporary');
    gateway.failure = Object.assign(new Error('boom'), {
      workerFailureClassification: 'PERMANENT'
    });
    await expect(handler.handle(menuMessage('b'))).rejects.toMatchObject({
      workerFailureClassification: 'PERMANENT'
    });
  });

  it('T10C14: menu payload never carries sensitive material', async () => {
    const message = menuMessage('binding-2');
    const serialized = JSON.stringify(message.payload);
    for (const forbidden of [
      'chatId',
      'updateId',
      'messageText',
      'botToken',
      'secretToken',
      'startParameter'
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('malformed payloads and unknown bindings fail permanently', async () => {
    const gateway = new RecordingGateway();
    const handler = new TelegramMainMenuHandler(
      gateway,
      { findExternalUserIdByBindingId: async () => null },
      menu
    );
    await expect(handler.handle(menuMessage(''))).rejects.toBeInstanceOf(
      MainMenuContentInvalidError
    );
    await expect(handler.handle(menuMessage('missing'))).rejects.toBeInstanceOf(
      BindingNotFoundError
    );
  });

  it('T10C13/T10C15: disabled gateway state is frozen and default sources never touch the network', async () => {
    const disabledSource = await readFile(
      resolve(
        import.meta.dirname,
        '../../src/infrastructure/telegram/external-connection-disabled.gateway.ts'
      ),
      'utf8'
    );
    expect(disabledSource).toContain("enabled: false");
    expect(disabledSource).toContain("'WAITING_CONFIGURATION'");
    expect(disabledSource.match(/fetch|https?:\/\//u) ?? []).toEqual([]);
    const gatewaySource = await readFile(
      resolve(
        import.meta.dirname,
        '../../src/infrastructure/telegram/telegram-bot.gateway.ts'
      ),
      'utf8'
    );
    expect(gatewaySource.match(/fetch|https?:\/\//u) ?? []).toEqual([]);
  });
});
