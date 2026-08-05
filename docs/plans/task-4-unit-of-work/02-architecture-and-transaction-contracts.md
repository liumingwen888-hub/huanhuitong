# Architecture and transaction contracts

[← Task 4 LAYOUT-S1 index](00-index.md)

> Frozen technical plan: v1.9. Layout navigation is new; transaction and error contracts below retain their v11 meaning.

## 0. 第九次外部复审修订裁决

- 外部复审结论：`NOT_APPROVED / WAITING_EXTERNAL_REVIEW`。
- T4R-16：`RESOLVED_IN_PLAN / WAITING_EXTERNAL_REVIEW`。
- T4R-17：`RESOLVED_IN_PLAN / WAITING_EXTERNAL_REVIEW`，五文件唯一来源与 Step 62 不倒退。
- T4R-18：`RESOLVED_IN_PLAN / WAITING_EXTERNAL_REVIEW`，TypeScript/Kysely/pg 类型边界不倒退。
- T4R-19：`RESOLVED_IN_PLAN / WAITING_EXTERNAL_REVIEW`，测试与过滤器闭环不倒退。

## 2. Task 3 真实接口基线

- `StageOneDatabase` 来自 `@xht/contracts`；callback 数据库面继续以 Kysely `QueryCreator<StageOneDatabase>` 为查询构造 facade。
- UnitOfWork 的 owner 是内部 `Kysely<StageOneDatabase>`，使用其真实 `QueryExecutor.provideConnection` 和 `SingleConnectionProvider` 固定单连接。
- `RoleEnforcingPostgresPool` 是 Kysely PostgreSQL dialect 的唯一 pool wrapper；未来修改仍保留 Task 3 session/current role 验证、sticky close 与公开 facade 隔离。
- 真实数据库证据继续使用 `@xht/testing` 的 `startPostgresFixture` 与 `migrateAndValidate`；本第 7 步没有运行它们。

## 3. 锁定 API 调查与可行性

- `pg 8.22.0` 运行时 `Query` 构造函数读取 `config.queryMode`，且 `requiresPreparation()` 对 `queryMode === "extended"` 返回 true。当前 `@types/pg 8.20.0` 的 `QueryConfig` 没有该字段，因此 v1.9 延续具名 `ExtendedQueryConfig` 精确扩展运行时形状，不使用 `any` 或忽略诊断。
- Kysely 0.29.4 `PostgresPoolClient.query` 只声明 string/parameters 与 cursor 两组重载；v1.9 raw client 结构同时声明这两组和具名 extended-config 重载，wrapper 对外仍精确实现 Kysely 两组重载。
- Kysely 0.29.4 `DatabaseConnection` 要求 `executeQuery` 与 `streamQuery`；`CallbackConnection` 两者均在委托前调用同一扫描器。
- `QueryCreator` 没有公开 `getExecutor`，所以 callback 的顶层 raw SQL 通过 `TransactionContext.executeSql` 的窄受保护通道进入 `CallbackConnection`；它不暴露 pool、raw client、connection 或 executor。

## 4. 生命周期与禁止逃逸合同

- `TransactionContext` 仅公开 `database` 和受保护 `executeSql`；callback settle 后先撤销 QueryCreator executor lease 和 SQL channel lease，再 probe/commit/rollback。
- 逃逸的 context、database、builder、plugin derivative 或 `executeSql` 在 callback settle 后均拒绝为固定 `TRANSACTION_CONTEXT_CLOSED`，不得发送 SQL。
- callback 内嵌套 `execute` 在取得第二连接前拒绝；独立并发 outer execute 各有自己的 AsyncLocalStorage marker 和连接。

## 6. 安全错误合同

三类 callback-safe error 及 UnitOfWork/TransactionContext 内部错误均使用模块私有 WeakSet 身份、精确 prototype、冻结实例、固定不可写脱敏 stack 和递归公开字段门禁。`Object.create`、`Reflect.set`、`Reflect.defineProperty`、伪造 prototype/instanceof/frozen 对象不能取得安全品牌。原始 pg message/detail/constraint/sql/parameters/user/connectionString/password 不进入公开错误。

## T4R routing

- T4R-16: callback/private connection separation and no partial multi-statement execution.
- T4R-17: one source of truth and 5/5 byte identity.
- T4R-18: locked TypeScript/Kysely/pg type boundary.
- T4R-19: executable test/filter closure.
- T4R-20–T4R-24: [callback SQL policy](03-callback-sql-policy.md).

All T4R-16–T4R-24 remain `RESOLVED_IN_PLAN / WAITING_EXTERNAL_REVIEW`, not external ACCEPT.
