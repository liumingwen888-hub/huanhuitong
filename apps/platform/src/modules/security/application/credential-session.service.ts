import { randomUUID } from 'node:crypto';
import type {
  AuthorizePaymentProofV1,
  CredentialOperationType,
  Uid
} from '@xht/contracts';
import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';
import { hashCredentialDigits } from '../domain/credential-hash.js';
import type { VerifyPaymentCredential } from './verify-payment-credential.js';
import type {
  CredentialRepository,
  CredentialSessionRepository
} from './credential.repository.js';
import { CredentialSessionRegistry } from './credential-session.registry.js';

export class CredentialSessionServiceError extends Error {
  public readonly code:
    | 'SESSION_NOT_OPEN'
    | 'SESSION_EXPIRED'
    | 'ENTRIES_MISMATCH'
    | 'DIGITS_OUT_OF_POLICY_RANGE';
  constructor(code: CredentialSessionServiceError['code']) {
    super(code);
    this.name = 'CredentialSessionServiceError';
    this.code = code;
  }
}

const SESSION_TTL_MILLIS = 5 * 60 * 1000;

export class CredentialSessionService {
  readonly #unitOfWork: UnitOfWork;
  readonly #sessions: CredentialSessionRepository;
  readonly #credentials: CredentialRepository;
  readonly #verifier: VerifyPaymentCredential;
  readonly #registry = new CredentialSessionRegistry();

  constructor(
    unitOfWork: UnitOfWork,
    sessions: CredentialSessionRepository,
    credentials: CredentialRepository,
    verifier: VerifyPaymentCredential
  ) {
    this.#unitOfWork = unitOfWork;
    this.#sessions = sessions;
    this.#credentials = credentials;
    this.#verifier = verifier;
  }

  public get registry(): CredentialSessionRegistry {
    return this.#registry;
  }

  public async beginSetup(uid: Uid): Promise<{
    readonly sessionId: string;
    readonly expiresAt: string;
  }> {
    const session = await this.#unitOfWork.execute((context) =>
      this.#sessions.createSession(context, {
        uid,
        purpose: 'credential-setup',
        actionNonce: randomUUID(),
        expiresAt: new Date(Date.now() + SESSION_TTL_MILLIS)
      })
    );
    this.#registry.open(session.sessionId, 'credential-setup');
    return { sessionId: session.sessionId, expiresAt: session.expiresAt };
  }

  public async beginAuthorization(input: {
    readonly uid: Uid;
    readonly operationType: CredentialOperationType;
    readonly orderRef: string;
    readonly amountSummary: string;
    readonly assetSummary: string;
  }): Promise<{ readonly sessionId: string; readonly expiresAt: string }> {
    const session = await this.#unitOfWork.execute((context) =>
      this.#sessions.createSession(context, {
        uid: input.uid,
        purpose: 'authorize-payment',
        orderRef: input.orderRef,
        amountSummary: input.amountSummary,
        assetSummary: input.assetSummary,
        actionNonce: randomUUID(),
        expiresAt: new Date(Date.now() + SESSION_TTL_MILLIS)
      })
    );
    this.#registry.open(session.sessionId, 'authorize-payment');
    this.#registry.require(session.sessionId).metadata.operationType =
      input.operationType;
    return { sessionId: session.sessionId, expiresAt: session.expiresAt };
  }

  public appendDigit(input: {
    readonly sessionId: string;
    readonly actionNonce: string;
    readonly digit: unknown;
    readonly phase: 'primary' | 'confirmation';
  }): void {
    const entry = this.#registry.require(input.sessionId);
    this.#registry.consumeNonce(input.sessionId, input.actionNonce);
    const buffer =
      input.phase === 'primary' ? entry.primary : entry.confirmation;
    buffer.appendDigit(input.digit);
  }

  public async confirmSetup(sessionId: string): Promise<void> {
    const entry = this.#registry.require(sessionId);
    await this.#assertOpen(sessionId);
    const policy = await this.#unitOfWork.execute((context) =>
      this.#credentials.activePolicy(context)
    );
    const length = entry.primary.length;
    if (
      length < policy.minDigits ||
      length > policy.maxDigits
    ) {
      this.#registry.close(sessionId);
      await this.#failSession(sessionId);
      throw new CredentialSessionServiceError('DIGITS_OUT_OF_POLICY_RANGE');
    }
    if (
      entry.primary.length !== entry.confirmation.length ||
      !entry.primary.snapshotEquals(entry.confirmation)
    ) {
      this.#registry.close(sessionId);
      await this.#failSession(sessionId);
      throw new CredentialSessionServiceError('ENTRIES_MISMATCH');
    }
    const hashed = await entry.primary.withBytes((bytes) =>
      hashCredentialDigits(bytes)
    );
    const uid = await this.#unitOfWork.execute(async (context) => {
      const row = await this.#sessions.findSession(context, sessionId);
      return row?.uid as Uid;
    });
    const confirmed = await this.#unitOfWork.execute(async (context) => {
      const transitioned = await this.#sessions.transitionSession(
        context,
        sessionId,
        'OPEN',
        'CONFIRMED'
      );
      if (!transitioned) return false;
      await this.#credentials.upsertActiveCredential(context, {
        uid,
        hashV1: hashed.hashV1,
        hashAlgorithm: 'scrypt' as never,
        hashParamVersion: hashed.paramVersion
      });
      return true;
    });
    this.#registry.close(sessionId);
    if (!confirmed) {
      throw new CredentialSessionServiceError('SESSION_NOT_OPEN');
    }
  }

  public async authorizePayment(
    sessionId: string
  ): Promise<
    | { readonly kind: 'authorized'; readonly proof: AuthorizePaymentProofV1 }
    | { readonly kind: 'rejected' | 'locked' | 'cooldown' | 'not_set' | 'revoked' }
  > {
    const entry = this.#registry.require(sessionId);
    await this.#assertOpen(sessionId);
    const session = await this.#unitOfWork.execute((context) =>
      this.#sessions.findSession(context, sessionId)
    );
    if (session === null) {
      throw new CredentialSessionServiceError('SESSION_NOT_OPEN');
    }
    const outcome = await this.#verifier.execute(session.uid as Uid, entry.primary);
    this.#registry.close(sessionId);
    if (outcome !== 'verified') {
      await this.#failSession(sessionId);
      return { kind: outcome };
    }
    const confirmed = await this.#unitOfWork.execute((context) =>
      this.#sessions.transitionSession(context, sessionId, 'OPEN', 'CONFIRMED')
    );
    if (!confirmed) {
      throw new CredentialSessionServiceError('SESSION_NOT_OPEN');
    }
    const proof: AuthorizePaymentProofV1 = Object.freeze({
      type: 'security.payment-authorized.v1',
      uid: session.uid,
      operationType: (entry.metadata.operationType ??
        'security-change') as CredentialOperationType,
      orderRef: session.orderRef ?? '',
      amountSummary: session.amountSummary ?? '',
      assetSummary: session.assetSummary ?? '',
      expiresAt: session.expiresAt,
      sessionId
    });
    return { kind: 'authorized', proof };
  }

  public async cancel(sessionId: string): Promise<void> {
    this.#registry.close(sessionId);
    await this.#unitOfWork.execute((context) =>
      this.#sessions.transitionSession(context, sessionId, 'OPEN', 'CANCELLED')
    );
  }

  async #assertOpen(sessionId: string): Promise<void> {
    const session = await this.#unitOfWork.execute((context) =>
      this.#sessions.findSession(context, sessionId)
    );
    if (session === null || session.status !== 'OPEN') {
      throw new CredentialSessionServiceError('SESSION_NOT_OPEN');
    }
    if (Date.parse(session.expiresAt) <= Date.now()) {
      this.#registry.close(sessionId);
      await this.#unitOfWork.execute((context) =>
        this.#sessions.transitionSession(
          context,
          sessionId,
          'OPEN',
          'EXPIRED'
        )
      );
      throw new CredentialSessionServiceError('SESSION_EXPIRED');
    }
  }

  async #failSession(sessionId: string): Promise<void> {
    await this.#unitOfWork.execute((context) =>
      this.#sessions.transitionSession(context, sessionId, 'OPEN', 'FAILED')
    );
  }
}
