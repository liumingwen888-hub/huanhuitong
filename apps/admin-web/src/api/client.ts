export interface ApiRequestInit {
  readonly token?: string;
  readonly body?: unknown;
  readonly query?: Readonly<Record<string, string>>;
}

export interface BuiltRequest {
  readonly url: string;
  readonly init: {
    readonly method: string;
    readonly headers: Record<string, string>;
    readonly body?: string;
  };
}

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code: string;

  public constructor(status: number, code: string) {
    super(`API_${status}:${code}`);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
  }
}

export function buildRequest(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  init: ApiRequestInit = {}
): BuiltRequest {
  const headers: Record<string, string> = {};
  if (init.token !== undefined) {
    headers.Authorization = `Bearer ${init.token}`;
  }
  let body: string | undefined;
  if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.body);
  }
  let url = path;
  if (init.query !== undefined) {
    const params = new URLSearchParams(init.query);
    const serialized = params.toString();
    if (serialized !== '') {
      url = `${url}?${serialized}`;
    }
  }
  return {
    url,
    init:
      body === undefined
        ? { method, headers }
        : { method, headers, body }
  };
}

export function parseResponse<T>(
  status: number,
  json: unknown
): T {
  if (status >= 200 && status < 300) {
    return json as T;
  }
  const code =
    typeof json === 'object' &&
    json !== null &&
    'code' in json &&
    typeof (json as { code: unknown }).code === 'string'
      ? (json as { code: string }).code
      : `HTTP_${status}`;
  throw new ApiClientError(status, code);
}

export function shouldAutoLogout(error: ApiClientError): boolean {
  return (
    error.status === 401 &&
    (error.code === 'ADMIN_API_SESSION_REQUIRED' ||
      error.code === 'ADMIN_SESSION_INVALID' ||
      error.code === 'ADMIN_SESSION_EXPIRED')
  );
}

export function nextPageQuery(
  current: Readonly<Record<string, string>>,
  nextCursor: string | null
): Record<string, string> | null {
  if (nextCursor === null) {
    return null;
  }
  return { ...current, cursor: nextCursor };
}

export async function apiFetch<T>(
  fetchImpl: typeof fetch,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  init: ApiRequestInit = {}
): Promise<T> {
  const built = buildRequest(method, path, init);
  const response = await fetchImpl(built.url, built.init as never);
  const json: unknown =
    response.status === 204 ? null : await response.json().catch(() => null);
  return parseResponse<T>(response.status, json);
}
