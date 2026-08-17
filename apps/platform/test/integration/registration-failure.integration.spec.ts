import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createComposedHarness,
  startBody,
  type ComposedHarness
} from './stage-one-webhook.integration.spec.js';

describe('registration failure recovery', () => {
  afterAll(() => undefined);

  it(
    '14: rolls back the whole transaction when uid creation fails',
    { timeout: 60_000 },
    async () => {
      const composed = await createComposedHarness({ failIdentityCreate: true });
      try {
        const response = await composed.harness.postWebhook(
          startBody({ updateId: '9701', externalUserId: '8701' })
        );
        expect(response.status).toBe(500);
        for (const table of [
          'users',
          'memberships',
          'channel_bindings',
          'registration_idempotency',
          'outbox_messages'
        ] as const) {
          expect(await composed.harness.count(table)).toBe(0);
        }
      } finally {
        await composed.stopAll();
      }
    }
  );

  it(
    '15: leaves no half-registration when outbox insertion fails',
    { timeout: 60_000 },
    async () => {
      const composed = await createComposedHarness({ failOutboxInsert: true });
      try {
        const response = await composed.harness.postWebhook(
          startBody({ updateId: '9702', externalUserId: '8702' })
        );
        expect(response.status).toBe(500);
        for (const table of [
          'users',
          'memberships',
          'channel_bindings',
          'registration_idempotency',
          'inbox_messages'
        ] as const) {
          expect(await composed.harness.count(table)).toBe(0);
        }
      } finally {
        await composed.stopAll();
      }
    }
  );
});
