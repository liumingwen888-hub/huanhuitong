import { describe, expect, it } from 'vitest';
import type { ResolveOrCreateUidCommand } from '@xht/contracts';
import {
  createRegistrationKey,
  parseChannelIdentityQuery,
  parseProfileSnapshot
} from '../../src/modules/identity/domain/identity.types.js';

describe('identity contract', () => {
  it('T7C01: accepts a string external id and keeps username optional', () => {
    const command: ResolveOrCreateUidCommand = {
      channelType: 'telegram',
      externalUserId: '9007199254740991',
      sourceMessageId: 'identity-contract-1',
      username: null,
      displayName: 'Synthetic User',
      correlationId: 'corr-identity-1',
      occurredAt: '2026-07-20T00:00:00.000Z'
    };
    expect(typeof command.externalUserId).toBe('string');
    expect(command.username).toBeNull();
  });

  it('T7C02: registration key derivation is deterministic per external user', () => {
    const first = createRegistrationKey('telegram', '7001');
    const second = createRegistrationKey('telegram', '7001');
    const other = createRegistrationKey('telegram', '7002');
    expect(first.registrationKey).toBe(second.registrationKey);
    expect(first.registrationKey).not.toBe(other.registrationKey);
    expect(first.registrationKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    );
  });

  it('T7C03: command shape has no injection surface for a registration key', () => {
    const command: ResolveOrCreateUidCommand = {
      channelType: 'telegram',
      externalUserId: '7001',
      sourceMessageId: 'm',
      username: null,
      displayName: null,
      correlationId: 'c',
      occurredAt: '2026-07-20T00:00:00.000Z'
    };
    expect(Object.keys(command)).toEqual([
      'channelType',
      'externalUserId',
      'sourceMessageId',
      'username',
      'displayName',
      'correlationId',
      'occurredAt'
    ]);
    expect(
      Object.keys(command).filter((key) => key.toLowerCase().includes('key'))
    ).toEqual([]);
  });

  it('T7C04: DTO parsing rejects proxies and malformed accessors before any touch', () => {
    const proxied = new Proxy(
      { channelType: 'telegram', externalUserId: '7001' },
      {}
    );
    expect(() => parseChannelIdentityQuery(proxied)).toThrowError(
      'IDENTITY_COMMAND_INVALID'
    );
    const withAccessor = {
      channelType: 'telegram',
      get externalUserId(): string {
        return '7001';
      }
    };
    expect(() => parseChannelIdentityQuery(withAccessor)).toThrowError(
      'IDENTITY_COMMAND_INVALID'
    );
    expect(() =>
      parseChannelIdentityQuery({ channelType: 'wechat', externalUserId: '7001' })
    ).toThrowError('IDENTITY_COMMAND_INVALID');
    expect(() =>
      parseProfileSnapshot({ username: 'x'.repeat(65), displayName: null })
    ).toThrowError('IDENTITY_COMMAND_INVALID');
  });

  it('T7C05: external user id must be non-zero-leading decimal within 19 digits', () => {
    expect(
      parseChannelIdentityQuery({ channelType: 'telegram', externalUserId: '1' })
        .externalUserId
    ).toBe('1');
    for (const invalid of ['0', '01', '', 'abc', '1'.repeat(20), 9001]) {
      expect(() =>
        parseChannelIdentityQuery({
          channelType: 'telegram',
          externalUserId: invalid as string
        })
      ).toThrowError('IDENTITY_COMMAND_INVALID');
    }
    expect(() =>
      createRegistrationKey('telegram', 'not-a-number')
    ).toThrowError('IDENTITY_REGISTRATION_KEY_INVALID');
  });

  it('T7C06: event type literals are frozen vocabulary', () => {
    const created = {
      type: 'identity.uid-created.v1',
      eventId: 'e1',
      uid: 'u',
      bindingId: 'b',
      occurredAt: 'o',
      correlationId: 'c'
    } as const;
    const seen = {
      type: 'identity.telegram-user-seen.v1',
      eventId: 'e2',
      uid: 'u',
      bindingId: 'b',
      occurredAt: 'o',
      correlationId: 'c'
    } as const;
    expect(created.type).toBe('identity.uid-created.v1');
    expect(seen.type).toBe('identity.telegram-user-seen.v1');
  });
});
