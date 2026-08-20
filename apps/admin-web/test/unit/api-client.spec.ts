import { describe, expect, it } from 'vitest';
import {
  ApiClientError,
  buildRequest,
  nextPageQuery,
  parseResponse,
  shouldAutoLogout
} from '../../src/api/client.js';

describe('S9-7 admin-web API client', () => {
  it('S9FE01: requests carry bearer, JSON body and query', () => {
    const withAll = buildRequest('POST', '/api/x', {
      token: 'tok',
      body: { a: 1 },
      query: { from: '2026-01-01T00:00:00Z', actor: 'admin-1' }
    });
    expect(withAll.init.headers.Authorization).toBe('Bearer tok');
    expect(withAll.init.headers['Content-Type'])
      .toBe('application/json');
    expect(withAll.init.body).toBe('{"a":1}');
    expect(withAll.url).toBe(
      '/api/x?from=2026-01-01T00%3A00%3A00Z&actor=admin-1'
    );
    const bare = buildRequest('GET', '/api/y');
    expect(bare.init.headers).toEqual({});
    expect(bare.url).toBe('/api/y');
    const emptyQuery = buildRequest('GET', '/api/z', { query: {} });
    expect(emptyQuery.url).toBe('/api/z');
  });

  it('S9FE02: responses parse to payloads and map error codes', () => {
    expect(parseResponse<{ v: number }>(200, { v: 7 })).toEqual({ v: 7 });
    expect(parseResponse(204, null)).toBeNull();
    expect(() => parseResponse(400, { code: 'CONFIG_TARGET_INVALID' }))
      .toThrow(ApiClientError);
    try {
      parseResponse(403, { code: 'ADMIN_API_ROLE_DENIED' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiClientError);
      const apiError = error as ApiClientError;
      expect(apiError.status).toBe(403);
      expect(apiError.code).toBe('ADMIN_API_ROLE_DENIED');
    }
    expect(() => parseResponse(500, 'garbage')).toThrow(
      new ApiClientError(500, 'HTTP_500')
    );
  });

  it('S9FE03: session-expiry errors trigger auto logout', () => {
    expect(
      shouldAutoLogout(
        new ApiClientError(401, 'ADMIN_API_SESSION_REQUIRED')
      )
    ).toBe(true);
    expect(
      shouldAutoLogout(new ApiClientError(401, 'ADMIN_SESSION_EXPIRED'))
    ).toBe(true);
    expect(
      shouldAutoLogout(new ApiClientError(401, 'ADMIN_AUTH_INVALID'))
    ).toBe(false);
    expect(
      shouldAutoLogout(new ApiClientError(403, 'ADMIN_API_ROLE_DENIED'))
    ).toBe(false);
  });

  it('S9FE04: pagination cursors thread into the next query', () => {
    const current = { category: 'ADMIN_API_', limit: '50' };
    const next = nextPageQuery(current, '2026-01-01T00:00:00Z~abc');
    expect(next).toEqual({
      category: 'ADMIN_API_',
      limit: '50',
      cursor: '2026-01-01T00:00:00Z~abc'
    });
    expect(nextPageQuery(current, null)).toBeNull();
  });
});
