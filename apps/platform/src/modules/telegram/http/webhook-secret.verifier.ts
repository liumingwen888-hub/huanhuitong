import { timingSafeEqual } from 'node:crypto';

export function verifyWebhookSecret(
  actual: string | undefined,
  expected: string
): boolean {
  if (actual === undefined) return false;
  if (!/^[A-Za-z0-9_-]{1,256}$/u.test(actual)) return false;
  const actualBytes = Buffer.from(actual, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  if (actualBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(actualBytes, expectedBytes);
}
