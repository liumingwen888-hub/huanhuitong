import { randomUUID } from 'node:crypto';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  GenericContainer,
  StartupCheckStrategy,
  getContainerRuntimeClient,
  type ContainerRuntimeClient,
  type StartedTestContainer,
  type StartupStatus
} from 'testcontainers';
import { readLockedImage } from './locked-images.js';
import type { PostgresFixture } from './postgres-container.js';

export type FlywayCommand = 'migrate' | 'validate';

export interface FlywaySourcePaths {
  readonly projectRoot: string;
  readonly configFile: string;
  readonly migrationsDirectory: string;
  readonly callbacksDirectory: string;
}

export interface FlywayCommandEvidence {
  readonly command: FlywayCommand;
  readonly exitCode: 0;
  readonly validationSuccessful: boolean | null;
  readonly appliedVersions: readonly string[];
  readonly passwordLeakCount: 0;
}

export type FlywayCleanupErrorCode =
  | 'FLYWAY_CLEANUP_QUERY_FAILED'
  | 'FLYWAY_CLEANUP_OWNER_COLLISION'
  | 'FLYWAY_CLEANUP_OWNER_MISMATCH'
  | 'FLYWAY_CLEANUP_STATE_UNSAFE'
  | 'FLYWAY_CLEANUP_INSPECT_FAILED'
  | 'FLYWAY_CLEANUP_STOP_FAILED'
  | 'FLYWAY_CLEANUP_REMOVE_FAILED';

export class FlywayRunnerError extends Error {
  readonly code:
    | 'FLYWAY_SOURCE_OUTSIDE_PROJECT'
    | 'FLYWAY_SOURCE_SYMLINK'
    | 'FLYWAY_MIGRATE_FAILED'
    | 'FLYWAY_VALIDATE_FAILED'
    | 'FLYWAY_LOG_READ_FAILED'
    | 'FLYWAY_INSPECT_FAILED'
    | 'FLYWAY_SECRET_LEAK'
    | 'FLYWAY_CLEANUP_FAILED';
  readonly cleanupEvidence: readonly FlywayCleanupErrorCode[];

  constructor(
    code: FlywayRunnerError['code'],
    cleanupEvidence: readonly FlywayCleanupErrorCode[] = []
  ) {
    super(code);
    this.name = 'FlywayRunnerError';
    this.code = code;
    this.cleanupEvidence = Object.freeze([...cleanupEvidence]);
  }
}

const FLYWAY_OWNER_LABEL = 'com.xht.task3.flyway-owner' as const;
const CLEANABLE_CONTAINER_STATES = new Set([
  'created',
  'running',
  'exited',
  'stopped'
]);
export const MAX_LOG_BYTES = 1_048_576;
export const MAX_RAW_LOG_BYTES = 1_081_344;
export const MAX_LOG_FRAMES = 4_096;
export const LOG_REQUEST_TIMEOUT_MILLIS = 5_000;
export const LOG_READ_TIMEOUT_MILLIS = 5_000;
const STARTUP_TIMEOUT_MILLIS = 120_000;
const STOP_TIMEOUT_MILLIS = 10_000;

interface ResolvedFlywaySources {
  readonly configFile: string;
  readonly migrationsDirectory: string;
  readonly callbacksDirectory: string;
}

type RuntimeContainer = ReturnType<
  ContainerRuntimeClient['container']['getById']
>;

interface ParsedDockerLogs {
  readonly stdout: string;
  readonly stderr: string;
  readonly frameOrder: string;
}

interface DestroyableReadable extends NodeJS.ReadableStream {
  readonly destroyed?: boolean;
  destroy?(): void;
}

class DockerMultiplexParser {
  #pending = Buffer.alloc(0);
  readonly #stdoutChunks: Buffer[] = [];
  readonly #stderrChunks: Buffer[] = [];
  readonly #frameOrderChunks: Buffer[] = [];
  #rawByteCount = 0;
  #payloadByteCount = 0;
  #frameCount = 0;
  #finished = false;

  push(chunk: Buffer): void {
    if (
      this.#finished ||
      chunk.byteLength > MAX_RAW_LOG_BYTES - this.#rawByteCount
    ) {
      throw new FlywayRunnerError('FLYWAY_LOG_READ_FAILED');
    }
    this.#rawByteCount += chunk.byteLength;
    if (chunk.byteLength > 0) {
      this.#pending = Buffer.concat([this.#pending, chunk]);
    }
    this.#consumeFrames();
  }

  finish(): ParsedDockerLogs {
    if (this.#finished || this.#pending.byteLength !== 0) {
      throw new FlywayRunnerError('FLYWAY_LOG_READ_FAILED');
    }
    this.#finished = true;
    return {
      stdout: Buffer.concat(this.#stdoutChunks).toString('utf8'),
      stderr: Buffer.concat(this.#stderrChunks).toString('utf8'),
      frameOrder: Buffer.concat(this.#frameOrderChunks).toString('utf8')
    };
  }

  #consumeFrames(): void {
    while (this.#pending.byteLength >= 8) {
      const streamType = this.#pending.readUInt8(0);
      const reservedBytesAreZero =
        this.#pending.readUInt8(1) === 0 &&
        this.#pending.readUInt8(2) === 0 &&
        this.#pending.readUInt8(3) === 0;
      if (
        (streamType !== 1 && streamType !== 2) ||
        !reservedBytesAreZero
      ) {
        throw new FlywayRunnerError('FLYWAY_LOG_READ_FAILED');
      }

      const payloadLength = this.#pending.readUInt32BE(4);
      if (payloadLength > MAX_LOG_BYTES - this.#payloadByteCount) {
        throw new FlywayRunnerError('FLYWAY_LOG_READ_FAILED');
      }
      const frameLength = 8 + payloadLength;
      if (this.#pending.byteLength < frameLength) {
        return;
      }
      if (this.#frameCount >= MAX_LOG_FRAMES) {
        throw new FlywayRunnerError('FLYWAY_LOG_READ_FAILED');
      }

      const payload = Buffer.from(this.#pending.subarray(8, frameLength));
      const remaining = this.#pending.subarray(frameLength);
      this.#pending =
        remaining.byteLength === 0 ? Buffer.alloc(0) : remaining;
      this.#frameCount += 1;
      this.#payloadByteCount += payloadLength;
      this.#frameOrderChunks.push(payload);
      if (streamType === 1) {
        this.#stdoutChunks.push(payload);
      } else {
        this.#stderrChunks.push(payload);
      }
    }
  }
}

function isInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === '' ||
    (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot))
  );
}

async function assertNoSymlinkPath(
  canonicalRoot: string,
  unresolvedCandidate: string
): Promise<void> {
  const pathFromRoot = relative(canonicalRoot, unresolvedCandidate);
  if (
    pathFromRoot.startsWith('..') ||
    isAbsolute(pathFromRoot)
  ) {
    throw new FlywayRunnerError('FLYWAY_SOURCE_OUTSIDE_PROJECT');
  }
  let cursor = canonicalRoot;
  for (const segment of pathFromRoot.split(/[\\/]/u).filter(Boolean)) {
    cursor = resolve(cursor, segment);
    if ((await lstat(cursor)).isSymbolicLink()) {
      throw new FlywayRunnerError('FLYWAY_SOURCE_SYMLINK');
    }
  }
}

async function assertTreeHasNoSymlink(candidate: string): Promise<void> {
  const metadata = await lstat(candidate);
  if (metadata.isSymbolicLink()) {
    throw new FlywayRunnerError('FLYWAY_SOURCE_SYMLINK');
  }
  if (!metadata.isDirectory()) {
    return;
  }
  for (const entry of await readdir(candidate)) {
    await assertTreeHasNoSymlink(resolve(candidate, entry));
  }
}

async function resolveSource(
  canonicalRoot: string,
  source: string,
  expected: 'file' | 'directory'
): Promise<string> {
  const unresolved = resolve(canonicalRoot, source);
  await assertNoSymlinkPath(canonicalRoot, unresolved);
  const canonical = await realpath(unresolved);
  if (!isInside(canonicalRoot, canonical)) {
    throw new FlywayRunnerError('FLYWAY_SOURCE_OUTSIDE_PROJECT');
  }
  await assertTreeHasNoSymlink(unresolved);
  const metadata = await lstat(canonical);
  const validType =
    expected === 'file' ? metadata.isFile() : metadata.isDirectory();
  if (!validType) {
    throw new FlywayRunnerError('FLYWAY_SOURCE_OUTSIDE_PROJECT');
  }
  if (expected === 'directory' && (await readdir(canonical)).length === 0) {
    throw new FlywayRunnerError('FLYWAY_SOURCE_OUTSIDE_PROJECT');
  }
  return canonical;
}

async function resolveFlywaySources(
  sources: FlywaySourcePaths
): Promise<ResolvedFlywaySources> {
  const canonicalRoot = await realpath(sources.projectRoot);
  return {
    configFile: await resolveSource(
      canonicalRoot,
      sources.configFile,
      'file'
    ),
    migrationsDirectory: await resolveSource(
      canonicalRoot,
      sources.migrationsDirectory,
      'directory'
    ),
    callbacksDirectory: await resolveSource(
      canonicalRoot,
      sources.callbacksDirectory,
      'directory'
    )
  };
}

function validDockerTimestamp(value: string): boolean {
  return (
    value !== '' &&
    value !== '0001-01-01T00:00:00Z' &&
    Number.isFinite(Date.parse(value))
  );
}

export class ProcessStoppedWaitStrategy extends StartupCheckStrategy {
  override async checkStartupState(
    dockerClient: Parameters<
      StartupCheckStrategy['checkStartupState']
    >[0],
    containerId: string
  ): Promise<StartupStatus> {
    const info = await dockerClient.getContainer(containerId).inspect();
    if (info.State.Running || info.State.Paused) {
      return 'PENDING';
    }
    return validDockerTimestamp(info.State.StartedAt) &&
      validDockerTimestamp(info.State.FinishedAt)
      ? 'SUCCESS'
      : 'PENDING';
  }
}

function logReadFailure(): FlywayRunnerError {
  return new FlywayRunnerError('FLYWAY_LOG_READ_FAILED');
}

function collectDockerLogs(
  source: Buffer | NodeJS.ReadableStream
): Promise<ParsedDockerLogs> {
  const parser = new DockerMultiplexParser();
  if (Buffer.isBuffer(source)) {
    try {
      parser.push(source);
      return Promise.resolve(parser.finish());
    } catch {
      return Promise.reject(logReadFailure());
    }
  }

  const input = source as DestroyableReadable;
  return new Promise<ParsedDockerLogs>((resolvePromise, rejectPromise) => {
    let settled = false;
    let ended = false;
    let timeout: NodeJS.Timeout | undefined;

    function removeListeners(): void {
      try {
        input.removeListener('data', onData);
        input.removeListener('end', onEnd);
        input.removeListener('error', onError);
        input.removeListener('close', onClose);
      } catch {
        // Listener cleanup is best-effort and never changes the public error.
      }
    }

    function destroyInput(): void {
      if (input.destroyed === true || typeof input.destroy !== 'function') {
        return;
      }
      try {
        input.destroy();
      } catch {
        // Input teardown is best-effort and never changes the public error.
      }
    }

    function settleFailure(destroy: boolean): void {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      removeListeners();
      if (destroy) {
        destroyInput();
      }
      rejectPromise(logReadFailure());
    }

    function onData(chunk: unknown): void {
      if (settled) {
        return;
      }
      try {
        if (Buffer.isBuffer(chunk)) {
          parser.push(chunk);
        } else if (typeof chunk === 'string') {
          parser.push(Buffer.from(chunk, 'utf8'));
        } else {
          throw logReadFailure();
        }
      } catch {
        settleFailure(true);
      }
    }

    function onEnd(): void {
      if (settled) {
        return;
      }
      ended = true;
      try {
        const parsed = parser.finish();
        settled = true;
        if (timeout !== undefined) {
          clearTimeout(timeout);
        }
        removeListeners();
        resolvePromise(parsed);
      } catch {
        settleFailure(false);
      }
    }

    function onError(): void {
      settleFailure(true);
    }

    function onClose(): void {
      if (!ended) {
        settleFailure(false);
      }
    }

    try {
      input.on('data', onData);
      input.once('end', onEnd);
      input.once('error', onError);
      input.once('close', onClose);
      timeout = setTimeout(
        () => settleFailure(true),
        LOG_READ_TIMEOUT_MILLIS
      );
    } catch {
      settleFailure(true);
    }
  });
}

async function readLogs(
  runtime: ContainerRuntimeClient,
  container: StartedTestContainer
): Promise<ParsedDockerLogs> {
  const controller = new AbortController();
  let requestTimeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    requestTimeout = setTimeout(() => {
      try {
        controller.abort();
      } catch {
        // Abort teardown is best-effort and never changes the public error.
      }
      reject(logReadFailure());
    }, LOG_REQUEST_TIMEOUT_MILLIS);
  });

  let requestPromise: Promise<Buffer | NodeJS.ReadableStream>;
  try {
    requestPromise = Promise.resolve(
      runtime.container.dockerode
        .getContainer(container.getId())
        .logs({
          follow: false,
          stdout: true,
          stderr: true,
          tail: -1,
          since: 0,
          abortSignal: controller.signal
        })
    ).then(
      (source) => source,
      () => {
        throw logReadFailure();
      }
    );
  } catch {
    if (requestTimeout !== undefined) {
      clearTimeout(requestTimeout);
    }
    throw logReadFailure();
  }

  let source: Buffer | NodeJS.ReadableStream;
  try {
    source = await Promise.race([requestPromise, timeoutPromise]);
  } catch {
    throw logReadFailure();
  } finally {
    if (requestTimeout !== undefined) {
      clearTimeout(requestTimeout);
    }
  }
  return collectDockerLogs(source);
}

async function inspectExitCode(
  runtime: ContainerRuntimeClient,
  started: StartedTestContainer
): Promise<number> {
  try {
    const container = runtime.container.getById(started.getId());
    const inspected = await runtime.container.inspect(container);
    if (
      inspected.State.Running ||
      !Number.isSafeInteger(inspected.State.ExitCode) ||
      inspected.State.ExitCode < 0
    ) {
      throw new FlywayRunnerError('FLYWAY_INSPECT_FAILED');
    }
    return inspected.State.ExitCode;
  } catch (error: unknown) {
    if (error instanceof FlywayRunnerError) {
      throw error;
    }
    throw new FlywayRunnerError('FLYWAY_INSPECT_FAILED');
  }
}

async function cleanupOneOwnedContainer(
  runtime: ContainerRuntimeClient,
  container: RuntimeContainer
): Promise<readonly FlywayCleanupErrorCode[]> {
  const errors: FlywayCleanupErrorCode[] = [];
  let state: string | undefined;
  try {
    const inspected = await runtime.container.inspect(container);
    state = inspected.State.Running
      ? 'running'
      : inspected.State.Status.toLowerCase();
  } catch {
    errors.push('FLYWAY_CLEANUP_INSPECT_FAILED');
  }

  if (
    state !== undefined &&
    !CLEANABLE_CONTAINER_STATES.has(state)
  ) {
    errors.push('FLYWAY_CLEANUP_STATE_UNSAFE');
  }

  if (state === 'running' || state === undefined) {
    try {
      await runtime.container.stop(container, {
        timeout: STOP_TIMEOUT_MILLIS
      });
    } catch {
      errors.push('FLYWAY_CLEANUP_STOP_FAILED');
    }
  }

  try {
    await runtime.container.remove(container, { removeVolumes: true });
  } catch {
    errors.push('FLYWAY_CLEANUP_REMOVE_FAILED');
  }
  return errors;
}

async function cleanupStartedContainer(
  runtime: ContainerRuntimeClient,
  started: StartedTestContainer,
  ownerId: string
): Promise<readonly FlywayCleanupErrorCode[]> {
  if (started.getLabels()[FLYWAY_OWNER_LABEL] !== ownerId) {
    return ['FLYWAY_CLEANUP_OWNER_MISMATCH'];
  }
  return cleanupOneOwnedContainer(
    runtime,
    runtime.container.getById(started.getId())
  );
}

async function cleanupByOwnerLabel(
  runtime: ContainerRuntimeClient,
  ownerId: string
): Promise<readonly FlywayCleanupErrorCode[]> {
  let listed: Awaited<
    ReturnType<
      ContainerRuntimeClient['container']['dockerode']['listContainers']
    >
  >;
  try {
    listed = await runtime.container.dockerode.listContainers({
      all: true,
      filters: {
        label: [`${FLYWAY_OWNER_LABEL}=${ownerId}`]
      }
    });
  } catch {
    return ['FLYWAY_CLEANUP_QUERY_FAILED'];
  }

  const exactOwner = listed.filter(
    (item) => item.Labels[FLYWAY_OWNER_LABEL] === ownerId
  );
  const errors: FlywayCleanupErrorCode[] = [];
  if (exactOwner.length > 1) {
    errors.push('FLYWAY_CLEANUP_OWNER_COLLISION');
  }
  for (const item of exactOwner) {
    if (!CLEANABLE_CONTAINER_STATES.has(item.State.toLowerCase())) {
      errors.push('FLYWAY_CLEANUP_STATE_UNSAFE');
      continue;
    }
    errors.push(
      ...(await cleanupOneOwnedContainer(
        runtime,
        runtime.container.getById(item.Id)
      ))
    );
  }
  return errors;
}

function normalizePrimaryError(
  command: FlywayCommand,
  error: unknown
): FlywayRunnerError {
  if (error instanceof FlywayRunnerError) {
    return error;
  }
  return new FlywayRunnerError(
    command === 'migrate'
      ? 'FLYWAY_MIGRATE_FAILED'
      : 'FLYWAY_VALIDATE_FAILED'
  );
}

export async function runFlywayCommand(
  fixture: PostgresFixture,
  command: FlywayCommand,
  sources: FlywaySourcePaths
): Promise<FlywayCommandEvidence> {
  const ownerId = `xht-task3-flyway-${randomUUID()}`;
  let runtime: ContainerRuntimeClient | undefined;
  let started: StartedTestContainer | undefined;
  let evidence: FlywayCommandEvidence | undefined;
  let primaryError: FlywayRunnerError | undefined;
  let cleanupEvidence: readonly FlywayCleanupErrorCode[] = [];

  try {
    const resolved = await resolveFlywaySources(sources);
    runtime = await getContainerRuntimeClient();
    const locked = readLockedImage('flyway');
    const flywayContainer = new GenericContainer(
      locked.immutableReference
    )
      .withPlatform(locked.platform)
      .withNetwork(fixture.network)
      .withLabels({ [FLYWAY_OWNER_LABEL]: ownerId })
      .withAutoCleanup(false)
      .withAutoRemove(false)
      .withWaitStrategy(new ProcessStoppedWaitStrategy())
      .withStartupTimeout(STARTUP_TIMEOUT_MILLIS)
      .withEnvironment({
        FLYWAY_URL: fixture.flywayEnvironment.FLYWAY_URL,
        FLYWAY_USER: fixture.flywayEnvironment.FLYWAY_USER,
        FLYWAY_PASSWORD: fixture.flywayEnvironment.FLYWAY_PASSWORD,
        REDGATE_DISABLE_TELEMETRY: 'true'
      })
      .withCopyFilesToContainer([
        {
          source: resolved.configFile,
          target: '/flyway/conf/flyway.toml',
          mode: 0o444
        }
      ])
      .withCopyDirectoriesToContainer([
        {
          source: resolved.migrationsDirectory,
          target: '/flyway/sql',
          mode: 0o555
        },
        {
          source: resolved.callbacksDirectory,
          target: '/flyway/callbacks',
          mode: 0o555
        }
      ])
      .withCommand([
        '-configFiles=/flyway/conf/flyway.toml',
        command
      ]);

    started = await flywayContainer.start();
    const logs = await readLogs(runtime, started);
    if (
      [
        logs.stdout,
        logs.stderr,
        logs.frameOrder
      ].some((value) =>
        value.includes(fixture.flywayEnvironment.FLYWAY_PASSWORD)
      )
    ) {
      throw new FlywayRunnerError('FLYWAY_SECRET_LEAK');
    }
    const exitCode = await inspectExitCode(runtime, started);
    if (exitCode !== 0) {
      throw new FlywayRunnerError(
        command === 'migrate'
          ? 'FLYWAY_MIGRATE_FAILED'
          : 'FLYWAY_VALIDATE_FAILED'
      );
    }
    const migrations = await fixture.appliedMigrations();
    evidence = {
      command,
      exitCode: 0,
      validationSuccessful: command === 'validate' ? true : null,
      appliedVersions: migrations
        .filter((migration) => migration.success)
        .map((migration) => migration.version),
      passwordLeakCount: 0
    };
  } catch (error: unknown) {
    primaryError = normalizePrimaryError(command, error);
  } finally {
    if (runtime !== undefined) {
      cleanupEvidence =
        started === undefined
          ? await cleanupByOwnerLabel(runtime, ownerId)
          : await cleanupStartedContainer(runtime, started, ownerId);
    }
  }

  if (primaryError !== undefined) {
    throw new FlywayRunnerError(
      primaryError.code,
      cleanupEvidence
    );
  }
  if (cleanupEvidence.length > 0) {
    throw new FlywayRunnerError(
      'FLYWAY_CLEANUP_FAILED',
      cleanupEvidence
    );
  }
  if (evidence === undefined) {
    throw new FlywayRunnerError(
      command === 'migrate'
        ? 'FLYWAY_MIGRATE_FAILED'
        : 'FLYWAY_VALIDATE_FAILED'
    );
  }
  return evidence;
}

export async function migrateAndValidate(
  fixture: PostgresFixture,
  sources: FlywaySourcePaths
): Promise<{
  readonly firstMigrate: FlywayCommandEvidence;
  readonly secondMigrate: FlywayCommandEvidence;
  readonly validate: FlywayCommandEvidence;
}> {
  return {
    firstMigrate: await runFlywayCommand(
      fixture,
      'migrate',
      sources
    ),
    secondMigrate: await runFlywayCommand(
      fixture,
      'migrate',
      sources
    ),
    validate: await runFlywayCommand(
      fixture,
      'validate',
      sources
    )
  };
}
