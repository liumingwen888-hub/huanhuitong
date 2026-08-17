export type InboxDigestKeyVersion = `v${number}`;
export type InboxPayloadDigest = `hmac-sha256:${string}`;

export interface InboxDigestCandidate {
  readonly keyVersion: InboxDigestKeyVersion;
  readonly payloadDigest: InboxPayloadDigest;
}

export interface InboxDigestSet {
  readonly current: InboxDigestCandidate;
  readonly comparisonCandidates: readonly InboxDigestCandidate[];
}

export const INBOX_PAYLOAD_DIGEST_PATTERN =
  /^hmac-sha256:[A-Za-z0-9_-]{43}$/u;
export const INBOX_DIGEST_KEY_VERSION_PATTERN =
  /^v[1-9][0-9]{0,8}$/u;

export function isInboxPayloadDigest(
  value: string
): value is InboxPayloadDigest {
  return INBOX_PAYLOAD_DIGEST_PATTERN.test(value);
}

export function isInboxDigestKeyVersion(
  value: string
): value is InboxDigestKeyVersion {
  return INBOX_DIGEST_KEY_VERSION_PATTERN.test(value);
}
