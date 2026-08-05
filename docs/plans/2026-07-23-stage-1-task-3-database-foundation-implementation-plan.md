# 阶段 1 Task 3 PostgreSQL、Kysely、Flyway 和 Testcontainers 基础 Implementation Plan

> **Execution record:** 用户已在第 6/48 步授权并完成本计划实施；外部复审 PASS，T3R-13 修订复审通过并关闭。本文件现为 VERIFIED v1.5 的计划与实施权威。

计划版本：`v1.5`。原计划日期：`2026-07-23`；实施完成及最终复审日期：`2026-07-25`。计划状态：`VERIFIED v1.5`。Task 3 代码与测试状态：`VERIFIED v1.5`。未解决阻断：`0`。

实施授权记录：`2026-07-25` 正式进入第 `6/48` 步。允许精确工程写集合 19（Create 16、Modify 3、Delete 0），允许核验并拉取本计划锁定的官方镜像，允许本地 Docker、PostgreSQL、Flyway 与 Testcontainers 验证。Git 写入、worktree、子代理、并行代理、Telegram、其他业务外部服务、生产部署和 Tasks 4–14 实施授权均为 0。完成 Task 3 实施与验证后必须停止等待用户复审，不得进入第 7/48 步。

T3R-13 外部复审记录：`ACCEPT`。复审确认 `docs/governance/ai-handoff.md`、`docs/governance/state-model.md` 与阶段 1 总计划中的三个当前状态摘要遗漏了第 6 步实施结果；根因是实施终态文档同步不完整，而非历史第 5 步记录错误。7 份 Markdown 修订已复审通过，T3R-13 正式关闭。第 6 步最终复审结论为 `PASS`，Task 3 详细计划、代码与测试转为 `VERIFIED v1.5`；既有 build、typecheck、unit 132/132、database unit 24/24 与真实 database 65/65 证据本轮 `NOT_RERUN`。第 6 步临时工程、镜像、Docker 和数据库授权保持已消费并归零。

**Goal:** 建立 PostgreSQL 18.4 最小身份与可靠性 schema、最小权限角色、Kysely 角色绑定连接工厂，以及用真实 PostgreSQL/Flyway 容器验证迁移和权限的可执行基础。

**Architecture:** PostgreSQL 是身份与可靠性状态的唯一事实源。bootstrap LOGIN 只创建数据库级安全边界、三个 NOLOGIN 权限角色和隔离测试 LOGIN；Flyway、platform、worker 各用独立 LOGIN 连接，并在每条实际工作连接上切换到唯一 NOLOGIN 角色。Flyway 使用固定镜像 child digest、TOML 配置、JDBC connection-level `role=xht_flyway` 和保留的 `afterConnect.sql` 二次证明；Testcontainers 把迁移、回调和配置复制进容器，不使用宿主 bind mount。

**Tech Stack:** Node.js `24.18.0`、pnpm `11.15.1`、TypeScript `7.0.2` strict、PostgreSQL `18.4-alpine3.23`、Kysely `0.29.4`、`pg` `8.22.0`、Flyway Open Source `12.11.0-alpine`、Testcontainers for Node.js `12.0.4`、Vitest `4.1.10`。

## 1. 授权、前置条件与状态

### 1.1 前置条件

- 阶段 0 为 `VERIFIED`。
- 阶段 1 总计划为 `READY v1.2.6`，阶段 1 代码为 `BUILDING`。
- Task 1 与 Task 2 均为 `VERIFIED`。
- 实施前 Task 3 代码为 `NOT_STARTED`；本次已完成并收敛为 `READY v1.5`。Tasks 4–14 仍为 `NOT_STARTED`。
- 根 `package.json`、`pnpm-lock.yaml` 已包含本计划使用的 Kysely、pg、Testcontainers 和 Vitest 精确版本；本 Task 不增加、删除或升级依赖。
- 执行前必须重新确认两个镜像 tag 仍解析到本计划记录的 manifest-list digest，且 linux/amd64 child digest 仍唯一匹配。
- 执行前必须取得 Task 3 工程写入、镜像读取、容器启动和隔离测试数据库的明确授权。

### 1.2 本计划不授权的行为

- 本文件 `READY` 不授权创建 `database/` 或任何工程文件。
- 不授权 Git、worktree、子代理、并行代理、Telegram、collector、其他业务外部连接或生产部署。
- 不授权真实数据库、共享开发数据库、预发布数据库或生产数据库迁移。
- 不授权修改 Task 1/2 源码与测试，不授权实施 Task 4–14。
- 不授权支付密码、TOTP、恢复、资金、余额、账本、钱包、地址、链、交易对或 market 能力。

### 1.3 准确目标

1. 空 PostgreSQL 18.4 数据库可执行一次 V1 迁移。
2. 第二次 `migrate` 不重复应用版本，`validate` 成功。
3. 修改已应用迁移的隔离副本后，`validate` 因 checksum 漂移失败。
4. bootstrap、Flyway、platform、worker 的 LOGIN/NOLOGIN 边界和允许/拒绝权限由真实连接证明。
5. platform/worker 通过 `RoleEnforcingPostgresPool.connect()` 在把真实 `PoolClient` 交给 Kysely 之前验证 `session_user`、执行固定 `SET ROLE` 并验证 `current_user`；取得 client 后的任一失败都恰好调用一次 `client.release(true)`，禁止用会抛错的 `onReserveConnection` 承担该门禁。
6. Inbox 只保存内容的 `payload_digest` 与 `digest_key_version`，不持久化任何原始 Telegram 数据。
7. schema 只包含阶段 1 身份、Inbox、Outbox、持久任务和最小追加式审计对象。
8. 每项资源只有一个 owner：两个 app handle 由 permissions spec 逆序关闭，Flyway one-shot 容器由 `runFlywayCommand` 以每次唯一 label 在 `finally` 清理，checksum/copy TEMP 由 migrations spec 清理，fixture 只清理其拥有的 role bootstrap/bootstrap pool、PostgreSQL 容器和 network；Flyway 未返回 started handle 时仍必须按本次 label 回收。

### 1.4 非目标

- 不实现 Unit of Work、仓储、Inbox claim、Outbox worker、身份用例、Telegram Webhook 或进程启动接线。
- 不创建业务数据，不连接真实外部服务，不执行生产迁移。
- 不创建资产、资金、余额、账本、钱包、地址、网络、链、交易对或市场对象。
- 不使用 SQLite、内存数据库、mock SQL engine 或静态对象替代 PostgreSQL 集成测试。

### 1.5 v1.2 外部复审裁决

| 编号 | 裁决 | v1.2 闭环位置 |
|---|---|---|
| T3R-01 | ACCEPT | 第 5.2、12、13、17 节：pre-return pool wrapper、五类 destroy-release、U01–U09 |
| T3R-02 | ACCEPT | 第 5.5、5.6、10.3、15 节：fixture/runner/spec/TEMP 唯一 owner |
| T3R-03 | ACCEPT | 第 10.1、14、17 节：两个 container path 显式平台 2/2 |
| T3R-04 | ACCEPT | 第 5.5、7、11、14 节：`REDGATE_DISABLE_TELEMETRY: 'true'` 与官方来源 |
| T3R-05 | ACCEPT | 第 5.2、13、17 节：deferred close、`DATABASE_CLOSE_FAILED`、U10–U12 |
| T3R-06 | ACCEPT | 第 5.2、13、17 节：wrapper 自身错误净化、`ManagedDatabase`、U12 |
| T3R-07 | ACCEPT | 第 5.6、7、10、14、17 节：停止即成功 wait、真实 ExitCode、唯一 owner label 与无 handle 回收 |

七项均有本地源码、可执行代码块或官方资料支持，不接受的范围为 0；裁决只修订计划，不表示 Task 3 已实施。T3R-06 修订前同步/异步 `end()` 复现均为 `calls=1`、cached Promise 同一，但 `code=null` 且 `synthetic-secret` 在 message/stack 等公开表面命中 3。T3R-07 修订前复现为 `nonZeroStartRejected=true`、`startedHandleAvailable=false`、调用方 finally stop 0；Testcontainers 12.0.4 源码确认 `StartedGenericContainer` 只在 wait 成功后构造。

### 1.6 v1.3 外部复审裁决

| 编号 | 裁决 | 修订前独立复现 | v1.3 闭环位置 |
|---|---|---|---|
| T3R-08 | ACCEPT | TypeScript 7.0.2 strict 下，直接 `db.destroy()` 被 `Omit` 隐藏，但 `withPlugin`、`withoutPlugins`、`withSchema`、`$extendTables`、`$omitTables`、`$pickTables`、`withTables`、`connection().execute()` 和 `Symbol.asyncDispose` 九条路径仍全部取得关闭能力；Kysely 0.29.4 的 29 个公开运行时成员扫描未发现这九条之外的 driver 关闭入口 | 第 5.2、12、13、17、18 节：真实 `QueryCreator` runtime facade、全逃逸负向测试、U12 |
| T3R-09 | ACCEPT | 对 Testcontainers 12.0.4 真实 `DockerContainerClient` 注入 raw dockerode `logs()` rejection：raw 调用 reject，但公开 wrapper resolve 后正常结束，字节 0、stream error 为 null | 第 5.6、10、11、14、17、18 节：raw Dockerode logs、multiplex demux、失败关闭、M15/M16 |
| T3R-10 | ACCEPT | v1.1 ZIP local/central UTF-8 flag 均为 105/105；v1.2 均为 0/105，local/central 共 210 个 General Purpose Flag 精确为 `0x0000`，原始名称字节虽可严格 UTF-8 解码但兼容工具无标志依据 | 本次 v1.3 计划修订交付门禁：105 个 local header 与 105 个 central header 均设置 `0x0800`，严格解码、兼容解压和逐文件哈希同时验证 |

三项均有精确本地版本的运行或二进制证据支持，不接受范围为 0。上述 TEMP 复现不连接 Docker、不启动容器、不实施 Task 3；T3R-10 只修复本次计划快照的交付兼容性，不把 ZIP 包装逻辑写入未来 Task 3 工程映射。

### 1.7 v1.4 外部复审裁决

T3R-11 已在系统 TEMP、无 Docker/数据库/网络条件下独立复现并裁决 `ACCEPT`：4-byte incomplete header 与声明 5 bytes/实际 2 bytes 的 incomplete payload 均被 v1.3 误报为成功空日志；只触发 `close` 的 readable 在 500ms 后仍未 settled；`stdout: synthetic-`、`stderr: noise`、`stdout: password` 被全局事件顺序聚合成 `synthetic-noisepassword`，对 `synthetic-password` 的检测为 false。

精确 `docker-modem@5.0.7` 源码确认 `demuxStream()` 只注册 `data` listener；pending header、pending payload 和内部 residual Buffer 在 EOF 时既不校验也不暴露。v1.3 又只在 input `end` 时直接结束 stdout/stderr，未处理 close-before-end，并把两个通道按全局 data 事件顺序写入同一 chunks 数组。v1.4 因此用本计划内严格、有界 Docker multiplex frame parser 作为日志完整性的唯一解析依据，不再依赖 `docker-modem.demuxStream()` 判断完整性；M15/M16 在不新增 M 编号的前提下覆盖第 14 节列出的 24 个精确子场景。

### 1.8 v1.5 外部复审裁决

T3R-12 已在系统 TEMP、无 Docker/数据库/网络条件下对 v1.4 最终 `readLogs()` 逐字复现并裁决 `ACCEPT`：fake `container.logs()` 返回永久 pending Promise，400ms 后 `readLogs()` 仍为 `TIMEOUT`；传入 options 不含 `abortSignal`；外层模拟 `runFlywayCommand` 的 `cleanupCalls=0`；`collectDockerLogs()` 未进入，因此 `LOG_READ_TIMEOUT_MILLIS` 的 stream 计时器尚未启动。永久 pending 的 raw request 会阻止 runner `finally` 与 started owner container 清理。

精确本地版本源码确认：Dockerode `5.0.1` 的 `Container.logs()` 把 `args.opts.abortSignal` 放入 modem options；docker-modem `5.0.7` 的 `dial()` 把该值设置为底层 Node 请求 `signal`，并对非 stream response 加入 abort signal；`@types/dockerode@4.0.1` 的 `ContainerLogsOptions` 公开 `abortSignal?: AbortSignal`；Testcontainers `12.0.4` 的公开 logs wrapper 仍会吞 raw rejection，但本 runner 已直接使用 raw Dockerode。v1.4 没有传 `abortSignal`，且只在 raw request 返回 Buffer/stream 后启动 stream timeout，所以 request 阶段不受任何现有限制保护。

v1.5 只在 `readLogs()` 的 raw request 边界增加独立 `LOG_REQUEST_TIMEOUT_MILLIS=5_000`、`AbortController` 和显式 Promise timeout race；request 成功后仍原样进入 v1.4 strict bounded multiplex parser 与 `LOG_READ_TIMEOUT_MILLIS=5_000` stream 门禁。即使 fake request 忽略 abort 且永不 settle，外层 request race 也必须稳定拒绝为 `FLYWAY_LOG_READ_FAILED` 并进入 runner `finally`；late resolve/reject 必须已被观察且不得形成 unhandled rejection。T3R-11、QueryCreator facade、wrapper close、角色门禁、owner label、ExitCode inspect、telemetry 与 19 路径工程映射不作无关重构。

### 1.9 第 6/48 步实施裁决与结果

- 19 个工程路径已精确实施：Create 16、Modify 3、Delete 0；项目源 105 → 121，额外 Task 3 工程文件 0。根 package/lock 哈希无漂移，依赖变更 0。
- 首轮真实 Flyway 日志证明 `afterConnect.sql` 虽成功执行，但 Flyway 12.11.0 随后使用另一条仍处于 LOGIN 身份的 housekeeping 连接创建 history 表并收到 `42501`。同一隔离 fixture 在 JDBC URL 使用 `options=-c role=xht_flyway` 后 migrate exit 0。
- 最终实现把角色切换施加于每条 JDBC 连接建立边界，并继续执行本计划 `afterConnect.sql` 作为二次证明。测试 LOGIN 仍只有 CONNECT 与 SET-only 成员资格，没有直接 schema/table/history 权限；history 和九张业务表的 owner 均为 `xht_flyway`，因此该修正实现而未放宽原权限目标。
- 最终 `pnpm build`、`pnpm typecheck`、unit 132/132、Task 3 database unit 24/24、真实 database 65/65 通过；M01–M17、P01–P23 与 scenario 01–24 均可定位。Task 3 容器、network 和 TEMP 残留 0。

## 2. 已实施写入的不可变镜像值

以下值已在 `2026-07-23` 通过 Docker Hub 官方 tag API 与 Docker Registry V2 manifest 请求交叉核验。manifest-list digest 只记录 tag 的多平台索引；实际 linux/amd64 执行引用必须使用 child digest。

| 用途 | 官方仓库与精确 tag | manifest-list digest | linux/amd64 child digest | 实施引用 |
|---|---|---|---|---|
| PostgreSQL | `postgres:18.4-alpine3.23` | `sha256:996d0920e4ff9df1fc19dacb904492f3c1ec0ec1cc338f0ad7123be7731c5f5e` | `sha256:2342268e5cf8851c327dcf10fc124283448428059f9b756692b7e3302940d769` | `postgres:18.4-alpine3.23@sha256:2342268e5cf8851c327dcf10fc124283448428059f9b756692b7e3302940d769` |
| Flyway Open Source | `flyway/flyway:12.11.0-alpine` | `sha256:6bf3a713f52c4d803a88501f8409dda2191e9ccba1454358a6de2c4cc65f71b0` | `sha256:bd93084ddaf1448d2598feaac75a1c2e7087c529566746724f65b05b481f9704` | `flyway/flyway:12.11.0-alpine@sha256:bd93084ddaf1448d2598feaac75a1c2e7087c529566746724f65b05b481f9704` |

Flyway 当前有两个官方产品仓库：`redgate/flyway` 对应 Redgate editions，`flyway/flyway` 对应 Open Source。阶段 1 只需要纯 SQL `migrate`/`validate`，因此本计划明确选择官方 Open Source 仓库 `flyway/flyway`。

第 6/48 步已按授权修改 `toolchain-lock.json`：

```json
{
  "images": {
    "postgres": {
      "reference": "postgres:18.4-alpine3.23",
      "platform": "linux/amd64",
      "manifestListDigest": "sha256:996d0920e4ff9df1fc19dacb904492f3c1ec0ec1cc338f0ad7123be7731c5f5e",
      "digest": "sha256:2342268e5cf8851c327dcf10fc124283448428059f9b756692b7e3302940d769",
      "status": "VERIFIED"
    },
    "flyway": {
      "repository": "flyway/flyway",
      "reference": "flyway/flyway:12.11.0-alpine",
      "platform": "linux/amd64",
      "manifestListDigest": "sha256:6bf3a713f52c4d803a88501f8409dda2191e9ccba1454358a6de2c4cc65f71b0",
      "digest": "sha256:bd93084ddaf1448d2598feaac75a1c2e7087c529566746724f65b05b481f9704",
      "status": "VERIFIED"
    }
  }
}
```

## 3. 精确 Planned File Map

实施时工程写集合固定为 19 个路径：Create 16、Modify 3、Delete 0。

| # | 动作 | 精确路径 | 单一职责 |
|---:|---|---|---|
| 1 | Create | `database/bootstrap/roles.sql` | 创建并收敛三个 NOLOGIN 权限角色 |
| 2 | Create | `database/bootstrap/database.sql` | 撤销 PUBLIC 默认能力、设置 public schema owner 与数据库级边界 |
| 3 | Create | `database/flyway.toml` | 固定 locations、callbackLocations、命名校验、禁止 clean |
| 4 | Create | `database/flyway-callbacks/afterConnect.sql` | 每条 Flyway 连接立即执行 `SET ROLE xht_flyway` |
| 5 | Create | `database/migrations/V1__stage_1_identity_reliability.sql` | 创建阶段 1 九张业务表、索引、约束和应用权限 |
| 6 | Create | `packages/contracts/src/database.ts` | 跨 platform/worker 的 Kysely `StageOneDatabase` 类型合同 |
| 7 | Modify | `packages/contracts/src/index.ts` | 只导出数据库类型合同 |
| 8 | Create | `apps/platform/src/infrastructure/database/database.ts` | platform Kysely pool 与 `SET ROLE xht_platform` 门禁 |
| 9 | Create | `apps/worker/src/infrastructure/database/database.ts` | worker Kysely pool 与 `SET ROLE xht_worker` 门禁 |
| 10 | Create/Test | `apps/platform/test/unit/database.spec.ts` | platform U01–U12：角色门禁、失败销毁和关闭粘滞 |
| 11 | Create/Test | `apps/worker/test/unit/database.spec.ts` | worker U01–U12：角色门禁、失败销毁和关闭粘滞 |
| 12 | Create | `packages/testing/src/locked-images.ts` | 读取并验证精确 tag、平台和 child digest |
| 13 | Create | `packages/testing/src/postgres-role-bootstrap.ts` | 参数安全地创建随机测试 LOGIN、成员资格和 CONNECT 权限 |
| 14 | Create | `packages/testing/src/postgres-container.ts` | network、PostgreSQL 容器、随机凭据、fixture 和逆序清理 |
| 15 | Create | `packages/testing/src/flyway-runner.ts` | 复制文件、环境传密、one-shot migrate/validate 与脱敏错误 |
| 16 | Modify | `packages/testing/src/index.ts` | 只导出 Task 3 测试工具合同 |
| 17 | Create/Test | `packages/testing/test/database/migrations.integration.spec.ts` | 空库、重复 migrate、validate、checksum、schema 与禁止列验证 |
| 18 | Create/Test | `packages/testing/test/database/permissions.integration.spec.ts` | LOGIN/NOLOGIN、SET ROLE、允许/拒绝和连接工厂验证 |
| 19 | Modify | `toolchain-lock.json` | 写入已复核的两个 manifest-list 与 child digest |

除以上 19 个路径外，实施期间不允许写入其他工程文件。构建产生的既有 `dist/` 仍是可清理生成物，不计入手写工程写集合。

## 4. 依赖方向

```text
packages/contracts/src/database.ts
        ↑ type-only package export
apps/platform/database.ts      apps/worker/database.ts
        ↑                              ↑
packages/testing integration tests import both app factories

packages/testing/locked-images.ts
        ↑
postgres-container.ts ← postgres-role-bootstrap.ts
        ↑
flyway-runner.ts
        ↑
migrations.integration.spec.ts / permissions.integration.spec.ts
```

- `packages/contracts` 不依赖 Kysely、pg、Testcontainers 或 apps；它只提供与 Kysely `ColumnType` 结构兼容的 TypeScript 类型。
- platform 与 worker 都直接依赖现有 `kysely` 和 `pg`，彼此不导入。
- apps 不依赖 `packages/testing`；只有 database project 测试依赖 app factory。
- bootstrap/Flyway/Testcontainers 仅存在于测试基础设施和 SQL 边界，不进入正常业务进程。

## 5. 完整 TypeScript 合同

### 5.1 数据库类型合同

`packages/contracts/src/database.ts` 定义并导出以下唯一名称：

```ts
export type DatabaseGenerated<T> = {
  readonly __select__: T;
  readonly __insert__: T | undefined;
  readonly __update__: T;
};

export type DatabaseGeneratedImmutable<T> = {
  readonly __select__: T;
  readonly __insert__: T | undefined;
  readonly __update__: never;
};

export type DatabaseImmutable<T, Insert = T> = {
  readonly __select__: T;
  readonly __insert__: Insert;
  readonly __update__: never;
};

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface UsersTable {
  readonly uid: DatabaseGeneratedImmutable<string>;
  readonly status: 'ACTIVE' | 'RESTRICTED' | 'SUSPENDED' | 'CLOSED';
  readonly created_at: DatabaseGeneratedImmutable<Date>;
}

export interface MembershipsTable {
  readonly membership_id: DatabaseGeneratedImmutable<string>;
  readonly uid: DatabaseImmutable<string>;
  readonly status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  readonly created_at: DatabaseGeneratedImmutable<Date>;
}

export interface IdentityProfilesTable {
  readonly uid: DatabaseImmutable<string>;
  readonly username_snapshot: string | null;
  readonly display_name_snapshot: string | null;
  readonly updated_at: DatabaseGenerated<Date>;
}

export interface ChannelBindingsTable {
  readonly binding_id: DatabaseGeneratedImmutable<string>;
  readonly channel_type: DatabaseImmutable<'TELEGRAM'>;
  readonly external_user_id: DatabaseImmutable<string>;
  readonly uid: DatabaseImmutable<string>;
  readonly status: 'PENDING' | 'ACTIVE' | 'REVOKED' | 'CONFLICTED';
  readonly created_at: DatabaseGeneratedImmutable<Date>;
  readonly revoked_at: Date | null;
}

export interface RegistrationIdempotencyTable {
  readonly registration_key: DatabaseImmutable<string>;
  readonly channel_type: DatabaseImmutable<'TELEGRAM'>;
  readonly external_user_id: DatabaseImmutable<string>;
  readonly uid: string | null;
  readonly status: 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CONFLICT';
  readonly created_at: DatabaseGeneratedImmutable<Date>;
  readonly completed_at: Date | null;
  readonly failure_code: string | null;
  readonly failed_at: Date | null;
  readonly conflicted_at: Date | null;
}

export interface InboxMessagesTable {
  readonly inbox_id: DatabaseGeneratedImmutable<string>;
  readonly consumer: DatabaseImmutable<string>;
  readonly external_message_id: DatabaseImmutable<string>;
  readonly payload_digest: DatabaseImmutable<string>;
  readonly digest_key_version: DatabaseImmutable<string>;
  readonly correlation_id: DatabaseImmutable<string>;
  readonly status: 'RECEIVED' | 'CLAIMED' | 'PROCESSED' | 'CONFLICT' | 'FAILED';
  readonly received_at: DatabaseImmutable<Date>;
  readonly claimed_by: string | null;
  readonly claim_generation: DatabaseGenerated<number>;
  readonly claimed_until: Date | null;
  readonly processed_at: Date | null;
  readonly failure_code: string | null;
}

export interface OutboxMessagesTable {
  readonly outbox_id: DatabaseImmutable<string>;
  readonly topic: DatabaseImmutable<string>;
  readonly event_key: DatabaseImmutable<string>;
  readonly version: DatabaseImmutable<1>;
  readonly payload: DatabaseImmutable<JsonValue>;
  readonly correlation_id: DatabaseImmutable<string>;
  readonly status:
    | 'READY'
    | 'LEASED'
    | 'SUCCEEDED'
    | 'RETRY_WAIT'
    | 'DEAD_LETTER'
    | 'PAUSED'
    | 'WAITING_CONFIGURATION';
  readonly attempt_count: DatabaseGenerated<number>;
  readonly available_at: Date;
  readonly locked_by: string | null;
  readonly lock_generation: DatabaseGenerated<number>;
  readonly lease_token: string | null;
  readonly locked_until: Date | null;
  readonly created_at: DatabaseGeneratedImmutable<Date>;
  readonly succeeded_at: Date | null;
}

export interface DurableJobsTable {
  readonly job_id: DatabaseGeneratedImmutable<string>;
  readonly job_type: DatabaseImmutable<string>;
  readonly business_key: DatabaseImmutable<string>;
  readonly payload: DatabaseImmutable<JsonValue>;
  readonly status:
    | 'READY'
    | 'LEASED'
    | 'SUCCEEDED'
    | 'RETRY_WAIT'
    | 'DEAD_LETTER'
    | 'PAUSED'
    | 'WAITING_CONFIGURATION';
  readonly attempt_count: DatabaseGenerated<number>;
  readonly available_at: Date;
  readonly locked_by: string | null;
  readonly lock_generation: DatabaseGenerated<number>;
  readonly lease_token: string | null;
  readonly locked_until: Date | null;
  readonly created_at: DatabaseGeneratedImmutable<Date>;
  readonly succeeded_at: Date | null;
}

export interface AuditEventsTable {
  readonly audit_event_id: DatabaseGeneratedImmutable<string>;
  readonly event_type: DatabaseImmutable<string>;
  readonly actor_type: DatabaseImmutable<string>;
  readonly actor_ref: DatabaseImmutable<string>;
  readonly subject_ref: DatabaseImmutable<string>;
  readonly outcome: DatabaseImmutable<string>;
  readonly correlation_id: DatabaseImmutable<string>;
  readonly occurred_at: DatabaseImmutable<Date>;
}

export interface StageOneDatabase {
  readonly users: UsersTable;
  readonly memberships: MembershipsTable;
  readonly identity_profiles: IdentityProfilesTable;
  readonly channel_bindings: ChannelBindingsTable;
  readonly registration_idempotency: RegistrationIdempotencyTable;
  readonly inbox_messages: InboxMessagesTable;
  readonly outbox_messages: OutboxMessagesTable;
  readonly durable_jobs: DurableJobsTable;
  readonly audit_events: AuditEventsTable;
}
```

### 5.2 platform/worker 连接工厂

#### 5.2.1 复审裁决与 Kysely 0.29.4 边界

T3R-01 `ACCEPT`。本地 `kysely@0.29.4` 的 `PostgresDriver.acquireConnection()` 先等待 `pool.connect()`，再调用 `onReserveConnection`，而 hook 抛错时不会调用取得 client 的正常 release 路径；独立复现为 `connectCalls=1`、`releaseCalls=0`。因此最终实现禁止设置会抛错的 `onReserveConnection`。角色门禁必须前移到实现 Kysely `PostgresPool` 结构的 `RoleEnforcingPostgresPool.connect()`，只有门禁全部成功后才把真实 `pg.PoolClient` 返回给 Kysely。

两个 app 文件保持独立，不互相导入。为避免计划内重复核心定义，本节只声明一次“公共文件主体”；未来实施时，platform/worker 各自把对应的精确文件头、公共文件主体和精确文件尾按顺序写入自己的文件。这里没有占位符或省略实现；跨 app 的源代码重复是为了维持既定依赖方向，计划中的核心定义仍只有一份权威文本。

`apps/platform/src/infrastructure/database/database.ts` 的精确文件头：

```ts
import { createRequire } from 'node:module';
import type { StageOneDatabase } from '@xht/contracts';
import {
  Kysely,
  PostgresDialect,
  QueryCreator,
  sql,
  type PostgresPool,
  type PostgresPoolClient
} from 'kysely';

const require = createRequire(import.meta.url);
const { Pool } = require('pg') as {
  readonly Pool: PostgresPoolConstructor;
};

const DATABASE_BINDING = Object.freeze({
  expectedRole: 'xht_platform',
  setRoleSql: 'SET ROLE xht_platform'
} as const);
```

`apps/worker/src/infrastructure/database/database.ts` 的精确文件头：

```ts
import { createRequire } from 'node:module';
import type { StageOneDatabase } from '@xht/contracts';
import {
  Kysely,
  PostgresDialect,
  QueryCreator,
  sql,
  type PostgresPool,
  type PostgresPoolClient
} from 'kysely';

const require = createRequire(import.meta.url);
const { Pool } = require('pg') as {
  readonly Pool: PostgresPoolConstructor;
};

const DATABASE_BINDING = Object.freeze({
  expectedRole: 'xht_worker',
  setRoleSql: 'SET ROLE xht_worker'
} as const);
```

两个文件各自紧接文件头写入以下完整公共文件主体：

```ts
const SESSION_USER_SQL = 'select session_user' as const;
const CURRENT_USER_SQL = 'select current_user' as const;
const ROLE_EVIDENCE_SQL = 'select session_user, current_user' as const;
const MAX_CONNECTIONS = 64;
const MAX_CONNECTION_TIMEOUT_MILLIS = 120_000;
const MAX_IDLE_TIMEOUT_MILLIS = 600_000;
const MAX_CONNECTION_STRING_LENGTH = 4_096;
const POSTGRES_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/u;
const APPLICATION_NAME = /^[A-Za-z0-9._-]{1,63}$/u;

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (reason: unknown) => void;
}

interface SessionUserRow {
  readonly session_user: string;
}

interface CurrentUserRow {
  readonly current_user: string;
}

interface RoleEvidenceRow extends SessionUserRow, CurrentUserRow {}

interface DestructiblePostgresPoolClient extends PostgresPoolClient {
  release(destroy?: boolean): void;
}

interface RuntimePostgresPool extends PostgresPool {
  readonly Client: NonNullable<PostgresPool['Client']>;
  readonly options: object;
  connect(): Promise<DestructiblePostgresPoolClient>;
  end(): Promise<void>;
}

interface PostgresPoolOptions {
  readonly connectionString: string;
  readonly max: number;
  readonly connectionTimeoutMillis: number;
  readonly idleTimeoutMillis: number;
  readonly allowExitOnIdle: false;
  readonly application_name: string;
}

type PostgresPoolConstructor = new (
  options: PostgresPoolOptions
) => RuntimePostgresPool;

export type DatabaseRoleErrorCode =
  | 'DATABASE_SESSION_USER_MISMATCH'
  | 'DATABASE_ROLE_MISMATCH'
  | 'DATABASE_CONNECTION_FAILED'
  | 'DATABASE_CLOSE_FAILED'
  | 'DATABASE_CLOSED';

export class DatabaseRoleError extends Error {
  readonly code: DatabaseRoleErrorCode;

  constructor(code: DatabaseRoleErrorCode) {
    super(code);
    this.name = 'DatabaseRoleError';
    this.code = code;
  }
}

export interface DatabaseConnectionOptions {
  readonly connectionString: string;
  readonly expectedSessionUser: string;
  readonly maxConnections: number;
  readonly connectionTimeoutMillis: number;
  readonly idleTimeoutMillis: number;
  readonly applicationName: string;
}

export interface DatabaseRoleEvidence {
  readonly sessionUser: string;
  readonly currentUser: 'xht_platform' | 'xht_worker';
}

export type ManagedDatabase = QueryCreator<StageOneDatabase>;

export interface RoleBoundDatabase {
  readonly db: ManagedDatabase;
  readonly verifyRole: () => Promise<DatabaseRoleEvidence>;
  readonly close: () => Promise<void>;
}

function createDeferred(): Deferred {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = () => resolvePromise();
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function isBoundedPositiveSafeInteger(value: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= maximum;
}

function validateOptions(options: DatabaseConnectionOptions): void {
  const valid =
    options.connectionString.length > 0 &&
    options.connectionString.length <= MAX_CONNECTION_STRING_LENGTH &&
    POSTGRES_IDENTIFIER.test(options.expectedSessionUser) &&
    APPLICATION_NAME.test(options.applicationName) &&
    isBoundedPositiveSafeInteger(options.maxConnections, MAX_CONNECTIONS) &&
    isBoundedPositiveSafeInteger(
      options.connectionTimeoutMillis,
      MAX_CONNECTION_TIMEOUT_MILLIS
    ) &&
    isBoundedPositiveSafeInteger(
      options.idleTimeoutMillis,
      MAX_IDLE_TIMEOUT_MILLIS
    );
  if (!valid) {
    throw new DatabaseRoleError('DATABASE_CONNECTION_FAILED');
  }
}

export class RoleEnforcingPostgresPool implements PostgresPool {
  readonly Client: NonNullable<PostgresPool['Client']>;
  readonly options: object;
  readonly #pool: RuntimePostgresPool;
  readonly #expectedSessionUser: string;
  #endPromise: Promise<void> | undefined;

  constructor(pool: RuntimePostgresPool, expectedSessionUser: string) {
    this.#pool = pool;
    this.#expectedSessionUser = expectedSessionUser;
    this.Client = pool.Client;
    this.options = pool.options;
  }

  async connect(): Promise<PostgresPoolClient> {
    let client: DestructiblePostgresPoolClient;
    try {
      client = await this.#pool.connect();
    } catch {
      throw new DatabaseRoleError('DATABASE_CONNECTION_FAILED');
    }

    try {
      const before = await client.query<SessionUserRow>(SESSION_USER_SQL, []);
      if (before.rows[0]?.session_user !== this.#expectedSessionUser) {
        throw new DatabaseRoleError('DATABASE_SESSION_USER_MISMATCH');
      }

      await client.query(DATABASE_BINDING.setRoleSql, []);

      const after = await client.query<CurrentUserRow>(CURRENT_USER_SQL, []);
      if (after.rows[0]?.current_user !== DATABASE_BINDING.expectedRole) {
        throw new DatabaseRoleError('DATABASE_ROLE_MISMATCH');
      }
      return client;
    } catch (error: unknown) {
      try {
        client.release(true);
      } catch {
        // The destroy-release was invoked exactly once; its body is never public.
      }
      if (error instanceof DatabaseRoleError) {
        throw error;
      }
      throw new DatabaseRoleError('DATABASE_CONNECTION_FAILED');
    }
  }

  end(): Promise<void> {
    if (this.#endPromise !== undefined) {
      return this.#endPromise;
    }
    const deferred = createDeferred();
    this.#endPromise = deferred.promise;
    try {
      const ending = this.#pool.end();
      void ending.then(
        deferred.resolve,
        () => deferred.reject(new DatabaseRoleError('DATABASE_CLOSE_FAILED'))
      );
    } catch {
      deferred.reject(new DatabaseRoleError('DATABASE_CLOSE_FAILED'));
    }
    return this.#endPromise;
  }
}

async function finishDatabaseClose(
  database: Kysely<StageOneDatabase>,
  pool: RoleEnforcingPostgresPool
): Promise<void> {
  let failed = false;
  try {
    await database.destroy();
  } catch {
    failed = true;
  }
  try {
    await pool.end();
  } catch {
    failed = true;
  }
  if (failed) {
    throw new DatabaseRoleError('DATABASE_CLOSE_FAILED');
  }
}

function createRoleBoundDatabase(
  options: DatabaseConnectionOptions
): RoleBoundDatabase {
  validateOptions(options);
  const rawPool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections,
    connectionTimeoutMillis: options.connectionTimeoutMillis,
    idleTimeoutMillis: options.idleTimeoutMillis,
    allowExitOnIdle: false,
    application_name: options.applicationName
  });
  const rolePool = new RoleEnforcingPostgresPool(
    rawPool,
    options.expectedSessionUser
  );
  const database = new Kysely<StageOneDatabase>({
    dialect: new PostgresDialect({ pool: rolePool })
  });
  const managedDatabase = new QueryCreator<StageOneDatabase>({
    executor: database.getExecutor()
  });
  let closed = false;
  let closePromise: Promise<void> | undefined;

  async function verifyRole(): Promise<DatabaseRoleEvidence> {
    if (closed) {
      throw new DatabaseRoleError('DATABASE_CLOSED');
    }
    try {
      const evidence = await sql<RoleEvidenceRow>`${sql.raw(
        ROLE_EVIDENCE_SQL
      )}`.execute(database);
      const row = evidence.rows[0];
      if (row?.session_user !== options.expectedSessionUser) {
        throw new DatabaseRoleError('DATABASE_SESSION_USER_MISMATCH');
      }
      if (row.current_user !== DATABASE_BINDING.expectedRole) {
        throw new DatabaseRoleError('DATABASE_ROLE_MISMATCH');
      }
      return {
        sessionUser: row.session_user,
        currentUser: DATABASE_BINDING.expectedRole
      };
    } catch (error: unknown) {
      if (error instanceof DatabaseRoleError) {
        throw error;
      }
      throw new DatabaseRoleError('DATABASE_CONNECTION_FAILED');
    }
  }

  function close(): Promise<void> {
    if (closePromise !== undefined) {
      return closePromise;
    }
    closed = true;
    const deferred = createDeferred();
    closePromise = deferred.promise;
    try {
      const finishing = finishDatabaseClose(database, rolePool);
      void finishing.then(
        deferred.resolve,
        () => deferred.reject(new DatabaseRoleError('DATABASE_CLOSE_FAILED'))
      );
    } catch {
      deferred.reject(new DatabaseRoleError('DATABASE_CLOSE_FAILED'));
    }
    return closePromise;
  }

  return { db: managedDatabase, verifyRole, close };
}
```

`apps/platform/src/infrastructure/database/database.ts` 的精确文件尾：

```ts
export function createPlatformDatabase(
  options: DatabaseConnectionOptions
): RoleBoundDatabase {
  return createRoleBoundDatabase(options);
}
```

`apps/worker/src/infrastructure/database/database.ts` 的精确文件尾：

```ts
export function createWorkerDatabase(
  options: DatabaseConnectionOptions
): RoleBoundDatabase {
  return createRoleBoundDatabase(options);
}
```

实现不向 `PostgresDialect` 传递角色 hook。两个 app 当前没有直接 `@types/pg` owner，且本 Task 文件映射和依赖门禁禁止修改 package manifests；因此文件用 Node ESM 的 `createRequire(import.meta.url)` 加载现有真实 `pg.Pool`，并只在本地声明 Kysely 公开结构所需的最小 runtime shape，不从未声明类型的 `pg` 包导入 TypeScript 类型，也不新增 ambient declaration。`RoleEnforcingPostgresPool.connect()` 的所有 SQL 都是文件内固定常量；`expectedSessionUser` 只作值比较。`pool.connect()` 本身失败时没有 client，destroy-release 次数为 0；一旦取得 client，`session_user` 查询/不匹配、`SET ROLE` 失败、`current_user` 查询/不匹配这五类路径统一进入一个 catch，并恰好调用一次 `client.release(true)`。成功 client 由 Kysely 在正常 release 路径调用无参数 `client.release()`，不得销毁。公开异常只有稳定 code，不带 cause、连接字符串、密码、SQL 参数或底层错误正文。

`close()` 在调用任何销毁动作前先缓存自己的 deferred Promise 并把 `closed` 设为 true。`RoleEnforcingPostgresPool.end()` 同样先缓存 deferred，再调用真实 `pg.Pool.end()`；同步 throw 和异步 reject 都在 wrapper 边界新建 `DatabaseRoleError('DATABASE_CLOSE_FAILED')`，不得把底层对象写入 deferred、`cause`、日志或快照。即使 `Pool.end()` 同步回调 `close()`，重入也只能取得原 Promise。`database.destroy()` 和显式 `pool.end()` 共同覆盖 Kysely 已初始化/未初始化两条路径，wrapper 的粘滞 `end()` 保证真实 `Pool.end()` 最多一次。成功、失败、并发、同步重入及后续调用都返回同一 Promise；公开关闭失败统一为 `DATABASE_CLOSE_FAILED`。`DATABASE_CLOSED` 只用于关闭后调用 `verifyRole()`。

真实 `Kysely<StageOneDatabase>` 引用只存在于 factory 闭包与 `finishDatabaseClose()`。公开 handle 的 `db` 是以真实 executor 构造的独立 `QueryCreator<StageOneDatabase>` 运行时对象，不是对真实 Kysely 的 `Omit`、`Pick`、类型断言或代理视图；它保留 `selectFrom`、`selectNoFrom`、`insertInto`、`replaceInto`、`updateTable`、`deleteFrom`、`mergeInto`、`with`、`withRecursive` 以及安全的 `withPlugin`、`withoutPlugins`、`withSchema` 查询能力。`QueryCreator` 本身及三条公开链的运行时原型都没有 `destroy` 或 `Symbol.asyncDispose`，也不暴露 `connection`、`transaction`、`startTransaction`、`withTables`、`$extendTables`、`$omitTables`、`$pickTables`、`getExecutor` 或 `executeQuery`，因此不能重建完整 Kysely 或取得可关闭连接。

未来两个 unit spec 的 U12 都必须逐条放置不执行的 `@ts-expect-error`：直接 `destroy`、三条安全链后 `destroy`、四条 table/type 重建路径、`connection().execute(async connection => connection.destroy())` 与 `Symbol.asyncDispose`；每个注解都必须由 TypeScript 7.0.2 strict 实际消费。运行时同时断言 `Reflect.has(handle.db, 'destroy') === false`、`Symbol.asyncDispose in handle.db === false`，并对 `withPlugin`、`withoutPlugins`、`withSchema` 返回值重复两项断言。调用方唯一关闭入口是 `handle.close()`；本修订不改变 wrapper `end()`、deferred close、错误码或角色门禁。

### 5.3 镜像锁定合同

`packages/testing/src/locked-images.ts` 导出：

```ts
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

export function readLockedImage(
  name: LockedImageName,
  lockFilePath?: string
): LockedImage;
```

实现只接受本计划第 2 节的 tag、`linux/amd64`、manifest-list digest 和 child digest，返回 `tag@child-digest`。任何 null、非 sha256、平台或 tag 不一致都在容器创建前失败。

### 5.4 角色 bootstrap 合同

`packages/testing/src/postgres-role-bootstrap.ts` 导出：

```ts
export interface EphemeralLogin {
  readonly username: string;
  readonly password: string;
  readonly connectionString: string;
}

export interface PostgresRoleBootstrapOptions {
  readonly bootstrapConnectionString: string;
  readonly databaseName: 'xht_test';
}

export interface PostgresRoleBootstrap {
  readonly flywayLogin: EphemeralLogin;
  readonly platformLogin: EphemeralLogin;
  readonly workerLogin: EphemeralLogin;
  readonly close: () => Promise<void>;
}

export class PostgresRoleBootstrapError extends Error {
  readonly code:
    | 'ROLE_BOOTSTRAP_FAILED'
    | 'ROLE_MEMBERSHIP_MISMATCH'
    | 'ROLE_BOOTSTRAP_CLOSED';

  constructor(code: PostgresRoleBootstrapError['code']) {
    super(code);
    this.name = 'PostgresRoleBootstrapError';
    this.code = code;
  }
}

export async function bootstrapTestRoles(
  options: PostgresRoleBootstrapOptions
): Promise<PostgresRoleBootstrap>;
```

该函数用 bootstrap LOGIN 建立唯一 bootstrap `pg.Pool`，执行两个 bootstrap SQL 文件、生成三组随机凭据、创建三条测试 LOGIN 与精确成员资格，然后逐项查询角色属性和成员关系再返回。`close()` 缓存同一个 Promise；成功、失败和后续调用结果粘滞。函数只抛稳定错误码，不附带 SQL、连接字符串、用户名、密码或底层错误正文。

### 5.5 Testcontainers fixture 合同

```ts
import type { StartedNetwork } from 'testcontainers';
import type { EphemeralLogin } from './postgres-role-bootstrap.js';

export interface FlywayEnvironment {
  readonly FLYWAY_URL: string;
  readonly FLYWAY_USER: string;
  readonly FLYWAY_PASSWORD: string;
  readonly REDGATE_DISABLE_TELEMETRY: 'true';
}

export interface PostgresFixture {
  readonly databaseName: 'xht_test';
  readonly hostAlias: 'postgres';
  /**
   * Borrowed by runFlywayCommand only for withNetwork(); callers must not stop it.
   */
  readonly network: StartedNetwork;
  readonly bootstrapLogin: EphemeralLogin;
  readonly flywayLogin: EphemeralLogin;
  readonly platformLogin: EphemeralLogin;
  readonly workerLogin: EphemeralLogin;
  readonly flywayEnvironment: FlywayEnvironment;
  readonly tableNames: () => Promise<readonly string[]>;
  readonly appliedMigrations: () => Promise<readonly AppliedMigration[]>;
  readonly stop: () => Promise<void>;
}

export interface AppliedMigration {
  readonly installedRank: number;
  readonly version: string;
  readonly description: string;
  readonly checksum: number;
  readonly success: boolean;
}

export interface PostgresFixtureOptions {
  readonly projectRoot: string;
  readonly startupTimeoutMillis: 120000;
  readonly stopTimeoutMillis: 10000;
}

export class PostgresFixtureError extends Error {
  readonly code:
    | 'POSTGRES_START_FAILED'
    | 'POSTGRES_NOT_READY'
    | 'POSTGRES_FIXTURE_CLOSED'
    | 'POSTGRES_CLEANUP_FAILED';

  constructor(code: PostgresFixtureError['code']) {
    super(code);
    this.name = 'PostgresFixtureError';
    this.code = code;
  }
}

export async function startPostgresFixture(
  options: PostgresFixtureOptions
): Promise<PostgresFixture>;
```

`PostgresFixture` 是 role bootstrap/bootstrap pg pool、PostgreSQL container 和 Network 的唯一 owner；container 与 role bootstrap 不作为可关闭的公共 handle 暴露，`network` 只借给 `runFlywayCommand` 调用 `.withNetwork()`。fixture 不拥有 Flyway container、platform/worker `RoleBoundDatabase` 或 TEMP 目录。fixture 只返回数据库查询能力与四组临时登录信息，不导入 app 层类型，也不包装 platform/worker factory。集成测试直接导入两个 app factory，并分别传入 `platformLogin` 与 `workerLogin`；因此依赖方向始终是测试调用 app，而不是 `packages/testing` 生产源代码依赖 app。

随机密码使用 `randomBytes(32).toString('base64url')`，只保存在当前测试进程内存和容器环境。任何日志、快照、异常、报告或文档都不得包含这些值。

### 5.6 Flyway runner 合同

```ts
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
```

`ProcessStoppedWaitStrategy` 只等待容器进程从 running/paused 进入具有有效 StartedAt/FinishedAt 的停止状态，不读取 ExitCode，也不把非零退出当作 Testcontainers 启动失败；因此 `start()` 能返回受管理 handle。返回后 `inspectExitCode()` 才读取真实 `State.ExitCode`：0 形成成功证据，非零按命令映射 `FLYWAY_MIGRATE_FAILED` 或 `FLYWAY_VALIDATE_FAILED`。

日志完整性不使用 Testcontainers 12.0.4 的 `StartedTestContainer.logs()`，也不把 `docker-modem@5.0.7` 的 `demuxStream()` 当作完整性证据：前者会把 raw request rejection 转成正常空 EOF，后者只监听 `data`，不在 EOF 暴露或拒绝 pending header、pending payload 和 residual Buffer，还会对非法 stream type 退回 raw stdout。`readLogs()` 只通过公开 runtime 上的 raw Dockerode container 发起 `follow: false`、stdout/stderr 全量请求，并在调用 `logs()` 前创建 `AbortController` 与 request timeout。`controller.signal` 作为 `abortSignal` 传入；raw Promise 在任何 timeout/abort/late-settle gate 前先安装 resolve/reject 观察器，再与独立 timeout Promise 竞速。同步 throw、异步 reject、request timeout 和 abort 都只新建 `FLYWAY_LOG_READ_FAILED`，不得保留底层 cause 或正文。

raw request 与 stream 是两个独立的有限阶段。`LOG_REQUEST_TIMEOUT_MILLIS=5_000` 从 raw request 发起前开始计时；超时必须调用 `controller.abort()`，即使 fake Promise 完全忽略 abort 且永久 pending，timeout race 也必须 settle reject，清除 request timer，禁止进入 `collectDockerLogs()`，并让 `runFlywayCommand.finally` 继续执行。request 快速 resolve/reject、同步 throw、timeout、响应 abort、忽略 abort、timeout 后 late resolve/reject 均不得留下 timer 或 `unhandledRejection`。

`DockerMultiplexParser` 是唯一日志解析器，同时接受完整 `Buffer` 和 readable stream。每帧严格验证 8-byte header、stream type 只能为 stdout `1` 或 stderr `2`、三个 reserved bytes 全为零、unsigned 32-bit payload length、实际 payload 完整；EOF 时 pending bytes 必须为 0。raw/Tty 内容、incomplete header、incomplete payload、trailing garbage、非法 type/reserved、同步 parser 异常、stream error、close-before-end 和 timeout 全部只映射为 `FLYWAY_LOG_READ_FAILED`。`MAX_LOG_BYTES=1_048_576` 限制 decoded payload，`MAX_RAW_LOG_BYTES=1_081_344` 限制 wire bytes，`MAX_LOG_FRAMES=4_096` 限制包括零长度帧在内的帧数，`LOG_READ_TIMEOUT_MILLIS=5_000` 保证已返回的 readable 不会永久 pending；五个限制/超时常量的刚好边界、首个越界值和 request/stream 双阶段独立有限性都必须直接测试。error/close-before-end/timeout/同步异常时移除本次四类 listener，并在可用且尚未销毁时安全 destroy 输入；清理自身失败不得改变公开错误。

解析器分别聚合 stdout、stderr 和 frame-order。密码检查必须同时扫描三者：同一 stdout 或 stderr 内跨 frame 的密码即使被另一通道 frame 穿插，仍由通道内连续聚合命中；frame-order 另覆盖按 Docker 帧顺序连续出现的探针。只有 raw 请求成功、严格解析消费所有帧、正常 Buffer 完结或 readable EOF、三路 Secret 命中均为 0 时，才能构造 `passwordLeakCount: 0`。真实空 Buffer 或正常 EOF 的零帧 stream 继续是合法空日志；任何失败都不得生成成功证据。底层错误、正文、密码、容器环境和连接信息从不进入 message、cause、stack、JSON、日志、快照或 `cleanupEvidence`。

`runFlywayCommand` 是自己创建的单个 Flyway one-shot container 的唯一 owner。每次调用生成 `randomUUID()` owner 值并写入固定、非 Secret label；关闭 Testcontainers auto-cleanup/auto-remove，禁止把 Ryuk 或进程退出冒充当前调用的清理。正常取得 handle 时按 handle 的精确 label/id 清理；任何复制、创建、启动、等待等阶段在返回 handle 前失败时，`finally` 使用 Testcontainers 12.0.4 根导出的 `getContainerRuntimeClient()`，再通过其公开 `container.dockerode.listContainers({ all: true, filters: { label } })` 查询本 owner 的 created、running、exited/stopped 容器。查询必须 `all: true`，因为默认只列 running 容器；Docker 的停止态通常报告为 `exited`，fake runtime 同时覆盖 `stopped` 别名。

清理只对 label 值逐字等于本次 UUID 的容器执行；running/无法 inspect 才尝试 stop，created/exited/stopped 不重复 stop，随后 remove 且 `removeVolumes: true`。查询、owner、状态、inspect、stop、remove 失败只变成枚举化 `cleanupEvidence`，不得携带底层错误、环境、日志或密码。已有业务失败时保留原 `code` 并附加清理证据；只有原业务成功但清理失败时才返回 `FLYWAY_CLEANUP_FAILED`。`migrateAndValidate` 的三个命令各有独立 owner label、独立 handle 或 label 回收和自己的 `finally`。

## 6. PostgreSQL bootstrap 与角色关系

### 6.1 角色

`database/bootstrap/roles.sql` 创建三个 cluster-level 权限角色：

```sql
CREATE ROLE xht_flyway
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE xht_platform
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE xht_worker
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS;
```

测试 fixture 由 bootstrap LOGIN 动态创建 `xht_flyway_test_login`、`xht_platform_test_login`、`xht_worker_test_login` 三个 LOGIN。每个 LOGIN 固定为 `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`，密码由 `postgres-role-bootstrap.ts` 在运行时生成并通过严格 SQL literal escaping 只写入内存命令；密码与命令全文均不得输出、持久化或进入异常。

成员资格精确为：

```sql
GRANT xht_flyway TO xht_flyway_test_login
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
GRANT xht_platform TO xht_platform_test_login
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
GRANT xht_worker TO xht_worker_test_login
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
```

- 每个测试 LOGIN 只能成为一个 NOLOGIN 角色成员。
- `INHERIT FALSE` 保证登录后、`SET ROLE` 前不能自动使用组角色对象权限。
- `SET TRUE` 只允许切换到唯一组角色。
- 测试 LOGIN 直接获得 `CONNECT`，不直接获得 schema/table/history 权限。
- bootstrap LOGIN 是 `PostgreSqlContainer` 在本次隔离容器内生成的初始 `SUPERUSER`。超级用户能力只因 PostgreSQL cluster role 创建、schema owner 变更和数据库级 PUBLIC 撤权确实需要而存在；它只执行 bootstrap 和权限证据查询，不进入迁移或业务连接。
- bootstrap LOGIN 及其连接字符串不得传入 Flyway、platform 或 worker pool；容器销毁即失效，不允许映射为共享、预发布或生产凭据。

### 6.2 database.sql

`database/bootstrap/database.sql` 在 `xht_test` 内执行：

```sql
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO xht_flyway;
GRANT USAGE, CREATE ON SCHEMA public TO xht_flyway;
GRANT USAGE ON SCHEMA public TO xht_platform, xht_worker;

DO $$
BEGIN
  EXECUTE format(
    'REVOKE CONNECT, TEMPORARY ON DATABASE %I FROM PUBLIC',
    current_database()
  );
END
$$;
```

fixture 随后只给三个测试 LOGIN `CONNECT`。platform/worker 角色没有 schema CREATE；Flyway 角色拥有 public schema，因而能创建和后续修改迁移对象。

## 7. Flyway TOML、callback 与运行语法

`database/flyway.toml` 的完整非 Secret 配置：

```toml
[flyway]
environment = "default"
locations = ["filesystem:/flyway/sql"]
callbackLocations = ["filesystem:/flyway/callbacks"]
validateMigrationNaming = true
createSchemas = false
cleanDisabled = true
table = "flyway_schema_history"

[environments.default]
schemas = ["public"]
```

连接 URL、LOGIN 和密码只通过容器环境 `FLYWAY_URL`、`FLYWAY_USER`、`FLYWAY_PASSWORD` 注入；同时固定关闭 Redgate/Flyway usage telemetry：

```ts
.withEnvironment({
  FLYWAY_URL: fixture.flywayEnvironment.FLYWAY_URL,
  FLYWAY_USER: fixture.flywayEnvironment.FLYWAY_USER,
  FLYWAY_PASSWORD: fixture.flywayEnvironment.FLYWAY_PASSWORD,
  REDGATE_DISABLE_TELEMETRY: 'true'
})
```

Redgate/Flyway 官方 `REDGATE_DISABLE_TELEMETRY` 文档明确说明任一非空值都会禁用 telemetry client，本计划固定使用字符串 `'true'`；来源登记在 [source-register.md](../research/source-register.md)。禁止设置 Flyway telemetry/licensing email、token、license key、pipeline publish 或生产 collector。密码不得出现在 `.withCommand(...)`、异常、日志或文档。

`database/flyway-callbacks/afterConnect.sql`：

```sql
SET ROLE xht_flyway;

DO $$
BEGIN
  IF current_user <> 'xht_flyway' THEN
    RAISE EXCEPTION 'FLYWAY_ROLE_MISMATCH';
  END IF;
END
$$;
```

选择 `afterConnect.sql` 的原因：官方当前文档把 `initSql` 标记为将移除，并推荐 afterConnect callback；afterConnect 在 Flyway 每次建立连接后立即执行。`SET ROLE xht_flyway` 使用 PostgreSQL 官方语法，只有具有 `SET TRUE` 成员资格的 Flyway LOGIN 能成功。

真实 Flyway 12.11.0 实施进一步证明：SQL afterConnect callback 不能覆盖其全部 housekeeping 连接。fixture 的 `FLYWAY_URL` 因而固定追加 PostgreSQL JDBC `?options=-c%20role%3Dxht_flyway`，使每条 JDBC 连接在建立时切换角色；callback 保留并验证 `current_user`。该值不含 Secret，且角色切换仍由 LOGIN 的唯一 SET-only 成员资格授权。

真实命令数组：

```ts
[
  '-configFiles=/flyway/conf/flyway.toml',
  'migrate'
]
```

或：

```ts
[
  '-configFiles=/flyway/conf/flyway.toml',
  'validate'
]
```

`locations` 与 `callbackLocations` 从 TOML 读取，不在命令行重复。one-shot 容器使用第 5.6 节基于 Testcontainers 12.0.4 公开 `StartupCheckStrategy` 的 `ProcessStoppedWaitStrategy` 和 `120_000` 毫秒 startup timeout；该 wait 只等进程停止并允许 `start()` 返回 handle，不解释退出码。随后通过公开 runtime client 对 handle ID 执行 inspect；只有真实 `State.ExitCode === 0` 才返回证据，非零按 migrate/validate 分别映射稳定失败。

## 8. schema、索引与约束

### 8.1 表集合

V1 只创建以下九张业务表：

1. `users`
2. `memberships`
3. `identity_profiles`
4. `channel_bindings`
5. `registration_idempotency`
6. `inbox_messages`
7. `outbox_messages`
8. `durable_jobs`
9. `audit_events`

`flyway_schema_history` 由 Flyway 管理，不属于业务表合同。

### 8.2 外键

| 约束名 | 子列 | 父列 | 删除行为 |
|---|---|---|---|
| `fk_memberships_uid` | `memberships.uid` | `users.uid` | `RESTRICT` |
| `fk_identity_profiles_uid` | `identity_profiles.uid` | `users.uid` | `RESTRICT` |
| `fk_channel_bindings_uid` | `channel_bindings.uid` | `users.uid` | `RESTRICT` |
| `fk_registration_idempotency_uid` | `registration_idempotency.uid` | `users.uid` | `RESTRICT` |

### 8.3 唯一约束与索引

| 名称 | 定义 |
|---|---|
| `uq_memberships_uid` | `memberships(uid)` |
| `uq_channel_bindings_active_external` | `(channel_type, external_user_id) WHERE status = 'ACTIVE'` |
| `uq_registration_channel_external` | `registration_idempotency(channel_type, external_user_id)` |
| `uq_inbox_consumer_external` | `inbox_messages(consumer, external_message_id)` |
| `uq_outbox_topic_event_key` | `outbox_messages(topic, event_key)` |
| `uq_durable_job_business_key` | `durable_jobs(job_type, business_key)` |
| `ix_channel_bindings_uid` | `channel_bindings(uid)` |
| `ix_registration_uid` | `registration_idempotency(uid) WHERE uid IS NOT NULL` |
| `ix_inbox_claimable` | `inbox_messages(status, claimed_until, received_at, inbox_id)` |
| `ix_outbox_claimable` | `outbox_messages(status, available_at, locked_until, created_at, outbox_id)` |
| `ix_durable_jobs_claimable` | `durable_jobs(status, available_at, locked_until, created_at, job_id)` |

### 8.4 CHECK 规则

- `channel_type` 当前只允许 `TELEGRAM`。
- 所有状态值使用本计划第 5.1 节的精确集合。
- `channel_bindings` 只有 `REVOKED` 要求 `revoked_at IS NOT NULL`，其他状态要求 null。
- `registration_idempotency` 的 PROCESSING/COMPLETED/FAILED/CONFLICT 对 uid、完成时间、失败码、失败时间、冲突时间采用显式 OR 分支，不依赖 SQL 三值逻辑。
- Inbox `claim_generation >= 0`；CLAIMED 必须有 claimed_by/claimed_until，PROCESSED 必须有 processed_at，CONFLICT/FAILED 必须有 failure_code。
- `payload_digest` 匹配 `^hmac-sha256:[A-Za-z0-9_-]{43}$`。
- `digest_key_version` 匹配 `^v[1-9][0-9]{0,8}$`。
- Outbox 与 durable job 的 `attempt_count`、`lock_generation` 非负。
- LEASED 状态必须同时具有 locked_by、lease_token、locked_until；非 LEASED 状态三列必须同时为 null。
- SUCCEEDED 状态必须具有 succeeded_at；非 SUCCEEDED 状态必须为 null。
- 所有 `created_at`、`updated_at`、`received_at`、`available_at`、`claimed_until`、`processed_at`、`succeeded_at`、`occurred_at`、`failed_at`、`conflicted_at`、`completed_at`、`revoked_at` 都使用 `timestamptz`。

### 8.5 Inbox 完整摘要边界

`inbox_messages` 只有以下内容相关列：

- `payload_digest`
- `digest_key_version`

禁止出现能够持久化原始或可还原 Telegram 内容的列，包括：

- `payload_hash`
- `payload`
- `body`
- `raw_update`
- `update_json`
- `message_text`
- `callback_data`
- `start_parameter`
- `payment_password`
- 任何承载完整 Update/正文的额外 `json/jsonb/text/bytea` 列

digest key material 不进入任何表。integration test 必须同时肯定两个允许列并否定整组禁止列。

### 8.6 禁止资金与链字段

九张业务表以及 public schema 内所有 Task 3 对象都不得出现：

- `asset_id`
- `ledger_account_id`
- `balance`
- `available_balance`
- `frozen_balance`
- `wallet_id`
- `address`
- `network_id`
- `chain_id`
- `market`
- `market_id`
- `amount`

## 9. 权限矩阵

缩写：`S` SELECT、`I` INSERT、`U` UPDATE、`D` DELETE、`C` CREATE/DDL、`H` Flyway history 写入。空白表示拒绝。

| 对象/能力 | bootstrap LOGIN | `xht_flyway` | `xht_platform` | `xht_worker` |
|---|---:|---:|---:|---:|
| 创建/修改 cluster role | C（仅 bootstrap） |  |  |  |
| public schema CREATE/ALTER | C | C |  |  |
| `flyway_schema_history` | S/I/U/D | S/I/U/D/H |  |  |
| users | S/I/U/D | S/I/U/D | S/I/U |  |
| memberships | S/I/U/D | S/I/U/D | S/I/U |  |
| identity_profiles | S/I/U/D | S/I/U/D | S/I/U |  |
| channel_bindings | S/I/U/D | S/I/U/D | S/I/U | S |
| registration_idempotency | S/I/U/D | S/I/U/D | S/I/U |  |
| inbox_messages | S/I/U/D | S/I/U/D | S/I/U |  |
| outbox_messages | S/I/U/D | S/I/U/D | S/I | S/U |
| durable_jobs | S/I/U/D | S/I/U/D |  | S/I/U |
| audit_events | S/I/U/D | S/I/U/D | S/I | S/I |
| 任意业务表 DELETE/TRUNCATE | 允许但禁止正常使用 | owner |  |  |

额外拒绝断言：

- platform/worker 不能 CREATE/ALTER/DROP schema 或 table。
- platform/worker 不能读写 `flyway_schema_history`。
- platform 不能更新/删除 `audit_events`，不能访问 `durable_jobs`。
- worker 不能写 users、memberships、identity_profiles、channel_bindings、registration_idempotency、Inbox。
- worker 不能删除 Outbox 或 durable job。
- 任一测试 LOGIN 在 `SET ROLE` 前不能访问九张业务表。
- 任一测试 LOGIN 不能 `SET ROLE` 到另外两个组角色。
- bootstrap LOGIN 不能出现在 platform/worker factory 的 `session_user` 证据中。

## 10. Testcontainers、Windows 与资源生命周期

### 10.1 网络与容器

- PostgreSQL 的唯一构建路径必须先读取锁定值并显式绑定平台：

```ts
const locked = readLockedImage('postgres', lockFilePath);
const postgresContainer = new PostgreSqlContainer(locked.immutableReference)
  .withPlatform(locked.platform)
  .withNetwork(network)
  .withNetworkAliases('postgres');
```

- Flyway 的唯一构建路径必须独立读取锁定值并显式绑定同一平台：

```ts
const locked = readLockedImage('flyway', lockFilePath);
const flywayContainer = new GenericContainer(locked.immutableReference)
  .withPlatform(locked.platform)
  .withNetwork(fixture.network);
```

- `readLockedImage` 已把 `locked.platform` 的类型和值都固定为 `'linux/amd64'`；不得用 daemon 默认平台替代。最终静态覆盖门禁必须证明 PostgreSQL/Flyway 两条构建路径的显式平台调用为 `2/2`。
- 每个 test file 建立一个随机 Testcontainers `Network`，不使用固定容器名。
- PostgreSQL 加入 network 并使用唯一 alias `postgres`。
- PostgreSQL 容器只映射 Testcontainers 随机宿主端口，不硬编码 5432 宿主端口。
- startup timeout 为 `120_000` 毫秒；stop timeout 为 `10_000` 毫秒。
- 测试 hook timeout 为 `180_000` 毫秒；禁止固定 sleep，使用镜像 health check、Testcontainers wait strategy 和 SQL readiness。
- 每个凭据都由当前 fixture 独立生成，不能跨 test file 复用。

### 10.2 bind mount 与复制方案

| 方案 | Windows/Docker Desktop | 远程 Docker | 权限/路径风险 | 决定 |
|---|---|---|---|---|
| bind mount | 依赖盘符共享、路径转换和 daemon 可见性 | 不可移植 | 宿主路径直接暴露给 daemon | 不采用 |
| Testcontainers copy | 由客户端归档后复制到固定 POSIX 路径 | 可工作 | 可在复制前做 root/symlink 校验 | 采用 |

实施使用：

```ts
withCopyFilesToContainer([
  {
    source: resolvedConfigFile,
    target: '/flyway/conf/flyway.toml',
    mode: 0o444
  }
])
.withCopyDirectoriesToContainer([
  {
    source: resolvedMigrationsDirectory,
    target: '/flyway/sql',
    mode: 0o555
  },
  {
    source: resolvedCallbacksDirectory,
    target: '/flyway/callbacks',
    mode: 0o555
  }
])
```

复制前必须：

1. 用 `path.resolve(projectRoot, relativePath)` 得到 Windows 绝对路径。
2. 用 `fs.realpath` 取得 canonical 路径。
3. 证明 canonical 路径仍位于 projectRoot。
4. 递归拒绝 symbolic link。
5. 验证配置是文件、migrations/callbacks 是目录且非空。

进入容器后的命令只使用 `/flyway/...`，不会携带 Windows 盘符或反斜杠。

### 10.3 逆序清理

资源所有权固定且不得转移：

| 资源 | 唯一 owner | 唯一清理位置 | 清理次序 |
|---|---|---|---:|
| worker `RoleBoundDatabase` | `permissions.integration.spec.ts` | spec `finally` 调用 `worker.close()` | 1 |
| platform `RoleBoundDatabase` | `permissions.integration.spec.ts` | 同一 spec `finally` 调用 `platform.close()` | 2 |
| 每个 Flyway one-shot container | 创建它的 `runFlywayCommand` 调用 | 该调用自己的 `finally`；有 handle 按 label/id，无 handle 按唯一 label + `all:true` 查询 | 命令局部 |
| role bootstrap/bootstrap pg Pool | `PostgresFixture` | `fixture.stop()` 内先调用 role bootstrap 的粘滞 `close()` | 3 |
| PostgreSQL container | `PostgresFixture` | `fixture.stop()` 内 `stop({ timeout: 10_000 })` | 4 |
| Network | `PostgresFixture` | `fixture.stop()` 内 `stop()` | 5 |
| checksum/copy TEMP 目录 | `migrations.integration.spec.ts` | 创建它的 spec `finally`，仅删除 realpath 已证明位于系统 TEMP 的目录 | spec 局部最后 |

`permissions.integration.spec.ts` 的唯一外层清理顺序必须是 worker → platform → fixture。`migrations.integration.spec.ts` 不创建 app handle，只拥有自己的 fixture 与 TEMP 目录；它先结束所有 runner 调用，再停止 fixture，最后删除自己的 TEMP。fixture 使用内部 LIFO cleanup stack，但只登记自己拥有的 role bootstrap/bootstrap pool、PostgreSQL container 和 Network；不得登记 app handle、Flyway container 或 spec TEMP。任何 owner 在资源创建成功后立即登记自己的唯一清理动作；Flyway 的 owner 在 container create 之前已经以 UUID label 确立。清理错误收集为稳定类别但不覆盖原始失败类别。重复清理调用、无 owner 资源和跨 owner 代清理的允许数量都为 0；Ryuk 与进程退出后的清理不计作本合同的成功证据。

## 11. Flyway Secret 边界

- Flyway 密码只进入 `GenericContainer.withEnvironment({ FLYWAY_PASSWORD })`。
- 同一环境对象必须固定 `REDGATE_DISABLE_TELEMETRY: 'true'`；telemetry email、token、license key、pipeline publish 和生产 collector 配置命中必须为 0。
- `.withCommand(...)` 不含 URL、用户名或密码。
- 运行器不调用 `console`，只返回结构化证据。
- Testcontainers debug 默认关闭；验证命令不得设置 `DEBUG=testcontainers*`。
- Flyway 容器日志只有在 raw 请求、严格 frame 解析和正常 EOF 全部完成后，才分别扫描 stdout、stderr、frame-order 三路随机密码原文；任一路命中即失败，三路正文随后丢弃。
- `FlywayRunnerError` 只暴露稳定 code，不附带 cause、命令、environment 或日志正文。
- 清理失败只以 `FlywayCleanupErrorCode` 枚举数组附加；已有 migrate/validate/log/inspect/Secret 主失败时不得被 `FLYWAY_CLEANUP_FAILED` 覆盖。
- 集成测试以随机密码作为合成探针，断言测试输出、异常、快照和最终报告均不含该值。

## 12. RED → GREEN 执行顺序

以下命令只在未来 Task 3 获得完整授权后运行。

### Task 3.1：镜像锁定与源路径门禁

**Files:** `toolchain-lock.json`、`packages/testing/src/locked-images.ts`

1. 在两个 integration spec 中先写 child digest、平台、tag 不匹配时容器创建前失败的断言。
2. 运行：

```powershell
pnpm exec vitest run --project database packages/testing/test/database/migrations.integration.spec.ts packages/testing/test/database/permissions.integration.spec.ts
```

3. 预期 RED：`readLockedImage` 尚未导出。
4. 写入第 2 节精确值和 `readLockedImage` 最小实现。
5. 重跑；镜像锁定断言 GREEN，但容器/迁移用例仍因 fixture 缺失保持 RED。

### Task 3.2：bootstrap 与角色

**Files:** `database/bootstrap/roles.sql`、`database/bootstrap/database.sql`、`packages/testing/src/postgres-role-bootstrap.ts`

1. 先写角色属性、唯一成员资格、`INHERIT FALSE/SET TRUE`、错误 SET ROLE 的权限测试。
2. 预期 RED：bootstrap 文件或 `bootstrapTestRoles` 不存在。
3. 写 NOLOGIN 角色、database 边界和随机测试 LOGIN 最小实现。
4. 重跑角色子集；角色/成员资格 GREEN。

### Task 3.3：V1 schema 与类型合同

**Files:** migration、contracts database 类型与 index

1. 先写九表、列、类型、外键、CHECK、唯一索引、Inbox 摘要和禁止字段断言。
2. 预期 RED：V1 migration 缺失。
3. 写完整纯 SQL migration 和 `StageOneDatabase`。
4. 运行 build/typecheck；类型与 schema 静态合同 GREEN，容器数据库用例仍等待 runner。

### Task 3.4：Kysely role-bound factories

**Files:** platform/worker 两个 `database.ts` 与两个 `apps/*/test/unit/database.spec.ts`

1. 先在两个 unit spec 各写第 13 节 U01–U12，fake pool/client 只使用合成值且不打开网络。
2. 运行：

```powershell
pnpm exec vitest run --project unit apps/platform/test/unit/database.spec.ts apps/worker/test/unit/database.spec.ts
```

3. 预期 RED：两个 database module 尚不存在；不是网络或数据库连接错误。
4. 按第 5.2 节写 `RoleEnforcingPostgresPool`、固定 app role、stable error、正常/销毁 release、wrapper 自身关闭错误净化、`ManagedDatabase` 和 deferred 粘滞 close；`PostgresDialect` 不设置角色 hook。
5. 重跑同一命令；U01–U12 在 platform/worker 共 24 项全部 GREEN，failed/skipped/only/retry 为 0。
6. 再运行 permissions integration；每次取得真实连接都返回正确 `session_user/current_user`，并保持既定允许/拒绝矩阵。

### Task 3.5：Testcontainers fixture 与 Flyway runner

**Files:** testing 四个源文件、TOML、afterConnect callback

1. 先写空库 migrate/重复 migrate/validate 和 Secret 零泄露测试。
2. 预期 RED：fixture/runner 未导出。
3. 写 network、显式 `.withPlatform(locked.platform)` 的 PostgreSQL container、bootstrap、copy-to-container、禁用 telemetry 的 Flyway one-shot、`ProcessStoppedWaitStrategy`、真实 ExitCode inspect、唯一 owner label 和第 10.3 节有/无 handle 清理。
4. 重跑 migrations spec；空库、重复 migrate、validate GREEN。

### Task 3.6：checksum 漂移与权限完整矩阵

1. 测试把 V1 复制到 `os.tmpdir()` 下的新目录并追加一条无副作用 `SELECT 1;`，只把该隔离副本复制进 validate 容器。
2. 预期非零 `validate` 仍先取得受管理 handle，再由 inspect 映射 `FLYWAY_VALIDATE_FAILED`；原项目 migration 不修改，handle 在同一调用 finally 删除。
3. 在 `finally` 删除经验证位于系统 TEMP 下的目录。
4. 完成第 9 节所有允许/拒绝断言。
5. 运行两个 integration spec，全部 GREEN。

### Task 3.7：最终回归

严格顺序：

```powershell
pnpm build
pnpm typecheck
pnpm test:unit
pnpm exec vitest run --project database packages/testing/test/database/migrations.integration.spec.ts packages/testing/test/database/permissions.integration.spec.ts
```

随后再次运行两个 database spec，证明资源已清理、测试可重复、第二次全新 fixture 无命名/端口冲突。最终 unit 证据必须单列两个新增 database spec 的 24/24 结果。

## 13. platform/worker 单元测试矩阵

`apps/platform/test/unit/database.spec.ts` 与 `apps/worker/test/unit/database.spec.ts` 必须各自执行同一组 U01–U12；每个 spec 只导入本 app 的 module。fake `pg.Pool`/`PoolClient` 使用合成 session 名和稳定错误正文探针，不调用 DNS、socket、容器或数据库。U01–U09 可直接构造导出的 `RoleEnforcingPostgresPool`；U10–U12 用 Vitest module mock 让本 app factory 的 `new Pool()` 返回当前 fake pool，从而直接观察 `close()` 与底层 `end()`。

| ID | 单测名称/场景 | 精确安排 | 必需断言 |
|---|---|---|---|
| U01 | 正常检查 `session_user` | fake connect 返回 client；首个 query 返回 expected session | 首个 SQL 精确为 `select session_user`，结果被检查 |
| U02 | 只用固定常量执行正确 `SET ROLE` | 成功路径记录 query 顺序与参数 | platform 只出现 `SET ROLE xht_platform`；worker 只出现 `SET ROLE xht_worker`；动态拼接和其他 role 命中 0 |
| U03 | 检查 `current_user` | 第三个 query 返回所属 app role | 第三个 SQL 精确为 `select current_user`，错误 role 不被接受 |
| U04 | `session_user` 不匹配时 destroy-release 一次 | 在同一个 U04 test 内依次运行“首查询抛合成错误”和“首查询返回错误 session”两个独立 fake client | 两个取得 client 后的路径分别 `release(true)` 恰好 1 次；公开错误分别为 `DATABASE_CONNECTION_FAILED`、`DATABASE_SESSION_USER_MISMATCH`，合成正文命中 0 |
| U05 | `SET ROLE` 失败时 destroy-release 一次 | 首查询成功，固定 role query 抛合成错误 | `release(true)` 恰好 1 次；`DATABASE_CONNECTION_FAILED`；正文命中 0 |
| U06 | `current_user` 查询失败时 destroy-release 一次 | 前两步成功，第三查询抛合成错误 | `release(true)` 恰好 1 次；`DATABASE_CONNECTION_FAILED`；正文命中 0 |
| U07 | `current_user` 不匹配时 destroy-release 一次 | 第三查询返回另一角色 | `release(true)` 恰好 1 次；`DATABASE_ROLE_MISMATCH` |
| U08 | 成功连接正常 release | 用 wrapper 构造 Kysely dialect 并执行一条合成 `select 1`，等待 Kysely 归还连接 | `release()` 无参数恰好 1 次；`release(true)` 0 次 |
| U09 | `pool.connect()` 失败 | fake pool 在取得 client 前抛错 | release 总次数 0；`DATABASE_CONNECTION_FAILED`；正文命中 0 |
| U10 | 普通并发 close | fake `end()` 返回未决 gate；连续调用两次 `close()` 后再释放 gate | 两次返回严格同一 Promise；pending 时没有早成功；真实 `end()` 恰好 1 次；成功后后续调用仍同一 Promise |
| U11 | 同步重入 close | fake `end()` 在返回已解决 Promise 前同步调用当前 handle 的 `close()` 并保存返回值 | 重入 Promise 与首个 Promise 严格相同；真实 `end()` 恰好 1 次；结果成功粘滞 |
| U12 | wrapper/handle 关闭失败粘滞、运行时安全 facade 与脱敏 | 先直接构造 wrapper，分别让真实 `pool.end()` 同步 throw 与异步 reject；再让 handle close 的 fake `end()` 同步重入并最终 reject；逐条放置 direct、三条 chain、四条 table/type、connection 和 asyncDispose 共十类不执行的 `@ts-expect-error`，并运行 Reflect/`in` 断言 | wrapper 两路只返回 `DATABASE_CLOSE_FAILED`；handle 的首次/并发/同步重入/后续调用严格同一 rejected Promise；真实 `end()` 每场景最多 1 次；message/cause/stack/log/snapshot 的 `synthetic-secret` 总命中 0；facade 本体及三条安全链的 runtime/type destroy 与 asyncDispose 可访问数均为 0，CRUD 查询 builder 可创建 |

每个 spec 恰好有 U01–U12 十二个顶层 test，两个 spec 合计 24 个。U04 与 U12 可在同一顶层 test 内使用多个精确子场景，不新增 U 编号。U04 的两个内部 fixture run 补齐“取得 client 后首个 `session_user` 查询自身失败”边界。失败销毁覆盖必须是：`session_user` 查询失败、session 不匹配、固定 `SET ROLE` 失败、`current_user` 查询失败、role 不匹配，五类均 `release(true)` 恰好一次；`pool.connect()` 自身失败为 0。`DATABASE_CLOSE_FAILED` 必须在两个 app 的实现 union 中声明，并由两个 U12 直接断言；wrapper 直接 end、handle close、十类关闭能力逃逸的 TypeScript 负向断言、runtime facade/链式结果和 CRUD 正向能力缺一不可，只靠间接字符串扫描不算覆盖。

## 14. migrations.integration 测试矩阵

| ID | 场景 | 正向/反向 | 必需结果 |
|---|---|---|---|
| M01 | 锁定 tag + linux/amd64 child digest | 正 | 两镜像解析为第 2 节 immutable reference，两个构建路径显式 `.withPlatform(locked.platform)` 覆盖 2/2 |
| M02 | manifest-list digest 当作 child | 反 | 容器创建前拒绝 |
| M03 | 空库 migrate | 正 | 应用且只应用版本 `1` |
| M04 | 同库第二次 migrate | 正 | 新应用版本数 0 |
| M05 | validate 原 migration | 正 | validationSuccessful true |
| M06 | 修改隔离副本 checksum | 反 | Flyway 非零退出仍取得本次受管理 handle；inspect 真实非零 ExitCode 后映射 `FLYWAY_VALIDATE_FAILED`；finally stop/remove、残留 0 |
| M07 | 九表集合 | 正 | 九张业务表全部存在 |
| M08 | Flyway history | 正 | 成功记录版本 1、checksum 非 null |
| M09 | 外键/唯一/CHECK | 正 | 名称和定义与第 8 节一致 |
| M10 | timestamptz | 正 | 所有列规则通过 |
| M11 | Inbox 摘要列 | 正 | 两列存在且约束存在 |
| M12 | Inbox 原始内容列 | 反 | 禁止列命中 0 |
| M13 | 资金/链字段 | 反 | 禁止字段命中 0 |
| M14 | bind mount | 反 | runner 配置中使用数 0 |
| M15 | Flyway raw 日志完整性、password/telemetry 边界 | 反 | 直接覆盖下列子场景 1–20，并在既有第 13 子场景内覆盖 raw request 同步/异步/成功/abort/ignore-abort/late-settle 矩阵；只有 request 与 stream 两阶段有限、完整解析与正常 EOF 后的三路 Secret 命中 0 才形成成功证据；所有 request、完整性、读取、超时与限制失败精确为 `FLYWAY_LOG_READ_FAILED`，含密码精确为 `FLYWAY_SECRET_LEAK`；`REDGATE_DISABLE_TELEMETRY` 精确为 `'true'`，email/token/license/pipeline/collector 命中 0 |
| M16 | runner 全生命周期失败与唯一清理矩阵 | 反 | 直接覆盖下列子场景 21–24，并在既有第 21/22 子场景内覆盖 raw request timeout 的 remove 与主/清理叠加；保留 start 前无容器、create 后无 handle、非零退出、主 inspect、cleanup query/inspect/stop/remove 失败；每例只有本次 owner 被清理，主错误不被 cleanup 覆盖，稳定证据与所有公开表面 Secret 命中 0 |
| M17 | 第二个全新 fixture | 正 | 无固定名称、端口或 network 冲突 |

M15/M16 不新增 M 编号，必须以具名嵌套 test 覆盖以下 24 个精确子场景：

1. Buffer 合法零帧空日志，三路内容为空并允许成功证据。
2. Buffer 合法 stdout/stderr 多帧，三路聚合和值顺序正确。
3. readable stream 合法 stdout/stderr 多帧，正常 EOF 后结果与 Buffer 相同。
4. 完整密码出现在 stdout，拒绝为 `FLYWAY_SECRET_LEAK`。
5. 完整密码出现在 stderr，拒绝为 `FLYWAY_SECRET_LEAK`。
6. 密码拆成两个 stdout frame、中间穿插 stderr frame，stdout 聚合必须命中。
7. 密码拆成两个 stderr frame、中间穿插 stdout frame，stderr 聚合必须命中。
8. 分别输入 1–7 bytes incomplete header，七例均为 `FLYWAY_LOG_READ_FAILED`。
9. 完整合法 header 声明非零 payload、实际 payload 不足，EOF 为 `FLYWAY_LOG_READ_FAILED`。
10. 合法 frame 后追加 1–7 bytes trailing garbage，全部为 `FLYWAY_LOG_READ_FAILED`。
11. stream type 为 0、3 或 255，全部拒绝为 `FLYWAY_LOG_READ_FAILED`，不得 raw passthrough。
12. 三个 reserved byte 中任一个非零，全部拒绝为 `FLYWAY_LOG_READ_FAILED`。
13. raw Dockerode logs request 阶段矩阵，所有失败只映射 `FLYWAY_LOG_READ_FAILED`，且不增加顶层 M 或本列表编号：
    - 同步 throw。
    - 异步 reject。
    - 在 `LOG_REQUEST_TIMEOUT_MILLIS` 前正常返回 Buffer。
    - 在 `LOG_REQUEST_TIMEOUT_MILLIS` 前正常返回 readable stream。
    - 永久 pending，但响应 `abortSignal` 后 reject。
    - 永久 pending 且完全忽略 `abortSignal`，仍由 timeout race settled reject。
    - timeout 后 late resolve，不得进入 `collectDockerLogs()`。
    - timeout 后 late reject，不得产生 `unhandledRejection`。
    - 每条 request timeout 路径传入的 `abortSignal` 必须存在且最终 `aborted === true`。
    - 快速成功、同步 throw 与异步 reject 后 request timer 残留均为 0。
    - 全矩阵 `unhandledRejection` 为 0；所有异步失败 Promise 在 timer、abort、late reject 或 cleanup gate 前预先观察。
    - `synthetic-secret` 在 message、cause、stack、JSON、日志、快照和 `cleanupEvidence` 的命中为 0。
14. readable 在中途触发 `error`，settled reject 且 listener/input 清理。
15. readable 只触发 `close` 而未触发 `end/error`，settled reject，不得 pending。
16. readable 永不触发 `end/error/close`，在 `LOG_READ_TIMEOUT_MILLIS` 内因 timeout settled reject。
17. raw wire bytes 在刚好 `MAX_RAW_LOG_BYTES` 可继续按其他规则判定，首个超限 byte 为 `FLYWAY_LOG_READ_FAILED`。
18. decoded payload 累计刚好 `MAX_LOG_BYTES` 可成功，首个超限 byte 为 `FLYWAY_LOG_READ_FAILED`。
19. frame 数刚好 `MAX_LOG_FRAMES` 可成功，第 `MAX_LOG_FRAMES + 1` 帧失败；大量零长度 frame 也计数。
20. parser 同步异常由边界 catch 净化为 `FLYWAY_LOG_READ_FAILED`。
21. 子场景 8–20 的每种失败都通过完整 runner 验证本次 owner container `remove` 恰好一次；其中第 13 子场景的响应 abort 与忽略 abort 两类 request timeout 都必须进入 `finally`，各自 remove 恰好一次。
22. 每种日志主失败叠加 `remove` 失败仍保留主 code；raw request timeout 与 remove 失败叠加时主 code 精确为 `FLYWAY_LOG_READ_FAILED`，`cleanupEvidence` 只含 `FLYWAY_CLEANUP_REMOVE_FAILED`，不得覆盖主错误或携带底层正文。
23. 重复清理、遗漏清理与跨 owner 清理计数均为 0。
24. `synthetic-secret` 在 message、cause、stack、JSON、日志、快照和 `cleanupEvidence` 的总命中为 0。

所有异步失败子场景必须先把目标 Promise 转换为受观察的 rejection 结果，再触发 `error`、`close`、timeout、gate 或 cleanup；测试进程的 `unhandledRejection` 计数必须为 0。

## 15. permissions.integration 测试矩阵

| ID | 主体 | 操作 | 必需结果 |
|---|---|---|---|
| P01 | bootstrap LOGIN | 创建 NOLOGIN/测试 LOGIN | 允许，仅 bootstrap 阶段 |
| P02 | 三个测试 LOGIN | rolcanlogin/rolsuper/rolcreatedb/rolcreaterole | true/false/false/false |
| P03 | 三个 NOLOGIN | rolcanlogin | false |
| P04 | 每个测试 LOGIN | 唯一角色 membership | 仅一条，INHERIT false、SET true、ADMIN false |
| P05 | platform LOGIN 未 SET ROLE | SELECT users | permission denied |
| P06 | worker LOGIN 未 SET ROLE | SELECT outbox | permission denied |
| P07 | Flyway afterConnect | current_user | `xht_flyway` |
| P08 | platform factory 每次 reserve | session/current | test LOGIN / `xht_platform` |
| P09 | worker factory 每次 reserve | session/current | test LOGIN / `xht_worker` |
| P10 | platform | users/membership/profile/binding/registration/Inbox S/I/U | 允许 |
| P11 | platform | Outbox S/I | 允许 |
| P12 | platform | durable_jobs | permission denied |
| P13 | platform | 任意业务 DELETE、DDL、history | permission denied |
| P14 | worker | channel_bindings S | 允许 |
| P15 | worker | outbox S/U、durable_jobs S/I/U | 允许 |
| P16 | worker | identity/registration/Inbox 写 | permission denied |
| P17 | worker | 任意业务 DELETE、DDL、history | permission denied |
| P18 | platform/worker | audit S/I | 允许 |
| P19 | platform/worker | audit U/D | permission denied |
| P20 | platform LOGIN | SET ROLE xht_worker | permission denied |
| P21 | worker LOGIN | SET ROLE xht_platform/xht_flyway | permission denied |
| P22 | platform/worker factory | bootstrap session_user | 命中 0 |
| P23 | 并发取得至少两条连接 | current_user | 全部为所属唯一角色 |

permissions spec 还必须在自己的 `finally` 记录并断言 worker → platform → fixture 的外层清理顺序；runner 容器不进入这条顺序，因为它已经由每个 `runFlywayCommand` 的局部 `finally` 清理。该断言不新增权限语义编号。

## 16. 实施后的文档同步

只有真实 Task 3 实施与 database integration 通过后，才同步：

- `README.md`
- `docs/00-index.md`
- `docs/architecture/runtime-topology.md`
- `docs/architecture/trust-boundaries.md`
- `docs/security/threat-model.md`
- `docs/security/security-gates.md`
- `docs/testing/strategy.md`
- `docs/testing/acceptance-gates.md`
- `docs/plans/2026-07-20-stage-1-foundation-identity-implementation-plan.md`
- 本计划
- `docs/plans/active-plan-index.md`
- `docs/plans/roadmap.md`
- `docs/status/current.md`
- `docs/status/next.md`
- `docs/status/active-work.md`
- `docs/status/progress-log.md`
- `docs/status/verification.md`

实施记录必须区分：

- 实际执行并通过的容器、迁移、权限和清理证据。
- 实际执行并失败的 RED 或环境错误。
- 未执行的共享/生产数据库、Telegram、外部连接和部署。
- 静态类型/文档检查。

## 17. 完成门禁

Task 3 只有同时满足以下条件才可从 BUILDING 转为 READY，之后仍需用户复审才能 VERIFIED。第 6/48 步终态检查已满足以下门禁，故代码现为 READY v1.5：

1. 19 个计划工程路径全部按动作存在（Create 16、Modify 3、Delete 0），额外 Task 3 工程文件 0。
2. `package.json` 与 `pnpm-lock.yaml` 哈希漂移 0；没有新增或升级依赖。
3. 两镜像真实使用精确 linux/amd64 child digest，两个容器构建路径显式 `.withPlatform(locked.platform)` 覆盖 2/2。
4. build、typecheck、unit 和两个 database integration spec 全部通过；两个 database unit spec 的 U01–U12 为 24/24。
5. U01–U12（两个 app）、M01–M17 与 P01–P23 全部有可定位测试名称和真实结果。
6. 空库 migrate、重复 migrate、validate、checksum 漂移全部符合合同。
7. 九表、外键、CHECK、唯一索引、timestamptz、Inbox 摘要和禁止字段全部符合合同。
8. bootstrap 不出现在正常 factory；三条角色链均符合 LOGIN → SET ROLE → NOLOGIN；最终实现代码块中会抛错的 `onReserveConnection` 命中 0。
9. 允许/拒绝权限矩阵无缺口；普通 app 无 DDL/history/delete 越权。
10. 五类取得 client 后的失败路径都 `release(true)` 恰好一次，`pool.connect()` 自身失败 release 0，成功路径只调用无参数 `release()`。
11. `DATABASE_CLOSE_FAILED` 在两个 app 声明并由两个 U12 直接测试；wrapper 直接 end 的同步/异步失败、handle 的并发/同步重入/成功/失败/后续调用都净化且同 Promise，真实 `pool.end()` 每场景最多一次。
12. 公开 `db` 是独立 `QueryCreator` runtime facade；本体和 `withPlugin`/`withoutPlugins`/`withSchema` 链的 `destroy`、`Symbol.asyncDispose` runtime 可访问数 0；十类 TypeScript 逃逸全部由真实 `@ts-expect-error` 消费，CRUD builder 正向能力通过。
13. M15/M16 的 24 个具名子场景全部通过：raw request 的同步 throw、异步 reject、Buffer/stream 成功、响应 abort、忽略 abort、timeout 后 late resolve/reject 都按既有第 13 子场景验证；每条 timeout 路径 `abortSignal` 存在且最终 aborted，request timer 残留 0。严格 parser 对 header/payload/EOF/type/reserved/raw、close-before-end、stream timeout、同步异常和三类限制默认拒绝；Buffer/stream 真空日志、正常 stdout/stderr 与所有刚好边界成功；stdout、stderr、frame-order 三路 Secret 扫描能捕获同通道跨 frame 且被另一通道穿插的密码；所有异步 rejection 预先观察，unhandled rejection 0。
14. Flyway 环境固定 `REDGATE_DISABLE_TELEMETRY: 'true'`；telemetry email/token/license/pipeline/collector、Flyway 密码泄露和真实 Secret 均为 0。
15. app handle、Flyway one-shot、fixture 内部资源和 TEMP 各自只有一个 owner；Flyway 每次 label 唯一且非 Secret，有/无 started handle、每一种日志失败及响应/忽略 abort 的 raw request timeout 都由当前调用进入 `finally` 并 remove 恰好一次，重复/遗漏/跨 owner 清理 0；request timeout 叠加 cleanup 失败仍保留 `FLYWAY_LOG_READ_FAILED`，`cleanupEvidence` 只含稳定 `FLYWAY_CLEANUP_REMOVE_FAILED`。
16. 容器、network、pool 和系统 TEMP 残留 0。
17. 文档、索引、current、next、active-work、verification、progress-log 与真实结果一致。

## 18. 失败停止条件

发生以下任一情况立即停止 Task 3，保持代码 `BUILDING` 或转 `BLOCKED`，不得进入 Task 4：

- 任一 tag、manifest-list 或 linux/amd64 child digest 无法重新确认。
- Docker Desktop 不是 linux/amd64 或无法按 child digest运行。
- lifecycle script、依赖或 lockfile 发生未授权变化。
- bootstrap LOGIN 出现在 Flyway/platform/worker 正常连接路径。
- 任一 app 角色获得 DDL、history、DELETE 或未列出的对象权限。
- Inbox 出现原始 Update、正文、callback、start parameter 或支付密码列。
- 出现资金、余额、账本、钱包、地址、链或 market 对象/字段。
- Flyway 密码进入命令、日志、异常、快照或报告。
- Flyway 未显式禁用 Redgate telemetry，或出现 telemetry email/token/license/pipeline/collector 配置。
- 任一取得 client 后的角色门禁失败未恰好调用一次 `release(true)`，或成功 client 被错误销毁。
- close 存在同步重入窗口、重复 `pool.end()`、失败不粘滞或泄露底层错误正文。
- wrapper `end()` 的同步/异步失败任一路径向 deferred 写入底层错误；公开 `db` 不是独立 QueryCreator runtime facade；facade 本体或安全链重新出现 `destroy`、`Symbol.asyncDispose`、connection 或完整 Kysely 能力。
- PostgreSQL/Flyway 任一构建路径缺少 `.withPlatform(locked.platform)`。
- 同一资源出现多个 owner、重复清理或无人清理。
- Flyway 使用内置 one-shot 的非零退出 FAIL 语义、只靠 started handle finally、只查询 running 容器、依赖 Ryuk/进程退出，或 label 查询可能跨 owner。
- Flyway 使用 Testcontainers 公共 logs wrapper 或 `docker-modem.demuxStream()` 作为完整性依据；任一 incomplete header/payload、trailing garbage、非法 type/reserved、raw/Tty、stream error、close-before-end、timeout、同步 parser 异常或 raw/payload/frame 超限被误报为空日志成功；stdout/stderr/frame-order 未分别聚合；同通道跨 frame 密码因另一通道穿插而漏检；日志失败仍产生 `passwordLeakCount: 0`。
- raw Dockerode logs 请求没有同时具备 `LOG_REQUEST_TIMEOUT_MILLIS=5_000`、`AbortController.signal` 与显式 timeout Promise race；request timeout 未调用 abort；忽略 abort 的永久 Promise 仍能阻止 `finally`；快速/超时/late settle 留下 timer 或 `unhandledRejection`；request timeout 后仍进入 stream parser。
- Flyway 清理错误覆盖原 migrate/validate/日志/inspect/Secret 失败类别，或清理证据携带底层正文、environment、日志、密码。
- checksum 漂移未被 validate 拒绝。
- 任一失败后 pool、Flyway 容器、PostgreSQL 容器、network 或系统 TEMP 未清理。
- database integration 不是由真实 PostgreSQL/Testcontainers 执行。

## 19. 自审记录

- 用户要求的原始计划主题与 T3R-01–T3R-12 均映射到第 1–18 节及本次交付门禁。
- 工程文件映射固定 19：Create 16、Modify 3、Delete 0。
- TypeScript 合同、函数名称、输入、输出和错误码均有唯一定义。
- `RoleEnforcingPostgresPool` 与 deferred close 的最终代码主体只有一份权威定义；两个 app 的精确角色文件头/导出文件尾分别定义。
- PostgreSQL LOGIN/NOLOGIN、SET ROLE、Flyway history 和四主体权限矩阵完整。
- U01–U12、M01–M17、P01–P23 覆盖成功、拒绝、漂移、泄露和清理；编号数量不因 v1.5 增加，M15/M16 内既有 24 个具名子场景保持，并把 T3R-12 request 矩阵嵌入第 13/21/22 子场景。
- Windows 使用 copy-to-container；bind mount 使用数必须为 0。
- 计划中的镜像引用均为精确 tag 加真实 linux/amd64 child digest，PostgreSQL/Flyway 显式平台构建路径为 2/2。
- Flyway telemetry 固定关闭；raw Dockerode request 由独立 5 秒 timeout、abort signal 与显式 race 限界，成功返回后再由独立 5 秒 stream timeout 和严格有界 frame parser 验证完整性；三路聚合阻断跨通道穿插漏检，资源 owner 唯一，非零 ExitCode 在 handle 返回后解释，无 handle 以唯一 label 回收；`DATABASE_CLOSE_FAILED` 在 wrapper 与 handle 两层直接测试，QueryCreator facade 的运行时与类型逃逸为 0。
- 当前已完成真实工程实施、镜像/容器、PostgreSQL/Flyway、unit 与 database integration；详细通过、失败后纠正和未执行边界见 [verification.md](../status/verification.md)。

## 20. Execution Handoff

Task 3 已在第 6/48 步按本计划完成 19 个工程路径和真实本地验证；最终外部复审 `PASS`，T3R-13 已关闭，详细计划、代码与测试为 `VERIFIED v1.5`，未解决阻断 0。临时工程、镜像、Docker 和数据库授权已消费并归零。

当前仍为第 7/48 步。Task 4 外部复审仍为 NOT_APPROVED / WAITING_EXTERNAL_REVIEW；T4R-16～T4R-27 的适用修订为 RESOLVED_IN_PLAN / WAITING_EXTERNAL_REVIEW。[Task 4 独立详细计划 v1.10 / LAYOUT-S1](task-4-unit-of-work/00-index.md) 保持 READY v1.10，文档布局 LAYOUT-S1 VERIFIED，等待用户重新外部复审。Task 4 代码 NOT_STARTED；唯一下一步是等待用户重新外部复审 Task 4 v1.10 / LAYOUT-S1，未经新授权不得进入第 8/48 步或实施 Task 4。
