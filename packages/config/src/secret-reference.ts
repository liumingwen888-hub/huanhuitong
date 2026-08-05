import { z } from 'zod';

declare const secretReferenceBrand: unique symbol;
export type SecretReference = string & { readonly [secretReferenceBrand]: 'SecretReference' };

export type SecretReferenceErrorCode =
  | 'LITERAL_SECRET_FORBIDDEN'
  | 'INVALID_ENV_REFERENCE'
  | 'INVALID_FILE_REFERENCE';

export class SecretReferenceError extends Error {
  public constructor(public readonly code: SecretReferenceErrorCode) {
    super(code);
    this.name = 'SecretReferenceError';
  }
}

const envReferencePattern = /^env:\/\/[A-Z][A-Z0-9_]{0,127}$/;
const safeFileSegmentPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function isCanonicalFileReference(value: string): boolean {
  if (!value.startsWith('file:///') || /[\\%?#\u0000-\u001f\u007f]/.test(value)) return false;
  const rawSegments = value.slice('file:///'.length).split('/');
  const firstSegment = rawSegments[0];
  const windowsDrive = firstSegment !== undefined && /^[A-Za-z]:$/.test(firstSegment);
  if (rawSegments.length === 0 || (windowsDrive && rawSegments.length < 2) ||
    rawSegments.some((segment, index) =>
    segment.length === 0 || segment === '.' || segment === '..' ||
    !((index === 0 && windowsDrive) || safeFileSegmentPattern.test(segment))
  )) return false;
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== 'file:' || url.host !== '' || url.username !== '' || url.password !== '') return false;
  return url.pathname === `/${rawSegments.join('/')}`;
}

export function parseSecretReference(value: unknown): SecretReference {
  if (typeof value !== 'string') throw new SecretReferenceError('LITERAL_SECRET_FORBIDDEN');
  if (value.startsWith('env://')) {
    if (!envReferencePattern.test(value)) throw new SecretReferenceError('INVALID_ENV_REFERENCE');
    return value as SecretReference;
  }
  if (value.startsWith('file://')) {
    if (!isCanonicalFileReference(value)) throw new SecretReferenceError('INVALID_FILE_REFERENCE');
    return value as SecretReference;
  }
  throw new SecretReferenceError('LITERAL_SECRET_FORBIDDEN');
}

export const secretReferenceSchema = z.string().transform((value, context) => {
  try { return parseSecretReference(value); }
  catch {
    context.addIssue({ code: 'custom', message: 'must be a secret reference' });
    return z.NEVER;
  }
});
