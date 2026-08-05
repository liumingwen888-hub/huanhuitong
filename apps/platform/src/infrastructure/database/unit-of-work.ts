import { AsyncLocalStorage } from 'node:async_hooks';
import type { StageOneDatabase } from '@xht/contracts';
import {
  CompiledQuery,
  SingleConnectionProvider,
  type AbortableOperationOptions,
  type DatabaseConnection,
  type Kysely,
  type QueryResult
} from 'kysely';
import {
  createTransactionContext,
  isAuthenticTransactionContextError,
  TransactionContextError,
  type TransactionContext
} from './transaction-context.js';
import {
  DATABASE_TRANSACTION_PRECOMMIT_PROBE_SQL,
  DatabaseConnectionReleaseError,
  DatabaseTransactionControlError
} from './database.js';

export type UnitOfWorkErrorCode =
  | 'NESTED_UNIT_OF_WORK'
  | 'TRANSACTION_ACQUIRE_FAILED'
  | 'TRANSACTION_BEGIN_FAILED'
  | 'TRANSACTION_CALLBACK_FAILED'
  | 'TRANSACTION_ABORTED_BEFORE_COMMIT'
  | 'TRANSACTION_ABORTED_AND_ROLLBACK_FAILED'
  | 'TRANSACTION_PRECOMMIT_CONNECTION_FAILED'
  | 'TRANSACTION_COMMIT_FAILED'
  | 'TRANSACTION_COMMIT_OUTCOME_UNKNOWN'
  | 'TRANSACTION_CALLBACK_AND_ROLLBACK_FAILED'
  | 'TRANSACTION_COMMIT_AND_ROLLBACK_FAILED'
  | 'TRANSACTION_COMMITTED_WITH_RELEASE_FAILURE'
  | 'TRANSACTION_CONTROL_STATEMENT_REJECTED'
  | 'TRANSACTION_QUERY_MULTISTATEMENT'
  | 'TRANSACTION_QUERY_UNSAFE'
  | 'TRANSACTION_INTERNAL_FAILED';

export type UnitOfWorkFailureCategory =
  | 'CALLBACK'
  | 'PRECOMMIT'
  | 'COMMIT'
  | 'ROLLBACK'
  | 'RELEASE';

export type UnitOfWorkOutcome =
  | 'NOT_COMMITTED'
  | 'ROLLED_BACK'
  | 'COMMITTED'
  | 'UNKNOWN';

interface UnitOfWorkErrorMetadata {
  readonly outcome: UnitOfWorkOutcome;
  readonly retryable: false;
  readonly primaryCategory?: UnitOfWorkFailureCategory;
  readonly cleanupCategory?: UnitOfWorkFailureCategory;
  readonly allowsSafeCause: boolean;
}

const authenticUnitOfWorkErrors = new WeakSet<object>();
const authenticPublicUnitOfWorkErrors = new WeakSet<object>();

export class UnitOfWorkError extends Error {
  readonly code: UnitOfWorkErrorCode;
  readonly outcome: UnitOfWorkOutcome;
  readonly retryable: false;
  readonly primaryCategory: UnitOfWorkFailureCategory | undefined;
  readonly cleanupCategory: UnitOfWorkFailureCategory | undefined;

  constructor(
    code: UnitOfWorkErrorCode,
    safeCause?: SafeCallbackError
  ) {
    const metadata = metadataFor(code);
    if (
      safeCause !== undefined &&
      (!metadata.allowsSafeCause || !isSafeCallbackError(safeCause))
    ) {
      throw new TypeError('UNIT_OF_WORK_SAFE_CAUSE_INVALID');
    }
    super(
      code,
      safeCause === undefined
        ? undefined
        : { cause: safeCause }
    );
    this.name = 'UnitOfWorkError';
    this.code = code;
    this.outcome = metadata.outcome;
    this.retryable = metadata.retryable;
    this.primaryCategory = metadata.primaryCategory;
    this.cleanupCategory = metadata.cleanupCategory;
    Object.defineProperty(this, 'stack', {
      value: `UnitOfWorkError: ${code}`,
      enumerable: false,
      writable: false,
      configurable: false
    });
    authenticUnitOfWorkErrors.add(this);
    Object.freeze(this);
  }
}

const PUBLIC_ERROR_CODE =
  /^(APPLICATION|DOMAIN)_[A-Z0-9_]{1,55}$/u;

export class PublicUnitOfWorkError extends Error {
  readonly code: string;
  readonly retryable = false as const;

  constructor(code: string) {
    if (!PUBLIC_ERROR_CODE.test(code)) {
      throw new TypeError('PUBLIC_UNIT_OF_WORK_ERROR_CODE_INVALID');
    }
    super(code);
    this.name = 'PublicUnitOfWorkError';
    this.code = code;
    Object.defineProperty(this, 'stack', {
      value: `PublicUnitOfWorkError: ${code}`,
      enumerable: false,
      writable: false,
      configurable: false
    });
    authenticPublicUnitOfWorkErrors.add(this);
    Object.freeze(this);
  }
}

type SafeCallbackError =
  | PublicUnitOfWorkError
  | TransactionContextError
  | UnitOfWorkError;

function isAuthenticPublicUnitOfWorkError(
  error: unknown
): error is PublicUnitOfWorkError {
  return (
    typeof error === 'object' &&
    error !== null &&
    authenticPublicUnitOfWorkErrors.has(error) &&
    Object.isFrozen(error) &&
    error instanceof PublicUnitOfWorkError &&
    Object.getPrototypeOf(error) ===
      PublicUnitOfWorkError.prototype
  );
}

function isAuthenticUnitOfWorkError(
  error: unknown
): error is UnitOfWorkError {
  return (
    typeof error === 'object' &&
    error !== null &&
    authenticUnitOfWorkErrors.has(error) &&
    Object.isFrozen(error) &&
    error instanceof UnitOfWorkError &&
    Object.getPrototypeOf(error) === UnitOfWorkError.prototype
  );
}

function isSafeCallbackError(error: unknown): error is SafeCallbackError {
  return (
    isAuthenticPublicUnitOfWorkError(error) ||
    isAuthenticTransactionContextError(error) ||
    isAuthenticUnitOfWorkError(error)
  );
}

Object.freeze(UnitOfWorkError.prototype);
Object.freeze(PublicUnitOfWorkError.prototype);

function metadataFor(
  code: UnitOfWorkErrorCode
): UnitOfWorkErrorMetadata {
  switch (code) {
    case 'NESTED_UNIT_OF_WORK':
    case 'TRANSACTION_ACQUIRE_FAILED':
    case 'TRANSACTION_BEGIN_FAILED':
      return {
        outcome: 'NOT_COMMITTED',
        retryable: false,
        allowsSafeCause: false
      };
    case 'TRANSACTION_CALLBACK_FAILED':
    case 'TRANSACTION_CONTROL_STATEMENT_REJECTED':
    case 'TRANSACTION_QUERY_MULTISTATEMENT':
    case 'TRANSACTION_QUERY_UNSAFE':
      return {
        outcome: 'ROLLED_BACK',
        retryable: false,
        primaryCategory: 'CALLBACK',
        allowsSafeCause: true
      };
    case 'TRANSACTION_CALLBACK_AND_ROLLBACK_FAILED':
      return {
        outcome: 'NOT_COMMITTED',
        retryable: false,
        primaryCategory: 'CALLBACK',
        cleanupCategory: 'ROLLBACK',
        allowsSafeCause: true
      };
    case 'TRANSACTION_ABORTED_BEFORE_COMMIT':
      return {
        outcome: 'ROLLED_BACK',
        retryable: false,
        primaryCategory: 'PRECOMMIT',
        allowsSafeCause: false
      };
    case 'TRANSACTION_ABORTED_AND_ROLLBACK_FAILED':
      return {
        outcome: 'NOT_COMMITTED',
        retryable: false,
        primaryCategory: 'PRECOMMIT',
        cleanupCategory: 'ROLLBACK',
        allowsSafeCause: false
      };
    case 'TRANSACTION_PRECOMMIT_CONNECTION_FAILED':
      return {
        outcome: 'NOT_COMMITTED',
        retryable: false,
        primaryCategory: 'PRECOMMIT',
        allowsSafeCause: false
      };
    case 'TRANSACTION_COMMIT_FAILED':
      return {
        outcome: 'ROLLED_BACK',
        retryable: false,
        primaryCategory: 'COMMIT',
        allowsSafeCause: false
      };
    case 'TRANSACTION_COMMIT_AND_ROLLBACK_FAILED':
      return {
        outcome: 'NOT_COMMITTED',
        retryable: false,
        primaryCategory: 'COMMIT',
        cleanupCategory: 'ROLLBACK',
        allowsSafeCause: false
      };
    case 'TRANSACTION_COMMIT_OUTCOME_UNKNOWN':
      return {
        outcome: 'UNKNOWN',
        retryable: false,
        primaryCategory: 'COMMIT',
        allowsSafeCause: false
      };
    case 'TRANSACTION_COMMITTED_WITH_RELEASE_FAILURE':
      return {
        outcome: 'COMMITTED',
        retryable: false,
        primaryCategory: 'RELEASE',
        cleanupCategory: 'RELEASE',
        allowsSafeCause: false
      };
    case 'TRANSACTION_INTERNAL_FAILED':
      return {
        outcome: 'UNKNOWN',
        retryable: false,
        allowsSafeCause: false
      };
  }
}

function isControlError(
  error: unknown,
  code: DatabaseTransactionControlError['code']
): error is DatabaseTransactionControlError {
  return (
    error instanceof DatabaseTransactionControlError &&
    error.code === code
  );
}

function callbackFailure(
  callbackError: unknown,
  rollbackSucceeded: boolean
): never {
  if (
    isControlError(
      callbackError,
      'DATABASE_TRANSACTION_CONTROL_STATEMENT_REJECTED'
    ) ||
    isControlError(callbackError, 'DATABASE_TRANSACTION_QUERY_MULTISTATEMENT') ||
    isControlError(callbackError, 'DATABASE_TRANSACTION_QUERY_UNSAFE')
  ) {
    const policyCode = isControlError(
      callbackError,
      'DATABASE_TRANSACTION_CONTROL_STATEMENT_REJECTED'
    )
      ? 'TRANSACTION_CONTROL_STATEMENT_REJECTED'
      : isControlError(
          callbackError,
          'DATABASE_TRANSACTION_QUERY_MULTISTATEMENT'
        )
        ? 'TRANSACTION_QUERY_MULTISTATEMENT'
        : 'TRANSACTION_QUERY_UNSAFE';
    const policyError = new UnitOfWorkError(policyCode);
    if (rollbackSucceeded) throw policyError;
    throw new UnitOfWorkError(
      'TRANSACTION_CALLBACK_AND_ROLLBACK_FAILED',
      policyError
    );
  }
  const safeError = isSafeCallbackError(callbackError)
    ? callbackError
    : undefined;
  if (rollbackSucceeded) {
    throw new UnitOfWorkError(
      'TRANSACTION_CALLBACK_FAILED',
      safeError
    );
  }
  throw new UnitOfWorkError(
    'TRANSACTION_CALLBACK_AND_ROLLBACK_FAILED',
    safeError
  );
}

type SqlIdentifierToken = {
  readonly kind: 'identifier';
  readonly text: string;
  readonly quoted: boolean;
  readonly depth: number;
};
type SqlSymbolToken = {
  readonly kind: 'symbol';
  readonly text: '(' | ')' | '.' | ',';
  readonly depth: number;
};
type SqlToken = SqlIdentifierToken | SqlSymbolToken;

const CALLBACK_STATEMENT_FAMILIES = new Set([
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'MERGE',
  'VALUES'
]);

function isIdentifier(
  token: SqlToken | undefined,
  expected: string
): token is SqlIdentifierToken {
  if (token?.kind !== 'identifier') return false;
  return token.quoted
    ? token.text === expected.toLowerCase()
    : token.text === expected;
}

function isSymbol(
  token: SqlToken | undefined,
  expected: SqlSymbolToken['text']
): token is SqlSymbolToken {
  return token?.kind === 'symbol' && token.text === expected;
}

function isAllowedStatement(
  token: SqlToken | undefined
): token is SqlIdentifierToken {
  return token?.kind === 'identifier' &&
    !token.quoted &&
    CALLBACK_STATEMENT_FAMILIES.has(token.text);
}

function closeTopLevelGroup(
  tokens: readonly SqlToken[],
  openIndex: number
): number | undefined {
  if (!isSymbol(tokens[openIndex], '(')) return undefined;
  for (let i = openIndex + 1; i < tokens.length; i += 1) {
    if (isSymbol(tokens[i], ')')) return i;
  }
  return undefined;
}

function findStatement(
  tokens: readonly SqlToken[]
): { readonly token: SqlIdentifierToken; readonly index: number } | undefined {
  const topLevel = tokens.filter((token) => token.depth === 0);
  if (isAllowedStatement(topLevel[0])) {
    return { token: topLevel[0], index: 0 };
  }
  if (!isIdentifier(topLevel[0], 'WITH')) return undefined;

  let i = 1;
  if (isIdentifier(topLevel[i], 'RECURSIVE')) i += 1;
  while (i < topLevel.length) {
    if (topLevel[i]?.kind !== 'identifier') return undefined;
    i += 1;
    if (isSymbol(topLevel[i], '(')) {
      const close = closeTopLevelGroup(topLevel, i);
      if (close === undefined) return undefined;
      i = close + 1;
    }
    if (!isIdentifier(topLevel[i], 'AS')) return undefined;
    i += 1;
    if (isIdentifier(topLevel[i], 'NOT')) {
      i += 1;
      if (!isIdentifier(topLevel[i], 'MATERIALIZED')) return undefined;
      i += 1;
    } else if (isIdentifier(topLevel[i], 'MATERIALIZED')) {
      i += 1;
    }
    if (!isSymbol(topLevel[i], '(')) return undefined;
    const close = closeTopLevelGroup(topLevel, i);
    if (close === undefined) return undefined;
    i = close + 1;
    if (isSymbol(topLevel[i], ',')) {
      i += 1;
      continue;
    }
    const statement = topLevel[i];
    if (!isAllowedStatement(statement)) return undefined;
    return { token: statement, index: i };
  }
  return undefined;
}

function containsSetConfigCall(tokens: readonly SqlToken[]): boolean {
  return tokens.some((token, index) =>
    isIdentifier(token, 'SET_CONFIG') &&
    isSymbol(tokens[index + 1], '(')
  );
}

function updateTargetsPgSettings(
  tokens: readonly SqlToken[],
  updateIndex: number
): boolean {
  const update = tokens[updateIndex];
  if (
    update === undefined ||
    update.kind !== 'identifier' ||
    update.quoted ||
    update.text !== 'UPDATE'
  ) {
    return false;
  }
  const statementDepth = update.depth;
  let i = updateIndex + 1;
  const optionalOnly = tokens[i];
  if (
    optionalOnly !== undefined &&
    optionalOnly.kind === 'identifier' &&
    optionalOnly.depth === statementDepth &&
    !optionalOnly.quoted &&
    optionalOnly.text === 'ONLY'
  ) {
    i += 1;
  }
  if (tokens[i]?.depth !== statementDepth) return false;
  if (isIdentifier(tokens[i], 'PG_SETTINGS')) return true;
  return isIdentifier(tokens[i], 'PG_CATALOG') &&
    tokens[i + 1]?.depth === statementDepth &&
    isSymbol(tokens[i + 1], '.') &&
    tokens[i + 2]?.depth === statementDepth &&
    isIdentifier(tokens[i + 2], 'PG_SETTINGS');
}

function updatesPgSettings(tokens: readonly SqlToken[]): boolean {
  return tokens.some((_token, index) =>
    updateTargetsPgSettings(tokens, index)
  );
}

function isAllowedCallbackStatement(tokens: readonly SqlToken[]): boolean {
  const statement = findStatement(tokens);
  if (statement === undefined) return false;
  if (containsSetConfigCall(tokens)) return false;
  if (updatesPgSettings(tokens)) return false;
  return true;
}

function scanCallbackSql(sqlText: string):
  | { readonly kind: 'ok' }
  | { readonly kind: 'control' }
  | { readonly kind: 'multi' }
  | { readonly kind: 'unsafe' } {
  let i = sqlText.charCodeAt(0) === 0xfeff ? 1 : 0;
  let state:
    | 'code'
    | 'single'
    | 'escape'
    | 'double'
    | 'line'
    | 'block'
    | 'dollar' = 'code';
  let blockDepth = 0;
  let dollarTag = '';
  let doubleValue = '';
  let doubleDepth = 0;
  let statementHasCode = false;
  let statementTerminated = false;
  let parenthesesDepth = 0;
  let bracketsDepth = 0;
  const tokens: SqlToken[] = [];
  const pushIdentifier = (
    text: string,
    quoted: boolean,
    depth: number
  ) => {
    tokens.push({
      kind: 'identifier',
      text: quoted ? text : text.toUpperCase(),
      quoted,
      depth
    });
  };
  const pushSymbol = (
    text: SqlSymbolToken['text'],
    depth: number
  ) => {
    tokens.push({ kind: 'symbol', text, depth });
  };
  const isIdentifierContinuation = (value: string): boolean =>
    /[A-Za-z0-9_$]/u.test(value);
  const hasPrefixBoundary = (index: number): boolean =>
    index === 0 || !isIdentifierContinuation(sqlText[index - 1] ?? '');
  const markCode = (): boolean => {
    if (statementTerminated) return false;
    statementHasCode = true;
    return true;
  };
  while (i < sqlText.length) {
    const ch = sqlText[i]!;
    const next = sqlText[i + 1] ?? '';
    if (state === 'line') { if (ch === '\n' || ch === '\r') state = 'code'; i += 1; continue; }
    if (state === 'block') {
      if (ch === '/' && next === '*') { blockDepth += 1; i += 2; continue; }
      if (ch === '*' && next === '/') { blockDepth -= 1; i += 2; state = blockDepth === 0 ? 'code' : 'block'; continue; }
      i += 1; continue;
    }
    if (state === 'single') {
      if (ch === '\\') return { kind: 'unsafe' };
      if (ch === "'" && next === "'") { i += 2; continue; }
      if (ch === "'") state = 'code';
      i += 1;
      continue;
    }
    if (state === 'escape') {
      if (ch === '\\') {
        if (i + 1 >= sqlText.length) return { kind: 'unsafe' };
        i += 2;
        continue;
      }
      if (ch === "'" && next === "'") { i += 2; continue; }
      if (ch === "'") state = 'code';
      i += 1;
      continue;
    }
    if (state === 'double') {
      if (ch === '"' && next === '"') {
        doubleValue += '"';
        i += 2;
        continue;
      }
      if (ch === '"') {
        pushIdentifier(doubleValue, true, doubleDepth);
        state = 'code';
        i += 1;
        continue;
      }
      doubleValue += ch;
      i += 1;
      continue;
    }
    if (state === 'dollar') { if (sqlText.startsWith(dollarTag, i)) { i += dollarTag.length; state = 'code'; } else i += 1; continue; }
    if (ch === '-' && next === '-') { state = 'line'; i += 2; continue; }
    if (ch === '/' && next === '*') { state = 'block'; blockDepth = 1; i += 2; continue; }
    if (
      (ch === 'U' || ch === 'u') &&
      next === '&' &&
      (sqlText[i + 2] === "'" || sqlText[i + 2] === '"') &&
      hasPrefixBoundary(i)
    ) {
      return { kind: 'unsafe' };
    }
    if (
      (ch === 'B' || ch === 'b' || ch === 'X' || ch === 'x' ||
        ch === 'N' || ch === 'n') &&
      next === "'" &&
      hasPrefixBoundary(i)
    ) {
      return { kind: 'unsafe' };
    }
    if (
      (ch === 'E' || ch === 'e') &&
      next === "'" &&
      hasPrefixBoundary(i)
    ) {
      if (!markCode()) return { kind: 'multi' };
      state = 'escape';
      i += 2;
      continue;
    }
    if (ch === "'") {
      if (!markCode()) return { kind: 'multi' };
      state = 'single';
      i += 1;
      continue;
    }
    if (ch === '"') {
      if (!markCode()) return { kind: 'multi' };
      doubleValue = '';
      doubleDepth = parenthesesDepth;
      state = 'double';
      i += 1;
      continue;
    }
    if (ch === '$') {
      const match = sqlText.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/u);
      if (match && hasPrefixBoundary(i)) {
        if (!markCode()) return { kind: 'multi' };
        dollarTag = match[0];
        state = 'dollar';
        i += dollarTag.length;
        continue;
      }
      if (
        hasPrefixBoundary(i) &&
        (next === '$' || /[A-Za-z_]/u.test(next))
      ) {
        return { kind: 'unsafe' };
      }
    }
    if (ch === ';') {
      if (!statementHasCode || statementTerminated) return { kind: 'multi' };
      statementTerminated = true;
      statementHasCode = false;
      i += 1;
      continue;
    }
    if (/\s/u.test(ch)) { i += 1; continue; }
    const word = sqlText.slice(i).match(/^[A-Za-z_][A-Za-z0-9_$]*/u);
    if (word) {
      if (!markCode()) return { kind: 'multi' };
      i += word[0].length;
      pushIdentifier(word[0], false, parenthesesDepth);
      continue;
    }
    if (!markCode()) return { kind: 'multi' };
    if (ch === '(') {
      pushSymbol('(', parenthesesDepth);
      parenthesesDepth += 1;
    }
    if (ch === ')') {
      if (parenthesesDepth === 0) return { kind: 'unsafe' };
      parenthesesDepth -= 1;
      pushSymbol(')', parenthesesDepth);
    }
    if (ch === '[') bracketsDepth += 1;
    if (ch === ']') {
      if (bracketsDepth === 0) return { kind: 'unsafe' };
      bracketsDepth -= 1;
    }
    if (ch === '.') pushSymbol('.', parenthesesDepth);
    if (ch === ',') pushSymbol(',', parenthesesDepth);
    if (ch === '\\') return { kind: 'unsafe' };
    i += 1;
  }
  if (
    state === 'single' ||
    state === 'escape' ||
    state === 'double' ||
    state === 'block' ||
    state === 'dollar' ||
    parenthesesDepth !== 0 ||
    bracketsDepth !== 0 ||
    (!statementHasCode && !statementTerminated)
  ) {
    return { kind: 'unsafe' };
  }
  if (!isAllowedCallbackStatement(tokens)) return { kind: 'control' };
  return { kind: 'ok' };
}

class CallbackConnection implements DatabaseConnection {
  readonly #delegate: DatabaseConnection;
  readonly #lease: { assertActive(): void };
  constructor(delegate: DatabaseConnection, lease: { assertActive(): void }) {
    this.#delegate = delegate;
    this.#lease = lease;
  }
  executeQuery<R>(
    compiled: CompiledQuery,
    options?: AbortableOperationOptions
  ): Promise<QueryResult<R>> {
    this.#assertAllowed(compiled.sql);
    return this.#delegate.executeQuery<R>(compiled, options);
  }

  streamQuery<R>(
    compiled: CompiledQuery,
    chunkSize: number,
    options?: AbortableOperationOptions
  ): AsyncIterableIterator<QueryResult<R>> {
    this.#assertAllowed(compiled.sql);
    return this.#delegate.streamQuery<R>(compiled, chunkSize, options);
  }

  #assertAllowed(sqlText: string): void {
    this.#lease.assertActive();
    const verdict = scanCallbackSql(sqlText);
    if (verdict.kind === 'multi') {
      throw new DatabaseTransactionControlError('DATABASE_TRANSACTION_QUERY_MULTISTATEMENT');
    }
    if (verdict.kind === 'control') {
      throw new DatabaseTransactionControlError('DATABASE_TRANSACTION_CONTROL_STATEMENT_REJECTED');
    }
    if (verdict.kind === 'unsafe') {
      throw new DatabaseTransactionControlError(
        'DATABASE_TRANSACTION_QUERY_UNSAFE'
      );
    }
  }
}

class CallbackLease {
  #active = true;
  assertActive(): void { if (!this.#active) throw new TransactionContextError(); }
  revoke(): void { this.#active = false; }
}

export interface UnitOfWork {
  readonly execute: <T>(
    work: (context: TransactionContext) => T | PromiseLike<T>
  ) => Promise<T>;
}

interface ExecutionMarker {
  active: boolean;
}

const executionMarker = new AsyncLocalStorage<ExecutionMarker>();
const BEGIN = CompiledQuery.raw('begin');
const PRECOMMIT_PROBE = CompiledQuery.raw(
  DATABASE_TRANSACTION_PRECOMMIT_PROBE_SQL
);
const COMMIT = CompiledQuery.raw('commit');
const ROLLBACK = CompiledQuery.raw('rollback');

async function rollback(connection: DatabaseConnection): Promise<boolean> {
  try {
    await connection.executeQuery(ROLLBACK);
    return true;
  } catch {
    return false;
  }
}

async function ensureCommitReady(
  connection: DatabaseConnection
): Promise<void> {
  try {
    await connection.executeQuery(PRECOMMIT_PROBE);
  } catch (error: unknown) {
    if (
      isControlError(
        error,
        'DATABASE_TRANSACTION_PRECOMMIT_ABORTED'
      )
    ) {
      if (await rollback(connection)) {
        throw new UnitOfWorkError(
          'TRANSACTION_ABORTED_BEFORE_COMMIT'
        );
      }
      throw new UnitOfWorkError(
        'TRANSACTION_ABORTED_AND_ROLLBACK_FAILED'
      );
    }
    throw new UnitOfWorkError(
      'TRANSACTION_PRECOMMIT_CONNECTION_FAILED'
    );
  }
}

async function commit(
  connection: DatabaseConnection
): Promise<void> {
  try {
    await connection.executeQuery(COMMIT);
  } catch (error: unknown) {
    if (
      isControlError(
        error,
        'DATABASE_TRANSACTION_COMMIT_OUTCOME_UNKNOWN'
      )
    ) {
      throw new UnitOfWorkError(
        'TRANSACTION_COMMIT_OUTCOME_UNKNOWN'
      );
    }
    if (await rollback(connection)) {
      throw new UnitOfWorkError('TRANSACTION_COMMIT_FAILED');
    }
    throw new UnitOfWorkError(
      'TRANSACTION_COMMIT_AND_ROLLBACK_FAILED'
    );
  }
}

async function executeOnConnection<T>(
  root: Kysely<StageOneDatabase>,
  connection: DatabaseConnection,
  work: (context: TransactionContext) => T | PromiseLike<T>
): Promise<T> {
  try {
    await connection.executeQuery(BEGIN);
  } catch {
    throw new UnitOfWorkError('TRANSACTION_BEGIN_FAILED');
  }

  const callbackLease = new CallbackLease();
  const callbackConnection = new CallbackConnection(connection, callbackLease);
  const transactionExecutor = root
    .getExecutor()
    .withConnectionProvider(new SingleConnectionProvider(callbackConnection));
  const lease = createTransactionContext(
    transactionExecutor,
    <R>(
      statement: string,
      parameters: ReadonlyArray<unknown> = []
    ): Promise<QueryResult<R>> =>
      callbackConnection.executeQuery<R>(
        CompiledQuery.raw(statement, [...parameters])
      )
  );
  let result!: T;
  let callbackError: unknown;
  let callbackFailed = false;

  try {
    result = await work(lease.context);
  } catch (error: unknown) {
    callbackFailed = true;
    callbackError = error;
  } finally {
    lease.revoke();
    callbackLease.revoke();
  }

  if (callbackFailed) {
    callbackFailure(callbackError, await rollback(connection));
  }

  await ensureCommitReady(connection);
  await commit(connection);
  return result;
}

export function createUnitOfWork(
  database: Kysely<StageOneDatabase>
): UnitOfWork {
  async function executeRoot<T>(
    work: (context: TransactionContext) => T | PromiseLike<T>
  ): Promise<T> {
    let acquired = false;
    try {
      return await database.getExecutor().provideConnection(
        async (connection) => {
          acquired = true;
          return executeOnConnection(database, connection, work);
        }
      );
    } catch (error: unknown) {
      if (!acquired) {
        throw new UnitOfWorkError('TRANSACTION_ACQUIRE_FAILED');
      }
      if (isSafeCallbackError(error)) throw error;
      if (
        error instanceof DatabaseConnectionReleaseError &&
        Object.isFrozen(error) &&
        error.code ===
          'DATABASE_CONNECTION_RELEASE_FAILED_AFTER_COMMIT'
      ) {
        throw new UnitOfWorkError(
          'TRANSACTION_COMMITTED_WITH_RELEASE_FAILURE'
        );
      }
      throw new UnitOfWorkError('TRANSACTION_INTERNAL_FAILED');
    }
  }

  function execute<T>(
    work: (context: TransactionContext) => T | PromiseLike<T>
  ): Promise<T> {
    if (executionMarker.getStore()?.active === true) {
      return Promise.reject(new UnitOfWorkError('NESTED_UNIT_OF_WORK'));
    }
    const marker: ExecutionMarker = { active: true };
    return executionMarker.run(marker, async () => {
      try {
        return await executeRoot(work);
      } finally {
        marker.active = false;
      }
    });
  }

  return Object.freeze({ execute });
}
