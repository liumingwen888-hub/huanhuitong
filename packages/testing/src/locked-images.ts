import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type LockedImageName = 'postgres' | 'flyway';

export interface LockedImage {
  readonly reference: string;
  readonly platform: 'linux/amd64';
  readonly manifestListDigest: `sha256:${string}`;
  readonly digest: `sha256:${string}`;
  readonly immutableReference: string;
}

export class LockedImageError extends Error {
  readonly code:
    | 'LOCK_FILE_INVALID'
    | 'IMAGE_NOT_VERIFIED'
    | 'IMAGE_PLATFORM_MISMATCH'
    | 'IMAGE_REFERENCE_MISMATCH'
    | 'IMAGE_DIGEST_INVALID';

  constructor(code: LockedImageError['code']) {
    super(code);
    this.name = 'LockedImageError';
    this.code = code;
  }
}

interface ExpectedImage {
  readonly reference: string;
  readonly platform: 'linux/amd64';
  readonly manifestListDigest: `sha256:${string}`;
  readonly digest: `sha256:${string}`;
}

const EXPECTED_IMAGES = Object.freeze({
  postgres: Object.freeze({
    reference: 'postgres:18.4-alpine3.23',
    platform: 'linux/amd64',
    manifestListDigest:
      'sha256:996d0920e4ff9df1fc19dacb904492f3c1ec0ec1cc338f0ad7123be7731c5f5e',
    digest:
      'sha256:2342268e5cf8851c327dcf10fc124283448428059f9b756692b7e3302940d769'
  }),
  flyway: Object.freeze({
    reference: 'flyway/flyway:12.11.0-alpine',
    platform: 'linux/amd64',
    manifestListDigest:
      'sha256:6bf3a713f52c4d803a88501f8409dda2191e9ccba1454358a6de2c4cc65f71b0',
    digest:
      'sha256:bd93084ddaf1448d2598feaac75a1c2e7087c529566746724f65b05b481f9704'
  })
} satisfies Readonly<Record<LockedImageName, ExpectedImage>>);

const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseLockFile(lockFilePath: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(lockFilePath, 'utf8'));
    if (!isRecord(parsed) || parsed.schemaVersion !== 1) {
      throw new LockedImageError('LOCK_FILE_INVALID');
    }
    return parsed;
  } catch (error: unknown) {
    if (error instanceof LockedImageError) {
      throw error;
    }
    throw new LockedImageError('LOCK_FILE_INVALID');
  }
}

export function readLockedImage(
  name: LockedImageName,
  lockFilePath = resolve(import.meta.dirname, '../../../toolchain-lock.json')
): LockedImage {
  const lockFile = parseLockFile(lockFilePath);
  if (!isRecord(lockFile.images) || !isRecord(lockFile.images[name])) {
    throw new LockedImageError('LOCK_FILE_INVALID');
  }
  const entry = lockFile.images[name];
  const expected = EXPECTED_IMAGES[name];

  if (entry.status !== 'VERIFIED') {
    throw new LockedImageError('IMAGE_NOT_VERIFIED');
  }
  if (entry.platform !== expected.platform) {
    throw new LockedImageError('IMAGE_PLATFORM_MISMATCH');
  }
  if (entry.reference !== expected.reference) {
    throw new LockedImageError('IMAGE_REFERENCE_MISMATCH');
  }
  if (
    typeof entry.manifestListDigest !== 'string' ||
    typeof entry.digest !== 'string' ||
    !SHA256_DIGEST.test(entry.manifestListDigest) ||
    !SHA256_DIGEST.test(entry.digest)
  ) {
    throw new LockedImageError('IMAGE_DIGEST_INVALID');
  }
  if (
    entry.manifestListDigest !== expected.manifestListDigest ||
    entry.digest !== expected.digest
  ) {
    throw new LockedImageError('IMAGE_REFERENCE_MISMATCH');
  }

  return Object.freeze({
    reference: expected.reference,
    platform: expected.platform,
    manifestListDigest: expected.manifestListDigest,
    digest: expected.digest,
    immutableReference: `${expected.reference}@${expected.digest}`
  });
}
