import { resolve } from 'node:path';
import { AsyncBarrier } from '@xht/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createComposedHarness,
  startBody,
  type ComposedHarness
} from './stage-one-webhook.integration.spec.js';

describe('concurrent first registration', () => {
  let composed: ComposedHarness;

  beforeAll(async () => {
    composed = await createComposedHarness();
    for (const table of [
      'outbox_messages',
      'inbox_messages',
      'registration_idempotency',
      'channel_bindings',
      'identity_profiles',
      'memberships',
      'users'
    ]) {
      await composed.harness.query(`DELETE FROM ${table}`);
    }
  }, 180_000);

  afterAll(async () => {
    await composed.stopAll();
  });

  it(
    '08: creates one uid under true concurrent first registration',
    { timeout: 60_000 },
    async () => {
      const barrier = new AsyncBarrier(2);
      composed.harness; // harness posts drive two pooled connections (A/B)
      let armed = false;
      composed.harness; // no-op
      const acquireArmed = async (): Promise<void> => {
        if (armed) await barrier.wait();
      };
      void acquireArmed;
      // Use the composed acquire hook by rebuilding is not possible per test;
      // instead block via the exported composition: this spec constructs its
      // own composed harness with the barrier armed only during Promise.all.
      const local = await createComposedHarness({
        acquireHook: async () => {
          if (armed) await barrier.wait();
        }
      });
      try {
        armed = true;
        const [left, right] = await Promise.all([
          local.harness.postWebhook(
            startBody({ updateId: '9601', externalUserId: '8601' })
          ),
          local.harness.postWebhook(
            startBody({ updateId: '9602', externalUserId: '8601' })
          )
        ]);
        armed = false;
        expect(left.status).toBe(200);
        expect(right.status).toBe(200);
        expect(await local.harness.count('users')).toBe(1);
        expect(await local.harness.count('memberships')).toBe(1);
        expect(await local.harness.countActiveBindings('8601')).toBe(1);
        expect(
          await local.harness.countTopic('identity.uid-created.v1')
        ).toBe(1);
        expect(await local.harness.distinctResolvedUids()).toHaveLength(1);
      } finally {
        await local.stopAll();
      }
    }
  );

  it(
    '09: allows only one active binding for one telegram user',
    { timeout: 60_000 },
    async () => {
      const barrier = new AsyncBarrier(2);
      let armed = false;
      const local = await createComposedHarness({
        acquireHook: async () => {
          if (armed) await barrier.wait();
        }
      });
      try {
        armed = true;
        const [left, right] = await Promise.all([
          local.harness.postWebhook(
            startBody({ updateId: '9603', externalUserId: '8602' })
          ),
          local.harness.postWebhook(
            startBody({ updateId: '9604', externalUserId: '8602' })
          )
        ]);
        armed = false;
        expect([left.status, right.status]).toEqual([200, 200]);
        expect(await local.harness.countActiveBindings('8602')).toBe(1);
        expect(await local.harness.distinctResolvedUids()).toHaveLength(1);
        expect(await local.harness.count('users')).toBe(1);
      } finally {
        await local.stopAll();
      }
    }
  );
});

void resolve;
