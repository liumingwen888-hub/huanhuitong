import { readFile as nodeReadFile, realpath as nodeRealpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SecretReference } from './secret-reference.js';

export type SecretResolutionErrorCode =
  | 'ENV_NOT_FOUND'
  | 'FILE_PATH_FORBIDDEN'
  | 'FILE_NOT_FOUND'
  | 'READ_FAILED'
  | 'EMPTY_SECRET'
  | 'SECRET_TOO_LARGE'
  | 'RESOLVER_CLOSED'
  | 'SECRET_DISPOSED';

export class SecretResolutionError extends Error {
  public constructor(public readonly code: SecretResolutionErrorCode) {
    super(code);
    this.name = 'SecretResolutionError';
  }
}

export interface ResolvedSecret {
  withBytes<T>(consumer: (bytes: Uint8Array) => T | Promise<T>): Promise<T>;
  dispose(): void;
}

export interface SecretResolver {
  resolve(reference: SecretReference): Promise<ResolvedSecret>;
  dispose(): void;
}

export interface SecretResolverOptions {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly allowedFileRoots: readonly string[];
  readonly readFile?: (path: string) => Promise<Uint8Array>;
  readonly realpath?: (path: string) => Promise<string>;
  readonly fileUrlToPath?: (input: string | URL) => string;
  readonly maxSecretBytes?: number;
}

class MemoryResolvedSecret implements ResolvedSecret {
  private disposed = false;
  public constructor(private readonly value: Uint8Array) {}
  public async withBytes<T>(consumer: (bytes: Uint8Array) => T | Promise<T>): Promise<T> {
    if (this.disposed) throw new SecretResolutionError('SECRET_DISPOSED');
    return consumer(this.value);
  }
  public dispose(): void {
    if (!this.disposed) this.value.fill(0);
    this.disposed = true;
  }
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function classifyFileError(error: unknown): SecretResolutionError {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { readonly code: unknown }).code)
    : '';
  return new SecretResolutionError(code === 'ENOENT' ? 'FILE_NOT_FOUND' : 'READ_FAILED');
}

export function createSecretResolver(options: SecretResolverOptions): SecretResolver {
  const maxSecretBytes = options.maxSecretBytes ?? 65_536;
  if (!Number.isInteger(maxSecretBytes) || maxSecretBytes < 1 || maxSecretBytes > 65_536) {
    throw new SecretResolutionError('SECRET_TOO_LARGE');
  }
  if (options.allowedFileRoots.length === 0 || options.allowedFileRoots.some(root => !path.isAbsolute(root))) {
    throw new SecretResolutionError('FILE_PATH_FORBIDDEN');
  }
  const readFile = options.readFile ?? (async input => nodeReadFile(input));
  const realpath = options.realpath ?? nodeRealpath;
  const fromFileUrl = options.fileUrlToPath ?? fileURLToPath;
  let closed = false;

  async function finalize(source: Uint8Array): Promise<ResolvedSecret> {
    try {
      if (source.byteLength === 0) throw new SecretResolutionError('EMPTY_SECRET');
      if (source.byteLength > maxSecretBytes) throw new SecretResolutionError('SECRET_TOO_LARGE');
      return new MemoryResolvedSecret(Uint8Array.from(source));
    } finally {
      source.fill(0);
    }
  }

  return {
    async resolve(reference: SecretReference): Promise<ResolvedSecret> {
      if (closed) throw new SecretResolutionError('RESOLVER_CLOSED');
      if (reference.startsWith('env://')) {
        const name = reference.slice('env://'.length);
        const value = options.environment[name];
        if (value === undefined) throw new SecretResolutionError('ENV_NOT_FOUND');
        return finalize(new TextEncoder().encode(value));
      }
      const requestedPath = fromFileUrl(reference);
      let candidate: string;
      let roots: readonly string[];
      try {
        candidate = await realpath(requestedPath);
        roots = await Promise.all(options.allowedFileRoots.map(root => realpath(root)));
      } catch (error: unknown) {
        throw classifyFileError(error);
      }
      if (!roots.some(root => isWithinRoot(root, candidate))) {
        throw new SecretResolutionError('FILE_PATH_FORBIDDEN');
      }
      try { return finalize(await readFile(candidate)); }
      catch (error: unknown) {
        if (error instanceof SecretResolutionError) throw error;
        throw classifyFileError(error);
      }
    },
    dispose(): void { closed = true; }
  };
}

export async function withResolvedSecret<T>(
  resolver: SecretResolver,
  reference: SecretReference,
  consumer: (bytes: Uint8Array) => T | Promise<T>
): Promise<T> {
  const secret = await resolver.resolve(reference);
  try { return await secret.withBytes(consumer); }
  finally { secret.dispose(); }
}
