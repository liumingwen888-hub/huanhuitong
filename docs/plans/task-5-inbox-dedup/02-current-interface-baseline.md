# 当前磁盘接口基线

[返回索引](00-index.md)

## Task 2：InboxDigestKeyring

权威源码：`packages/config/src/inbox-digest-keyring.ts`。

```ts
export type InboxDigestKeyVersion = `v${number}`;
export interface InboxDigestKey {
  readonly version: InboxDigestKeyVersion;
  readonly status: 'current' | 'retained';
  readonly activatedAt: string;
  readonly retainedAt: string | undefined;
  readonly retireNotBefore: string | undefined;
  withMaterial<T>(consumer: (material: Uint8Array) => T): T;
  toJSON(): never;
}
export interface InboxDigestKeyring {
  readonly current: InboxDigestKey;
  readonly retained: readonly InboxDigestKey[];
  dispose(): void;
  toJSON(): never;
}
```

真实约束：`withMaterial` 是同步泛型回调；每次借用独立 Buffer，`finally` 清零；回调不得返回 Promise、material 或引用它的对象。keyring 每项 32–64 bytes；current 唯一且最高版本；retained 已按版本降序；dispose 后稳定抛 `KEYRING_DISPOSED`。Task 5 必须在同步回调内完成 `createHmac(...).update(...).digest(...)`。

## Task 3：inbox_messages

权威 migration：`database/migrations/V1__stage_1_identity_reliability.sql`；Kysely 类型：`packages/contracts/src/database.ts`。

| 列 | 当前合同 |
|---|---|
| `inbox_id` | UUID，数据库生成，主键 |
| `consumer` | text，1–100，immutable |
| `external_message_id` | text，1–255，immutable |
| `payload_digest` | text，`^hmac-sha256:[A-Za-z0-9_-]{43}$`，immutable |
| `digest_key_version` | text，`^v[1-9][0-9]{0,8}$`，immutable |
| `correlation_id` | UUID，immutable |
| `status` | RECEIVED/CLAIMED/PROCESSED/CONFLICT/FAILED |
| `received_at` | timestamptz，immutable |
| `claimed_by` | nullable text |
| `claim_generation` | integer，默认 0，非负 |
| `claimed_until` | nullable timestamptz |
| `processed_at` | nullable timestamptz |
| `failure_code` | nullable text |

唯一约束为 `uq_inbox_consumer_external (consumer, external_message_id)`。`ck_inbox_state` 要求 RECEIVED 无 claim/processed/failure；CLAIMED 必须有 claimant/expiry 且无 processed/failure；PROCESSED 必须有 processed_at 且无 failure；CONFLICT/FAILED 必须无 processed 且有 failure。

Task 5 不修改 migration。`payload_digest`、`digest_key_version`、`correlation_id`、`received_at` 在 Kysely 中不可更新，恰好形成“冲突不得覆盖原摘要/版本”的类型与数据库双门禁。

## Task 4：TransactionContext 与 UnitOfWork

权威源码：`apps/platform/src/infrastructure/database/transaction-context.ts` 与 `unit-of-work.ts`。

```ts
export type TransactionDatabase = QueryCreator<StageOneDatabase>;
export interface TransactionContext {
  readonly database: TransactionDatabase;
  readonly executeSql: <R>(
    statement: string,
    parameters?: ReadonlyArray<unknown>
  ) => Promise<QueryResult<R>>;
}
export interface UnitOfWork {
  readonly execute: <T>(
    work: (context: TransactionContext) => T | PromiseLike<T>
  ) => Promise<T>;
}
```

真实约束：同一 UoW 只使用一个已强制角色的 PostgreSQL connection；嵌套 UoW 被拒绝；callback settle 后 context 先 revoke；pre-commit、commit、rollback、release 和 UNKNOWN 有稳定脱敏错误。Task 5 repository 只接收 `TransactionContext`，不得持有 root Kysely、pool、client 或自行调用 `createUnitOfWork`。

## Task 3 测试 fixture

`@xht/testing` 已导出 `startPostgresFixture`、`migrateAndValidate`、`PostgresFixture`；现有测试用锁定 PostgreSQL 18.4、Flyway 12.11.0、Testcontainers 12.0.4、`RoleEnforcingPostgresPool` 与真实 `Kysely<StageOneDatabase>`。Task 5 database spec 复用这些接口并负责 database destroy、fixture stop、容器/网络残留核验；不得创建第二套 fixture。

## 旧阶段片段的不可复制点

1. 旧示例 `correlationId: 'corr-inbox-9001'` 不满足真实 UUID 列，v1.3 使用 UUID 合同。
2. 旧示例把 canonical bytes 作为公开输入，会让 bytes 逃逸；v1.3 接收完整 parsed Update 并在 digest 函数内部创建/清零 bytes。
3. 旧示例普通字符串等号比较摘要；v1.3 用定长字节与 `timingSafeEqual`，并清零比较 Buffer。
4. 旧示例 conflict 更新行状态的占位函数可能破坏正在处理或已处理原记录；v1.3 conflict 为非变异返回，原摘要、版本、状态、claim 和 processed 证据均不变。
5. 旧示例没有 SELECT FOR UPDATE、过期重领与 CAS；v1.3 以唯一插入、行锁和精确代次条件解决。
6. 旧示例没有利用 Task 4 实际 context revoke/错误分类；v1.3 在 repository 边界先做运行时类型验证，直接调用得到真实 `INBOX_COMMAND_INVALID`，进入 UoW 后依 Task 4 safe-cause 白名单包装且不公开内部 cause。
7. 旧示例让 receivedAt/processedAt 决定 lease 权限；v1.3 仅用 PostgreSQL `clock_timestamp()` 决定 lease、expiry 与 processed_at。

## 直接依赖矩阵

| 未来文件 | 直接依赖 |
|---|---|
| contracts `inbox-digest.ts` | 无 workspace runtime 依赖 |
| contracts `index.ts` | `./inbox-digest.js` |
| `inbox.types.ts` | `@xht/contracts`、Task 4 `TransactionContext` type |
| `telegram-update-digest.ts` | `node:crypto`、`@xht/config`、`@xht/contracts` |
| `inbox.repository.ts` | `node:crypto`、`@xht/contracts`、Kysely type chain、Task 4 context、本 Task types |
| unit spec | Vitest、`@xht/config` types、digest module |
| database spec | Vitest、Kysely/pg、`@xht/testing`、Task 3/4 runtime、本 Task files |

现有 package manifests 已覆盖上述依赖；新依赖数量为 0。

## v1.3 运行时边界补充

- `node:util/types.isProxy` 是 canonicalizer 与 repository 命令解析的前置门禁；任何 prototype、ownKeys、descriptor、array length/index、Date intrinsic 或 context 观察前先拒绝 Proxy。
- `comparisonCandidates` 只从 own data-property descriptors 复制 dense array；accessor、sparse、extra/symbol/non-enumerable index 与 Proxy 均不执行输入代码并稳定失败。
- `receivedAt` 与 `lease.claimedUntil` 只接受 prototype 精确为 `Date.prototype` 且 own key 为 0 的普通 Date；禁止 `instanceof` 后动态调用输入的 `getTime`。时间只由 `Date.prototype.getTime.call(value)` intrinsic 读取，intrinsic 异常、非有限值、Date subclass、自有 accessor/method/property 和 Proxy 均在 context 前转换为 authentic `INBOX_COMMAND_INVALID`。
- PostgreSQL `claimed_until` 不从 `pg@8.22.0/postgres-date@1.0.7` 的毫秒 Date 回传作精确相等 CAS；锁后重领使用同一 CTE 中数据库原始精度的 `clock_timestamp()` 与 `<=`。
