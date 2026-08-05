# 阶段 1 Task 2 配置、结构化日志和 OpenTelemetry 基础 Implementation Plan

> **For future readers:** 第 4/48 步 Task 2 v1.2.6 同步重入修复已完成，第 5/48 步用户最终复审 PASS、R5-01 ACCEPT，并以新鲜本地复核正式验收。子代理、Git、worktree、外部网络和生产连接始终未授权。

计划版本：`v1.2.6`。原计划日期：`2026-07-21`。外部复审修订日期：`2026-07-23`。计划状态：`VERIFIED`。Task 2 代码与测试状态：`VERIFIED`。

## 第 5/48 步最终验收（2026-07-23）

- 用户最终复审：`PASS`；R5-01：`ACCEPT`。
- 第 5 步新鲜复核：Node `v24.18.0`、pnpm `11.15.1`、既有 ZIP/报告哈希、clean build、telemetry 2/2 文件 14/14、typecheck、unit 7/7 文件 108/108、三包导入 3/3 全部通过。
- Task 2 从 `READY v1.2.6` 正式转为 `VERIFIED`。本节只更新当前验收事实；下方 READY/等待复审文字均保留为第 4 步历史施工记录。
- Task 2 源码、测试、manifest、依赖和 lockfile 在本次验收中均未修改；Task 3 工程文件创建数为 0。

**Goal:** 在不增加依赖、不读取真实 Secret、不连接 collector 的前提下，为 platform 与 worker 建立运行时严格配置、短期 Secret 解析、Inbox digest keyring、安全结构化日志和可注入 OpenTelemetry 边界。

**Architecture:** `packages/config` 拥有运行时解析与安全策略，`packages/contracts` 只拥有跨工作区观测合同；platform/worker 各自实现 Pino 与 OpenTelemetry 适配，不互相导入。SecretReference 只负责语法和品牌化类型，SecretResolver 只负责受控解析、路径约束、生命周期和清零；keyring 只在请求作用域短期存在并隐藏 key material。

**Tech Stack:** Node.js `24.18.0`、pnpm `11.15.1`、TypeScript `7.0.2` strict、Zod `4.4.3`、Pino `10.3.1`、`@opentelemetry/api` `1.9.1`、Vitest `4.1.10`。只能使用当前 lockfile 已有精确依赖。

## 历史：第 4 步 v1.2.4 首轮实施授权补充（2026-07-23）

本小节只记录当时 v1.2.4 首轮实施的授权与事实，不是当前施工规则；当前规则由后续 v1.2.5 与 v1.2.6 修订段覆盖。下列历史内容保留原意，不得被解释为限制或取消后续已明确授权的修复。

- 用户已明确授权第 4/48 步在当前非 Git 项目根目录一次性实施 Subtask 2.1–2.6；Task 2 代码由 `NOT_STARTED` 转为 `BUILDING`。
- 工程写集合保持 Planned File Map 的 18 个路径不变：Create 16、Modify 2；不得修改依赖、lockfile、Task 1 其他工程文件或创建 Task 3–14 工程文件。
- 为履行持续文档同步合同，本轮合法 Markdown 写集合扩展为 17 份：`README.md`、`docs/00-index.md`、`docs/architecture/runtime-topology.md`、`docs/governance/ai-handoff.md`、`docs/governance/state-model.md`、`docs/operations/observability.md`、阶段 1 主计划、本计划、`docs/plans/active-plan-index.md`、`docs/plans/roadmap.md`、`docs/security/threat-model.md`、`docs/status/current.md`、`docs/status/next.md`、`docs/status/active-work.md`、`docs/status/progress-log.md`、`docs/status/verification.md`、`docs/testing/strategy.md`。
- 本补充在当时不创建 v1.2.5，不改变 v1.2.4 的业务接口、权威代码块、测试或 18 个工程文件映射；该历史时点的计划状态继续为 `READY v1.2.4`。
- Git、worktree、子代理、容器、数据库、Flyway、Testcontainers、Telegram、collector、其他业务外部服务、真实 Secret、部署和 Tasks 3–14 授权仍为 0。计划中与当前授权或最终状态冲突的历史 handoff 文字由本补充及用户当前指令覆盖。
- 第 4/48 步已完成 Subtask 2.1–2.6，代码与验证门禁通过；本轮授权已消费并归零。唯一下一步是等待用户审查实现包和证据，不得自动进入 Task 3。

## v1.2.5 外部复审修复授权补充（2026-07-23）

- 本轮仍是第 4/48 步，不进入第 5 步，不实施 Task 3。Task 2 计划升级为 `READY v1.2.5`；修复开始前代码由 `READY` 降为 `BUILDING`，只有最终门禁全部通过后才可恢复 `READY（等待用户复审）`，不得标记 `VERIFIED`。
- 工程写集合收窄为 6 个既有路径：两个 telemetry factory、两个 telemetry unit spec、`packages/config/src/secret-reference.ts` 和 `packages/config/test/environment.spec.ts`。新增工程文件、删除工程文件、依赖、版本、package manifest、lockfile 和 Tasks 3–14 工程路径写入均为 0。
- R4-01 `ACCEPT`：platform/worker 当前第二个并发 `shutdown()` 在 exporter 仍 pending 时提前成功；失败时只有首个调用拒绝，第二个并发调用与第三次调用错误成功。两个实现必须缓存同一个 shutdown Promise：开始即关闭 `startSpan`，exporter shutdown 最多一次，并发调用共享 pending/fulfilled/rejected 结果，失败持续映射为脱敏的 `EXPORTER_SHUTDOWN_FAILED`。
- R4-02 `ACCEPT`：当前 `file:///C:/ProgramData/HuanHuiTong/secrets/key` 以 `INVALID_FILE_REFERENCE` 拒绝，而 POSIX canonical reference 接受。只允许第一个路径段使用精确 `[A-Za-z]:` drive 形式，且必须至少再有一个安全路径段；所有既有 host、凭据、dot/dotdot、空段、反斜杠、百分号、query、fragment、控制字符和 canonical URL 门禁保持不变。文件读取只用注入 resolver 证明，不访问真实 Secret 文件。
- R4-03 `ACCEPT`：`active-work.md` 的“本轮计划新建工程文件实际创建数为 0”已不是当前事实；阶段主计划 Task 2 摘要仍写 `NOT_STARTED` 与实现授权 0。只修正当前事实，不改写明确标记为 v1.2.3/v1.2.4 TEMP 或计划阶段的历史记录。
- 计划与代码采用 TDD：先写 platform/worker 并发成功、并发失败、第三次失败粘滞、shutdown 最多一次、无提前成功、错误正文零泄露和 shutdown 开始后 `startSpan` 关闭测试，以及 Windows/POSIX canonical reference 与 Windows 负向边界测试；确认 RED 原因后再写最小实现。
- 最终验证必须从删除五个 `dist` 开始，依次运行 offline/frozen/ignore-scripts install、build、三个聚焦测试文件、typecheck、完整 unit、platform 三包 import、第二次 offline frozen install，并证明 lockfile hash 漂移 0、failed/skipped/only/retry 0、网络/外部/Git 写入/Task 3 路径/Secret 泄露 0。

## v1.2.6 同步重入修复授权补充（2026-07-23）

- 本轮仍是第 4/48 步，不进入第 5 步，不规划或实施 Task 3。R5-01 经当前真实 dist 独立复现为 platform/worker 均 `calls=2`、`samePromise=false`、`laterSame=true`，裁决 `ACCEPT`。
- 修复开始时 Task 2 从 `READY v1.2.5` 转为 `BUILDING（v1.2.6 同步重入修复）`；只有 RED、最小修复、完整验证、文档和交付物全部闭环后，才可恢复 `READY v1.2.6（等待用户最终复审）`，不得标记 `VERIFIED`。
- 工程写集合精确收窄为 4 个既有路径：两个 telemetry factory 与两个 telemetry unit spec。工程修改 4、新建 0、删除 0；packages/config、contracts、logger、keyring、manifest、lockfile、Task 1 其他工程文件和 Tasks 3–14 工程路径均禁止写入。
- TDD RED 只修改两份 telemetry spec：同步重入成功与失败场景必须在旧 v1.2.5 上证明 exporter shutdown 被调用两次或 Promise 不同一；生产实现不得在观察到有效 RED 前修改。
- 最小实现必须在 exporter shutdown 真正开始前缓存 Promise。platform/worker 保持同构；普通并发、同步重入和后续调用共享同一成功或失败 Promise；exporter 最多一次；失败映射保持 `EXPORTER_SHUTDOWN_FAILED` 且不泄露原始正文；shutdown 开始后 `startSpan` 立即拒绝 `TELEMETRY_CLOSED`。
- 最终验证必须严格使用 offline/frozen/ignore-scripts，执行 clean build、两个 telemetry 聚焦文件、typecheck、完整 unit、platform 三包真实导入、第二次 offline install、独立同步重入成功/失败运行时用例，以及 lockfile/package.json/范围/安全/文档/交付物门禁。
- Git（包括只读探针）、worktree、子代理、新依赖、升级、lifecycle、audit、architecture、test:all、数据库、integration、容器、Flyway、Testcontainers、Telegram、collector、外部网络、真实 Secret、部署和 Tasks 3–14 均为 `NOT_AUTHORIZED`。

## Global Constraints

- 本文件是 Task 2 的完整实施权威；阶段 1 主计划只保存摘要并链接到本文件。
- Task 2 实现授权已消费并闭环，当前为 0；代码 READY 也不推导出新的代码、依赖、Git、网络或部署授权。
- 不创建真实 Secret、`.env`、collector 连接、HTTP/DNS/socket 请求或 exporter 实现。
- 所有跨工作区 import 必须使用 `@xht/contracts`、`@xht/config`、`@xht/testing` 的真实 package export，不得使用跨包相对路径。
- `SecretReference` 必须经运行时解析后才可构造；`AppEnvironment` 的三个 Secret 字段必须保持 `SecretReference`，不能退化为 `string`。
- `env://` 只接受大写环境变量名；`file://` 必须在 URL 解析前检查原始路径段，只接受无 host、无凭据、无 query/hash、无百分号编码、无反斜杠、无空中间段、无 `.`/`..` 段的绝对文件 URL。
- file Secret 的真实路径必须位于显式允许根目录内；symlink 解析后越界必须拒绝。
- 单个 Secret 长度为 1–65536 bytes；解析结果在 `dispose()` 时清零，resolver 关闭后拒绝新解析。
- Inbox digest key material 使用无 padding canonical base64url，长度为 32–64 bytes；版本格式为 `v[1-9][0-9]{0,8}`。每个 material 只创建一个受管理解码 Buffer；canonical 检查在该 Buffer 上直接编码，不复制原始 key bytes。
- keyring 必须恰有一个 current；版本、material 唯一；current 版本高于 retained；版本顺序与激活顺序一致；current 已在注入 `now` 生效；retained 的 `activatedAt <= retainedAt <= current.activatedAt <= now`，且 `retireNotBefore` 不早于 `retainedAt + inboxRetentionSeconds + telegramRetryWindowSeconds`。
- `now` 必须是有效 Date；retention/retry 必须是各自配置范围内的安全整数。允许上界之和为 `7_776_000 + 604_800 = 8_380_800` 秒，乘以 1000 为 `8_380_800_000`，严格小于 `Number.MAX_SAFE_INTEGER`；因此通过范围门禁后的求和与毫秒换算必然安全，不保留不可达 overflow 错误码。无效时间、未来时间、非整数、负数、Infinity 或 NaN 只返回稳定错误码。
- keyring 公共时间元数据使用 canonical RFC3339 字符串，不暴露可变 Date；current、retained 数组、key 对象与 keyring 对象在运行时冻结。内部 material 永不直出；每次 `withMaterial` 只创建一个借用 Buffer，并在 consumer 返回或抛错后的 `finally` 中立即清零。
- raw keyring JSON、key material、resolved Secret、完整 Update、canonical bytes、digest 不得进入序列化、日志、trace、错误正文或快照；错误只暴露稳定分类码。
- SafeLogger 只接受本文件列出的 event、字段和值域；运行时拒绝 unknown key、嵌套对象、数组、Error、非有限数字、过长字符串和控制字符。
- Pino destination 必须注入，测试只读取内存 Writable 输出。
- disabled telemetry 不注册 exporter、不调用 exporter factory，也不触发 `fetch`、`http`、`https`、`net` 或 `dns`。
- otlp 模式只调用注入的 `OtlpExporterFactory.register`；Task 2 不提供真实 factory，不连接 collector。
- 每次跨工作区测试前先删除五个生成 `dist`，再执行 `pnpm build`；不依赖上轮构建产物。
- Git 检查点始终记录为 `NOT_AUTHORIZED`，不得执行。

## v1.2.3 Task 2 计划复审裁决（2026-07-23）

| 编号 | 裁决 | 磁盘证据 | v1.2.3 处理 |
|---|---|---|---|
| R2-01 | ACCEPT | v1.2.2 `decodeMaterial` 先 `Uint8Array.from(Buffer.from(...))`，canonical 检查又 `Buffer.from(bytes)`，存在无法统一追踪的原始 key 副本。 | 改为单一受管理 Buffer；直接 `bytes.toString('base64url')`；所有 canonical、长度和后续失败路径清零。 |
| R2-02 | ACCEPT | `KeyMaterial.use` 直接把内部 `#bytes` 交给 consumer；Date、retained 数组和运行时对象仅有 TypeScript readonly。 | `withMaterial` 每次创建一个借用 Buffer 并 finally 清零；内部 material 永不直出；时间改为 RFC3339 字符串；key、数组和 keyring 运行时冻结；dispose 幂等。 |
| R2-03 | ACCEPT | v1.2.2 未验证无效 `now`、策略安全整数/范围/溢出、current 未来生效、retainedAt 晚于 current、版本与激活顺序冲突。 | 增加稳定错误码、完整时间/策略验证和对应负向测试。 |
| R2-04 | ACCEPT | v1.2.2 主要证明成功路径 raw bytes dispose，未完整覆盖 consumer 异常、UTF-8/JSON/schema 与多 key 后项失败的清零。 | 增加同步抛错、异步 reject、三类解析失败、canonical/长度、后项失败和错误/inspect/快照零泄露测试。 |
| R2-05 | ACCEPT | v1.2.2 仅按 event 限制字段名，route/outcome 仍使用全局集合，且未检查必填字段。 | 建立六事件精确 policy matrix；route/outcome 固定、必填/可选明确；任何错配抛 `SafeLoggingError` 且 destination 写入 0。 |
| R2-06 | ACCEPT | platform/worker telemetry 直接传播 register/shutdown 原始异常。 | 增加 registration/shutdown 稳定错误码并丢弃 cause 正文；两进程均以 `synthetic-secret` 反向测试证明不泄露。 |
| R2-07 | ACCEPT | 阶段主计划 Task 5 使用 `key.material`；Task 11 把 `ResolvedSecret` 直接传给 HMAC，使用未定义日志事件/字段，并对非法日志缺少抛错断言。 | 主计划同步改为 `withMaterial`/`withResolvedSecret`，补充 contracts 写集合与完整日志合同，非法日志统一抛错且零写入；全阶段旧接口扫描为完成门禁。 |

裁决计数：ACCEPT 7，PARTIAL_ACCEPT 0，REJECT 0。

## v1.2.4 最终可执行性复审裁决（2026-07-23）

| 编号 | 裁决 | v1.2.3 真实复现证据 | v1.2.4 处理 |
|---|---|---|---|
| E3-01 | ACCEPT | TEMP 工程运行 keyring Vitest 时在收集阶段 `ReferenceError: afterEach is not defined`，0 tests、exit 1；同文件还使用 `vi`。 | 导入改为 `afterEach, describe, expect, it, vi`，并以真实 Vitest 聚焦测试和完整 unit 验证。 |
| E3-02 | ACCEPT | TEMP 工程 `pnpm build` exit 2，真实出现 TS2420、TS2416、TS2322；根因是接口可选属性与构造参数属性在 `exactOptionalPropertyTypes: true` 下不兼容。 | 两个公共属性与构造参数均改为必有属性、值为 `string \| undefined`；status 继续决定 current/retained 语义。 |
| E3-03 | ACCEPT | TEMP 中 `file:///run/secrets/../private` 未抛错，环境测试 27 项中 2 项失败；URL 构造在检查前吞掉原始 `..`。另发现 POSIX file URL 在 Windows TEMP 的 resolver 测试不能直接转成本机绝对路径。 | URL 解析前检查所有原始段；保留 host、反斜杠、百分号、query、fragment 等拒绝；resolver 增加仅用于平台适配/测试注入的 `fileUrlToPath`，生产默认仍用 Node `fileURLToPath`。 |
| E3-04 | ACCEPT | v1.2.3 声明/实现 22 个 keyring 错误码，直接测试引用 19 个；缺口恰为 `INVALID_ACTIVATION_ORDER`、`POLICY_WINDOW_OVERFLOW`、`RETAINED_NOT_ACTIVE`。 | 删除两个不可达错误码/分支；增加 `INVALID_ACTIVATION_ORDER` 直接负向测试和策略最小/最大正向边界测试；重新做实现错误码与直接测试集合对照。 |

裁决计数：ACCEPT 4，PARTIAL_ACCEPT 0，REJECT 0。v1.2.3 的 Node 语法检查只能证明语法可解析，不能证明 TypeScript 类型、Vitest 名称解析和运行时安全测试可执行；v1.2.4 使用完整 TEMP 工程构建和测试补齐该门禁。

v1.2.4 最终 TEMP 验证使用 Node `v24.18.0`、pnpm `11.15.1`：frozen/ignore-scripts install exit 0，clean build exit 0，六个指定测试文件 6/6、95/95 通过，typecheck exit 0，完整 unit project 7/7、96/96 通过；failed、skipped、only、retry 均为 0。20 个声明、实现抛出和测试直接引用的 keyring 稳定错误码集合完全相等；不可达稳定错误码 0。lockfile SHA-256 保持 `EE1F63DBFC72897F3483E9D6E96545801873988EA3E7EE15FCFB27C1E42AD9BC`，漂移 0。该证据只来自已清理的一次性 TEMP 副本，不表示 Task 2 代码已写入真实项目。

## Planned File Map

| 动作 | 精确路径 | 单一职责 |
|---|---|---|
| Create | `packages/contracts/src/observability.ts` | 日志与 telemetry 跨工作区合同 |
| Modify | `packages/contracts/src/index.ts` | 只导出观测合同 |
| Create | `packages/config/src/secret-reference.ts` | Secret reference 语法、品牌类型与解析错误 |
| Create | `packages/config/src/secret-resolver.ts` | env/file 受控解析、路径门禁、生命周期与清零 |
| Create | `packages/config/src/environment.ts` | 已知键投影、Zod strict、数值边界与 OTLP 配置 |
| Create | `packages/config/src/inbox-digest-keyring.ts` | keyring schema、轮换门禁、material 生命周期与禁止序列化 |
| Create | `packages/config/src/logging-policy.ts` | event/字段/值运行时白名单与错误分类 |
| Modify | `packages/config/src/index.ts` | 只导出 Task 2 公共 API |
| Create | `packages/config/test/environment.spec.ts` | 环境、reference、resolver 正反测试 |
| Create | `packages/config/test/inbox-digest-keyring.spec.ts` | keyring 正向、反向、轮换、清零和序列化测试 |
| Create | `apps/platform/src/infrastructure/logging/create-platform-logger.ts` | platform Pino 安全适配 |
| Create | `apps/platform/src/infrastructure/telemetry/create-platform-telemetry.ts` | platform OTel API 与 exporter 注入边界 |
| Create | `apps/worker/src/infrastructure/logging/create-worker-logger.ts` | worker Pino 安全适配 |
| Create | `apps/worker/src/infrastructure/telemetry/create-worker-telemetry.ts` | worker OTel API 与 exporter 注入边界 |
| Create | `apps/platform/test/unit/logger.spec.ts` | platform 日志输出与拒绝路径 |
| Create | `apps/platform/test/unit/telemetry.spec.ts` | platform disabled/otlp/零网络测试 |
| Create | `apps/worker/test/unit/logger.spec.ts` | worker 日志输出与拒绝路径 |
| Create | `apps/worker/test/unit/telemetry.spec.ts` | worker disabled/otlp/零网络测试 |
| Modify | `docs/architecture/runtime-topology.md` | 实际 Task 2 配置与进程适配状态 |
| Modify | `docs/operations/observability.md` | 实际白名单、disabled/otlp 边界与验证 |
| Modify | `docs/security/threat-model.md` | Secret/keyring/log/trace 控制与残余风险 |
| Modify | `docs/status/current.md` | Task 2 最终实现状态与授权 |
| Modify | `docs/status/next.md` | 唯一下一步 |
| Modify | `docs/status/active-work.md` | Task 2 范围、排除项和实际结果 |
| Modify | `docs/status/verification.md` | 命令、通过、失败、未执行和静态证据 |
| Modify | `docs/status/progress-log.md` | 状态转换和授权消费 |
| Modify | `docs/00-index.md` | Task 2 计划与实现摘要导航 |

---

### Subtask 2.1: 观测合同

**Files:**
- Create: `packages/contracts/src/observability.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Produces: `SafeLogger`、`SafeLogEvent`、`SafeLogContext`、`TelemetryConfig`、`TelemetryHandle`、`OtlpExporterFactory`。
- Consumes: 无其他 Task 2 类型。

- [x] **Step 1: 写合同文件**

```ts
// packages/contracts/src/observability.ts
export type ApplicationServiceName = 'xht-platform' | 'xht-worker';

export type SafeLogEvent =
  | 'app_configuration_loaded'
  | 'app_configuration_rejected'
  | 'telemetry_disabled'
  | 'telemetry_configured'
  | 'process_started'
  | 'process_stopped';

export type SafeLogErrorCategory =
  | 'configuration_invalid'
  | 'secret_reference_invalid'
  | 'secret_resolution_failed'
  | 'telemetry_initialization_failed'
  | 'invalid_log_entry';

export interface SafeLogContext {
  readonly correlation_id?: string;
  readonly route?: 'bootstrap' | 'configuration' | 'telemetry';
  readonly outcome?: 'success' | 'rejected' | 'disabled' | 'configured' | 'stopped';
  readonly error_category?: SafeLogErrorCategory;
  readonly duration_ms?: number;
}

export interface SafeLogger {
  info(event: SafeLogEvent, context?: SafeLogContext): void;
  warn(event: SafeLogEvent, context?: SafeLogContext): void;
  error(event: SafeLogEvent, context?: SafeLogContext): void;
}

export type TelemetryConfig =
  | { readonly mode: 'disabled' }
  | { readonly mode: 'otlp'; readonly endpoint: string };

export type TelemetrySpanName =
  | 'process.bootstrap'
  | 'configuration.parse'
  | 'telemetry.initialize';

export interface TelemetrySpanHandle {
  end(): void;
}

export interface TelemetryHandle {
  readonly enabled: boolean;
  readonly serviceName: ApplicationServiceName;
  startSpan(name: TelemetrySpanName): TelemetrySpanHandle;
  shutdown(): Promise<void>;
}

export interface OtlpExporterRegistration {
  shutdown(): Promise<void>;
}

export interface OtlpExporterFactory {
  register(input: {
    readonly serviceName: ApplicationServiceName;
    readonly endpoint: string;
  }): Promise<OtlpExporterRegistration>;
}

export type TelemetryConfigurationErrorCode =
  | 'EXPORTER_FACTORY_REQUIRED'
  | 'EXPORTER_REGISTRATION_FAILED'
  | 'EXPORTER_SHUTDOWN_FAILED'
  | 'TELEMETRY_CLOSED';

export class TelemetryConfigurationError extends Error {
  public constructor(public readonly code: TelemetryConfigurationErrorCode) {
    super(code);
    this.name = 'TelemetryConfigurationError';
  }
}
```

```ts
// packages/contracts/src/index.ts
export const contractPackageName = '@xht/contracts' as const;
export * from './observability.js';
```

- [x] **Step 2: 构建合同包**

Run:

```powershell
node --input-type=module -e "import { rm } from 'node:fs/promises'; await Promise.all(['apps/platform/dist','apps/worker/dist','packages/contracts/dist','packages/config/dist','packages/testing/dist'].map(path => rm(path,{recursive:true,force:true})))"
pnpm build
```

Expected: 五个 workspace build exit 0；`packages/contracts/dist/observability.js` 与 `.d.ts` 由 TypeScript 生成；lockfile 不变。

- [ ] **Step 3: Git 检查点**

`NOT_AUTHORIZED`。不运行 `git add` 或 `git commit`。

---

### Subtask 2.2: SecretReference、SecretResolver 与 AppEnvironment

**Files:**
- Create: `packages/config/test/environment.spec.ts`
- Create: `packages/config/src/secret-reference.ts`
- Create: `packages/config/src/secret-resolver.ts`
- Create: `packages/config/src/environment.ts`
- Modify: `packages/config/src/index.ts`

**Interfaces:**
- Consumes: Node `ProcessEnv`、注入的 file reader/realpath、Zod。
- Produces: `SecretReference`、`parseSecretReference`、`SecretResolver`、`ResolvedSecret`、`createSecretResolver`、`withResolvedSecret`、`AppEnvironment`、`parseEnvironment`。

- [x] **Step 1: 写完整红灯测试**

```ts
// packages/config/test/environment.spec.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import {
  SecretReferenceError,
  SecretResolutionError,
  createSecretResolver,
  parseEnvironment,
  parseSecretReference,
  withResolvedSecret
} from '../src/index.js';

const validEnvironment = {
  NODE_ENV: 'test',
  DATABASE_URL_REF: 'env://XHT_TEST_DATABASE_URL',
  TELEGRAM_WEBHOOK_SECRET_REF: 'env://XHT_TEST_TELEGRAM_WEBHOOK_SECRET',
  INBOX_DIGEST_KEYRING_REF: 'file:///run/secrets/xht/inbox-keyring.json',
  INBOX_RETENTION_SECONDS: '2592000',
  TELEGRAM_RETRY_WINDOW_SECONDS: '86400',
  OTEL_EXPORTER: 'disabled'
} as const;

const syntheticRoot = path.resolve('synthetic-secret-root');

describe('parseEnvironment', () => {
  it('projects known keys before strict parsing and preserves branded references', () => {
    const parsed = parseEnvironment({ ...validEnvironment, PATH: 'ignored', SYSTEMROOT: 'ignored' });
    expect(parsed.nodeEnv).toBe('test');
    expect(parsed.databaseUrlRef).toBe('env://XHT_TEST_DATABASE_URL');
    expect(parsed.telegramWebhookSecretRef).toBe('env://XHT_TEST_TELEGRAM_WEBHOOK_SECRET');
    expect(parsed.inboxDigestKeyringRef).toBe('file:///run/secrets/xht/inbox-keyring.json');
    expect(parsed.otel).toEqual({ mode: 'disabled' });
  });

  it.each([
    [{ ...validEnvironment, DATABASE_URL_REF: undefined }, 'configuration_invalid'],
    [{ ...validEnvironment, DATABASE_URL_REF: 'postgresql://db.example.invalid/xht' }, 'configuration_invalid'],
    [{ ...validEnvironment, INBOX_RETENTION_SECONDS: '3.14' }, 'configuration_invalid'],
    [{ ...validEnvironment, INBOX_RETENTION_SECONDS: '86399' }, 'configuration_invalid'],
    [{ ...validEnvironment, INBOX_RETENTION_SECONDS: '7776001' }, 'configuration_invalid'],
    [{ ...validEnvironment, TELEGRAM_RETRY_WINDOW_SECONDS: '0' }, 'configuration_invalid'],
    [{ ...validEnvironment, TELEGRAM_RETRY_WINDOW_SECONDS: '604801' }, 'configuration_invalid'],
    [{ ...validEnvironment, OTEL_EXPORTER: 'disabled', OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.invalid' }, 'configuration_invalid'],
    [{ ...validEnvironment, OTEL_EXPORTER: 'otlp', OTEL_EXPORTER_OTLP_ENDPOINT: undefined }, 'configuration_invalid'],
    [{ ...validEnvironment, OTEL_EXPORTER: 'otlp', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector.example' }, 'configuration_invalid']
  ])('rejects missing, literal, malformed, or out-of-range application values', (input, code) => {
    expect(() => parseEnvironment(input)).toThrowError(expect.objectContaining({ code }));
  });

  it('accepts an injected OTLP boundary without opening a connection', () => {
    expect(parseEnvironment({
      ...validEnvironment,
      OTEL_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example/v1/traces'
    }).otel).toEqual({ mode: 'otlp', endpoint: 'https://collector.example/v1/traces' });
  });
});

describe('SecretReference', () => {
  it.each([
    'env://XHT_DATABASE_URL',
    'file:///run/secrets/xht/database-url',
    'file:///C:/ProgramData/HuanHuiTong/secrets/key'
  ])('accepts a canonical reference: %s', value => {
    expect(parseSecretReference(value)).toBe(value);
  });

  it.each([
    'literal-secret',
    'env://lowercase',
    'env://9INVALID',
    'file://server/share/secret',
    'file:///run/secrets/../private',
    'file:///run/secrets/./private',
    'file:///run//secrets/private',
    'file:///run/secrets/%2e%2e/private',
    'file:///run\\secrets\\private',
    'file:///run/secrets/private?version=1',
    'file:///run/secrets/private#fragment',
    'file:///C:',
    'file:///1:/ProgramData/HuanHuiTong/secrets/key',
    'file:///CC:/ProgramData/HuanHuiTong/secrets/key',
    'file:///C::/ProgramData/HuanHuiTong/secrets/key',
    'file:///C|/ProgramData/HuanHuiTong/secrets/key',
    'https://example.invalid/secret'
  ])('rejects a literal or illegal reference without echoing it: %s', value => {
    let thrown: unknown;
    try { parseSecretReference(value); } catch (error: unknown) { thrown = error; }
    expect(thrown).toBeInstanceOf(SecretReferenceError);
    expect(String(thrown)).not.toContain(value);
  });
});

describe('SecretResolver', () => {
  it('resolves env bytes for one bounded lifetime and clears them on dispose', async () => {
    const resolver = createSecretResolver({
      environment: { XHT_TEST_SECRET: 'synthetic-value' },
      allowedFileRoots: [syntheticRoot]
    });
    const reference = parseSecretReference('env://XHT_TEST_SECRET');
    let borrowed: Uint8Array | undefined;
    const value = await withResolvedSecret(resolver, reference, bytes => {
      borrowed = bytes;
      return new TextDecoder().decode(bytes);
    });
    expect(value).toBe('synthetic-value');
    expect(borrowed === undefined ? [] : [...borrowed]).toEqual(new Array(15).fill(0));
    resolver.dispose();
    await expect(resolver.resolve(reference)).rejects.toMatchObject({ code: 'RESOLVER_CLOSED' });
  });

  it.each([
    ['synchronous throw', (bytes: Uint8Array): never => {
      throw new Error(`synthetic-consumer-failure-${bytes.byteLength}`);
    }],
    ['asynchronous rejection', async (bytes: Uint8Array): Promise<never> => {
      await Promise.resolve(bytes.byteLength);
      throw new Error('synthetic-async-consumer-failure');
    }]
  ])('clears resolved bytes after a %s', async (_caseName, consumer) => {
    const resolver = createSecretResolver({
      environment: { XHT_TEST_SECRET: 'synthetic-value' },
      allowedFileRoots: [syntheticRoot]
    });
    const reference = parseSecretReference('env://XHT_TEST_SECRET');
    let borrowed: Uint8Array | undefined;
    await expect(withResolvedSecret(resolver, reference, bytes => {
      borrowed = bytes;
      return consumer(bytes);
    })).rejects.toThrow();
    expect(borrowed === undefined ? [] : [...borrowed]).toEqual(new Array(15).fill(0));
  });

  it('allows injected POSIX and Windows canonical files and rejects a symlink escape', async () => {
    const reads: string[] = [];
    const allowedRoot = path.resolve(syntheticRoot, 'allowed');
    const posixPath = path.join(allowedRoot, 'database-url');
    const windowsPath = path.join(allowedRoot, 'windows-key');
    const resolver = createSecretResolver({
      environment: {},
      allowedFileRoots: [allowedRoot],
      fileUrlToPath: input => {
        const value = String(input);
        if (value === 'file:///run/secrets/xht/database-url') return posixPath;
        if (value === 'file:///C:/ProgramData/HuanHuiTong/secrets/key') return windowsPath;
        if (value === 'file:///run/secrets/xht/escape') return path.join(allowedRoot, 'escape');
        throw new Error('UNEXPECTED_TEST_FILE_URL');
      },
      realpath: async input => input.endsWith('escape')
        ? path.resolve(allowedRoot, '..', '..', 'outside-secret')
        : input,
      readFile: async input => { reads.push(input); return new TextEncoder().encode('file-secret'); }
    });
    const posixValue = await withResolvedSecret(
      resolver,
      parseSecretReference('file:///run/secrets/xht/database-url'),
      bytes => new TextDecoder().decode(bytes)
    );
    const windowsValue = await withResolvedSecret(
      resolver,
      parseSecretReference('file:///C:/ProgramData/HuanHuiTong/secrets/key'),
      bytes => new TextDecoder().decode(bytes)
    );
    expect(posixValue).toBe('file-secret');
    expect(windowsValue).toBe('file-secret');
    expect(reads).toEqual([posixPath, windowsPath]);
    await expect(resolver.resolve(
      parseSecretReference('file:///run/secrets/xht/escape')
    )).rejects.toMatchObject({ code: 'FILE_PATH_FORBIDDEN' });
  });

  it('classifies missing, empty, and oversized secrets without including secret data', async () => {
    const missing = createSecretResolver({ environment: {}, allowedFileRoots: [syntheticRoot] });
    await expect(missing.resolve(parseSecretReference('env://XHT_MISSING')))
      .rejects.toMatchObject({ code: 'ENV_NOT_FOUND' });
    const empty = createSecretResolver({ environment: { XHT_EMPTY: '' }, allowedFileRoots: [syntheticRoot] });
    await expect(empty.resolve(parseSecretReference('env://XHT_EMPTY')))
      .rejects.toMatchObject({ code: 'EMPTY_SECRET' });
    const large = createSecretResolver({
      environment: { XHT_LARGE: 'x'.repeat(65_537) }, allowedFileRoots: [syntheticRoot]
    });
    await expect(large.resolve(parseSecretReference('env://XHT_LARGE')))
      .rejects.toMatchObject({ code: 'SECRET_TOO_LARGE' });
    expect(String(new SecretResolutionError('ENV_NOT_FOUND'))).toBe('SecretResolutionError: ENV_NOT_FOUND');
  });
});
```

- [x] **Step 2: 运行 RED**

Run:

```powershell
pnpm build
pnpm exec vitest run --project unit packages/config/test/environment.spec.ts
```

Expected: FAIL，首个稳定原因是 `packages/config/src/environment.ts` 或导出不存在；不得是 Node、pnpm 或 Vitest 配置错误。

- [x] **Step 3: 写 SecretReference 完整实现**

```ts
// packages/config/src/secret-reference.ts
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
```

- [x] **Step 4: 写 SecretResolver 完整实现**

```ts
// packages/config/src/secret-resolver.ts
import { readFile as nodeReadFile, realpath as nodeRealpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SecretReference } from './secret-reference.js';

export type SecretResolutionErrorCode =
  | 'ENV_NOT_FOUND'
  | 'FILE_PATH_FORBIDDEN'
  | 'FILE_NOT_FOUND'
  | 'READ_FAILED'
  | 'EMPTY_SECRET'
  | 'SECRET_TOO_LARGE'
  | 'RESOLVER_CLOSED'
  | 'SECRET_DISPOSED';

export class SecretResolutionError extends Error {
  public constructor(public readonly code: SecretResolutionErrorCode) {
    super(code);
    this.name = 'SecretResolutionError';
  }
}

export interface ResolvedSecret {
  withBytes<T>(consumer: (bytes: Uint8Array) => T | Promise<T>): Promise<T>;
  dispose(): void;
}

export interface SecretResolver {
  resolve(reference: SecretReference): Promise<ResolvedSecret>;
  dispose(): void;
}

export interface SecretResolverOptions {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly allowedFileRoots: readonly string[];
  readonly readFile?: (path: string) => Promise<Uint8Array>;
  readonly realpath?: (path: string) => Promise<string>;
  readonly fileUrlToPath?: (input: string | URL) => string;
  readonly maxSecretBytes?: number;
}

class MemoryResolvedSecret implements ResolvedSecret {
  private disposed = false;
  public constructor(private readonly value: Uint8Array) {}
  public async withBytes<T>(consumer: (bytes: Uint8Array) => T | Promise<T>): Promise<T> {
    if (this.disposed) throw new SecretResolutionError('SECRET_DISPOSED');
    return consumer(this.value);
  }
  public dispose(): void {
    if (!this.disposed) this.value.fill(0);
    this.disposed = true;
  }
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function classifyFileError(error: unknown): SecretResolutionError {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { readonly code: unknown }).code)
    : '';
  return new SecretResolutionError(code === 'ENOENT' ? 'FILE_NOT_FOUND' : 'READ_FAILED');
}

export function createSecretResolver(options: SecretResolverOptions): SecretResolver {
  const maxSecretBytes = options.maxSecretBytes ?? 65_536;
  if (!Number.isInteger(maxSecretBytes) || maxSecretBytes < 1 || maxSecretBytes > 65_536) {
    throw new SecretResolutionError('SECRET_TOO_LARGE');
  }
  if (options.allowedFileRoots.length === 0 || options.allowedFileRoots.some(root => !path.isAbsolute(root))) {
    throw new SecretResolutionError('FILE_PATH_FORBIDDEN');
  }
  const readFile = options.readFile ?? (async input => nodeReadFile(input));
  const realpath = options.realpath ?? nodeRealpath;
  const fromFileUrl = options.fileUrlToPath ?? fileURLToPath;
  let closed = false;

  async function finalize(source: Uint8Array): Promise<ResolvedSecret> {
    try {
      if (source.byteLength === 0) throw new SecretResolutionError('EMPTY_SECRET');
      if (source.byteLength > maxSecretBytes) throw new SecretResolutionError('SECRET_TOO_LARGE');
      return new MemoryResolvedSecret(Uint8Array.from(source));
    } finally {
      source.fill(0);
    }
  }

  return {
    async resolve(reference: SecretReference): Promise<ResolvedSecret> {
      if (closed) throw new SecretResolutionError('RESOLVER_CLOSED');
      if (reference.startsWith('env://')) {
        const name = reference.slice('env://'.length);
        const value = options.environment[name];
        if (value === undefined) throw new SecretResolutionError('ENV_NOT_FOUND');
        return finalize(new TextEncoder().encode(value));
      }
      const requestedPath = fromFileUrl(reference);
      let candidate: string;
      let roots: readonly string[];
      try {
        candidate = await realpath(requestedPath);
        roots = await Promise.all(options.allowedFileRoots.map(root => realpath(root)));
      } catch (error: unknown) {
        throw classifyFileError(error);
      }
      if (!roots.some(root => isWithinRoot(root, candidate))) {
        throw new SecretResolutionError('FILE_PATH_FORBIDDEN');
      }
      try { return finalize(await readFile(candidate)); }
      catch (error: unknown) {
        if (error instanceof SecretResolutionError) throw error;
        throw classifyFileError(error);
      }
    },
    dispose(): void { closed = true; }
  };
}

export async function withResolvedSecret<T>(
  resolver: SecretResolver,
  reference: SecretReference,
  consumer: (bytes: Uint8Array) => T | Promise<T>
): Promise<T> {
  const secret = await resolver.resolve(reference);
  try { return await secret.withBytes(consumer); }
  finally { secret.dispose(); }
}
```

- [x] **Step 5: 写 AppEnvironment 完整实现**

```ts
// packages/config/src/environment.ts
import { z } from 'zod';
import type { TelemetryConfig } from '@xht/contracts';
import { secretReferenceSchema, type SecretReference } from './secret-reference.js';

export type AppEnvironmentErrorCode = 'configuration_invalid';

export class AppEnvironmentError extends Error {
  public constructor(public readonly code: AppEnvironmentErrorCode) {
    super(code);
    this.name = 'AppEnvironmentError';
  }
}

const integerString = (minimum: number, maximum: number) => z.string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .transform(value => Number(value))
  .pipe(z.number().int().min(minimum).max(maximum));

const projectedSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  DATABASE_URL_REF: secretReferenceSchema,
  TELEGRAM_WEBHOOK_SECRET_REF: secretReferenceSchema,
  INBOX_DIGEST_KEYRING_REF: secretReferenceSchema,
  INBOX_RETENTION_SECONDS: integerString(86_400, 7_776_000),
  TELEGRAM_RETRY_WINDOW_SECONDS: integerString(1, 604_800),
  OTEL_EXPORTER: z.enum(['disabled', 'otlp']),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional()
}).strict().superRefine((value, context) => {
  if (value.OTEL_EXPORTER === 'disabled' && value.OTEL_EXPORTER_OTLP_ENDPOINT !== undefined) {
    context.addIssue({ code: 'custom', path: ['OTEL_EXPORTER_OTLP_ENDPOINT'], message: 'endpoint forbidden' });
  }
  if (value.OTEL_EXPORTER === 'otlp') {
    if (value.OTEL_EXPORTER_OTLP_ENDPOINT === undefined) {
      context.addIssue({ code: 'custom', path: ['OTEL_EXPORTER_OTLP_ENDPOINT'], message: 'endpoint required' });
      return;
    }
    const endpoint = new URL(value.OTEL_EXPORTER_OTLP_ENDPOINT);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
    if (endpoint.username !== '' || endpoint.password !== '' || endpoint.search !== '' || endpoint.hash !== '' ||
      (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && loopback))) {
      context.addIssue({ code: 'custom', path: ['OTEL_EXPORTER_OTLP_ENDPOINT'], message: 'unsafe endpoint' });
    }
  }
});

const knownEnvironmentKeys = [
  'NODE_ENV',
  'DATABASE_URL_REF',
  'TELEGRAM_WEBHOOK_SECRET_REF',
  'INBOX_DIGEST_KEYRING_REF',
  'INBOX_RETENTION_SECONDS',
  'TELEGRAM_RETRY_WINDOW_SECONDS',
  'OTEL_EXPORTER',
  'OTEL_EXPORTER_OTLP_ENDPOINT'
] as const;

export interface AppEnvironment {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly databaseUrlRef: SecretReference;
  readonly telegramWebhookSecretRef: SecretReference;
  readonly inboxDigestKeyringRef: SecretReference;
  readonly inboxRetentionSeconds: number;
  readonly telegramRetryWindowSeconds: number;
  readonly otel: TelemetryConfig;
}

export function parseEnvironment(input: NodeJS.ProcessEnv): AppEnvironment {
  const selected = Object.fromEntries(knownEnvironmentKeys
    .filter(key => input[key] !== undefined)
    .map(key => [key, input[key]]));
  const result = projectedSchema.safeParse(selected);
  if (!result.success) throw new AppEnvironmentError('configuration_invalid');
  const value = result.data;
  return {
    nodeEnv: value.NODE_ENV,
    databaseUrlRef: value.DATABASE_URL_REF,
    telegramWebhookSecretRef: value.TELEGRAM_WEBHOOK_SECRET_REF,
    inboxDigestKeyringRef: value.INBOX_DIGEST_KEYRING_REF,
    inboxRetentionSeconds: value.INBOX_RETENTION_SECONDS,
    telegramRetryWindowSeconds: value.TELEGRAM_RETRY_WINDOW_SECONDS,
    otel: value.OTEL_EXPORTER === 'disabled'
      ? { mode: 'disabled' }
      : { mode: 'otlp', endpoint: value.OTEL_EXPORTER_OTLP_ENDPOINT as string }
  };
}
```

```ts
// packages/config/src/index.ts after Subtask 2.2
export * from './environment.js';
export * from './secret-reference.js';
export * from './secret-resolver.js';
```

- [x] **Step 6: 运行 GREEN**

Run:

```powershell
node --input-type=module -e "import { rm } from 'node:fs/promises'; await Promise.all(['apps/platform/dist','apps/worker/dist','packages/contracts/dist','packages/config/dist','packages/testing/dist'].map(path => rm(path,{recursive:true,force:true})))"
pnpm build
pnpm exec vitest run --project unit packages/config/test/environment.spec.ts
pnpm typecheck
```

Expected: `environment.spec.ts` 全部 PASS；五工作区 clean build 与 typecheck exit 0；没有网络请求；lockfile 不变。

- [ ] **Step 7: Git 检查点**

`NOT_AUTHORIZED`。不运行 Git 命令。

---

### Subtask 2.3: Inbox digest keyring

**Files:**
- Create: `packages/config/test/inbox-digest-keyring.spec.ts`
- Create: `packages/config/src/inbox-digest-keyring.ts`
- Modify: `packages/config/src/index.ts`

**Interfaces:**
- Consumes: `SecretReference`、`SecretResolver`、Inbox 保留秒数、Telegram retry 秒数、注入时钟。
- Produces: `InboxDigestKeyring`、`InboxDigestKey`、`resolveInboxDigestKeyring`、稳定错误分类。

**Secret 原始载荷:** Secret 的 UTF-8 内容必须是以下 strict JSON；未知字段拒绝。`material` 是无 padding canonical base64url，解码后 32–64 bytes。current 条目不允许 `retainedAt` 或 `retireNotBefore`；retained 条目必须同时提供这两个 RFC 3339 时间。

```json
{
  "schemaVersion": 1,
  "keys": [
    {
      "version": "v2",
      "status": "current",
      "material": "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI",
      "activatedAt": "2026-07-21T00:00:00.000Z"
    },
    {
      "version": "v1",
      "status": "retained",
      "material": "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
      "activatedAt": "2026-06-01T00:00:00.000Z",
      "retainedAt": "2026-07-21T00:00:00.000Z",
      "retireNotBefore": "2026-08-21T00:00:00.000Z"
    }
  ]
}
```

生命周期规则：resolver 的 raw bytes 在 `JSON.parse` 返回后立即 `dispose()`；JSON 字符串只存在于函数局部变量且不离开解析栈。解码 key bytes 只保存在私有可清零 buffer；调用方必须在每个 webhook 请求 `finally` 中调用 keyring `dispose()`。到达 `retireNotBefore` 后 retained key 不得继续出现在载荷；缺少旧 Inbox 所需版本由后续 Inbox 流程返回 `digest_key_unavailable`，不得猜测或降级。

- [x] **Step 1: 写完整正向和反向 RED 测试**

```ts
// packages/config/test/inbox-digest-keyring.spec.ts
import { inspect } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type ResolvedSecret,
  type SecretResolver,
  InboxDigestKeyringError,
  parseSecretReference,
  resolveInboxDigestKeyring
} from '../src/index.js';

const currentMaterial = Buffer.alloc(32, 2).toString('base64url');
const retainedMaterial = Buffer.alloc(32, 1).toString('base64url');
const reference = parseSecretReference('env://XHT_TEST_INBOX_DIGEST_KEYRING');
const now = new Date('2026-07-21T12:00:00.000Z');

afterEach(() => vi.restoreAllMocks());

function validPayload(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    keys: [
      {
        version: 'v2', status: 'current', material: currentMaterial,
        activatedAt: '2026-07-21T00:00:00.000Z'
      },
      {
        version: 'v1', status: 'retained', material: retainedMaterial,
        activatedAt: '2026-06-01T00:00:00.000Z',
        retainedAt: '2026-07-21T00:00:00.000Z',
        retireNotBefore: '2026-08-21T00:00:00.000Z'
      }
    ]
  };
}

function resolverForRaw(raw: Uint8Array, evidence?: { raw?: Uint8Array; disposed?: boolean }): SecretResolver {
  return {
    async resolve(): Promise<ResolvedSecret> {
      if (evidence !== undefined) evidence.raw = raw;
      return {
        async withBytes<T>(consumer: (bytes: Uint8Array) => T | Promise<T>): Promise<T> {
          return consumer(raw);
        },
        dispose(): void {
          raw.fill(0);
          if (evidence !== undefined) evidence.disposed = true;
        }
      };
    },
    dispose(): void {}
  };
}

function resolverFor(payload: unknown, evidence?: { raw?: Uint8Array; disposed?: boolean }): SecretResolver {
  return resolverForRaw(new TextEncoder().encode(JSON.stringify(payload)), evidence);
}

async function resolvePayload(payload: unknown, at = now) {
  return resolveInboxDigestKeyring({
    reference,
    inboxRetentionSeconds: 2_592_000,
    telegramRetryWindowSeconds: 86_400,
    now: at
  }, resolverFor(payload));
}

describe('resolveInboxDigestKeyring', () => {
  it('parses one current and retained keys, disposes raw bytes, forbids serialization, and zeroes material', async () => {
    const evidence: { raw?: Uint8Array; disposed?: boolean } = {};
    const keyring = await resolveInboxDigestKeyring({
      reference,
      inboxRetentionSeconds: 2_592_000,
      telegramRetryWindowSeconds: 86_400,
      now
    }, resolverFor(validPayload(), evidence));
    expect(keyring.current.version).toBe('v2');
    expect(keyring.retained.map(key => key.version)).toEqual(['v1']);
    expect(evidence.disposed).toBe(true);
    expect(evidence.raw === undefined ? [] : [...evidence.raw]).toEqual(
      new Array(evidence.raw?.length ?? 0).fill(0)
    );
    expect(typeof keyring.current.activatedAt).toBe('string');
    expect(Object.isFrozen(keyring)).toBe(true);
    expect(Object.isFrozen(keyring.current)).toBe(true);
    expect(Object.isFrozen(keyring.retained)).toBe(true);
    let firstBorrowed: Uint8Array | undefined;
    expect(keyring.current.withMaterial(bytes => {
      firstBorrowed = bytes;
      bytes.fill(9);
      return bytes.byteLength;
    })).toBe(32);
    expect(firstBorrowed === undefined ? [] : [...firstBorrowed]).toEqual(new Array(32).fill(0));
    expect(keyring.current.withMaterial(bytes => [...bytes])).toEqual(new Array(32).fill(2));
    const retained = keyring.retained[0];
    if (retained === undefined) throw new Error('MISSING_RETAINED_TEST_KEY');
    expect(retained.withMaterial(bytes => {
      bytes.fill(7);
      return bytes.byteLength;
    })).toBe(32);
    expect(() => JSON.stringify(keyring)).toThrowError(
      expect.objectContaining({ code: 'SERIALIZATION_FORBIDDEN' })
    );
    expect(inspect(keyring)).toBe('[InboxDigestKeyring redacted]');
    expect(inspect(keyring.current)).not.toContain(currentMaterial);
    expect(() => JSON.stringify(keyring.current)).toThrowError(
      expect.objectContaining({ code: 'SERIALIZATION_FORBIDDEN' })
    );
    keyring.dispose();
    keyring.dispose();
    expect(() => keyring.current.withMaterial(() => 1)).toThrowError(
      expect.objectContaining({ code: 'KEYRING_DISPOSED' })
    );
  });

  it('zeroes each borrowed material after consumer throw without changing internal material', async () => {
    const keyring = await resolvePayload(validPayload());
    let borrowed: Uint8Array | undefined;
    expect(() => keyring.current.withMaterial(bytes => {
      borrowed = bytes;
      bytes.fill(8);
      throw new Error('synthetic-borrow-failure');
    })).toThrow('synthetic-borrow-failure');
    expect(borrowed === undefined ? [] : [...borrowed]).toEqual(new Array(32).fill(0));
    expect(keyring.current.withMaterial(bytes => [...bytes])).toEqual(new Array(32).fill(2));
    keyring.dispose();
  });

  it.each([
    ['CURRENT_COUNT', { ...validPayload(), keys: [] }],
    ['CURRENT_COUNT', { ...validPayload(), keys: [
      { version: 'v2', status: 'current', material: currentMaterial, activatedAt: '2026-07-21T00:00:00.000Z' },
      { version: 'v3', status: 'current', material: Buffer.alloc(32, 3).toString('base64url'), activatedAt: '2026-07-21T01:00:00.000Z' }
    ] }],
    ['DUPLICATE_VERSION', { ...validPayload(), keys: [
      ...(validPayload().keys as object[]),
      { version: 'v1', status: 'retained', material: Buffer.alloc(32, 4).toString('base64url'), activatedAt: '2026-05-01T00:00:00.000Z', retainedAt: '2026-07-21T00:00:00.000Z', retireNotBefore: '2026-08-21T00:00:00.000Z' }
    ] }],
    ['KEY_TOO_SHORT', { ...validPayload(), keys: [
      { version: 'v2', status: 'current', material: Buffer.alloc(31, 2).toString('base64url'), activatedAt: '2026-07-21T00:00:00.000Z' }
    ] }],
    ['KEY_TOO_LONG', { ...validPayload(), keys: [
      { version: 'v2', status: 'current', material: Buffer.alloc(65, 2).toString('base64url'), activatedAt: '2026-07-21T00:00:00.000Z' }
    ] }],
    ['NON_CANONICAL_MATERIAL', { ...validPayload(), keys: [
      { version: 'v2', status: 'current', material: 'A', activatedAt: '2026-07-21T00:00:00.000Z' }
    ] }],
    ['DUPLICATE_MATERIAL', { ...validPayload(), keys: [
      { version: 'v2', status: 'current', material: currentMaterial, activatedAt: '2026-07-21T00:00:00.000Z' },
      { version: 'v1', status: 'retained', material: currentMaterial, activatedAt: '2026-06-01T00:00:00.000Z', retainedAt: '2026-07-21T00:00:00.000Z', retireNotBefore: '2026-08-21T00:00:00.000Z' }
    ] }],
    ['CURRENT_VERSION_NOT_HIGHEST', { ...validPayload(), keys: [
      { version: 'v1', status: 'current', material: currentMaterial, activatedAt: '2026-07-21T00:00:00.000Z' },
      { version: 'v2', status: 'retained', material: retainedMaterial, activatedAt: '2026-06-01T00:00:00.000Z', retainedAt: '2026-07-21T00:00:00.000Z', retireNotBefore: '2026-08-21T00:00:00.000Z' }
    ] }],
    ['RETENTION_WINDOW_TOO_SHORT', { ...validPayload(), keys: [
      { version: 'v2', status: 'current', material: currentMaterial, activatedAt: '2026-07-21T00:00:00.000Z' },
      { version: 'v1', status: 'retained', material: retainedMaterial, activatedAt: '2026-06-01T00:00:00.000Z', retainedAt: '2026-07-21T00:00:00.000Z', retireNotBefore: '2026-08-20T23:59:59.000Z' }
    ] }],
    ['INVALID_SCHEMA', { ...validPayload(), unexpected: true }]
  ])('rejects invalid keyring with stable code %s', async (code, payload) => {
    await expect(resolvePayload(payload)).rejects.toMatchObject({ code });
  });

  it.each([
    ['NON_CANONICAL_MATERIAL', 'A', 0],
    ['KEY_TOO_SHORT', Buffer.alloc(31, 2).toString('base64url'), 31],
    ['KEY_TOO_LONG', Buffer.alloc(65, 2).toString('base64url'), 65]
  ])('clears the sole decoded Buffer after %s', async (code, material, byteLength) => {
    const fillSpy = vi.spyOn(Buffer.prototype, 'fill');
    await expect(resolvePayload({ ...validPayload(), keys: [
      { version: 'v2', status: 'current', material, activatedAt: '2026-07-21T00:00:00.000Z' }
    ] })).rejects.toMatchObject({ code });
    expect(fillSpy.mock.contexts.some((context, index) =>
      fillSpy.mock.calls[index]?.[0] === 0 && (context as Buffer).byteLength === byteLength
    )).toBe(true);
  });

  it('rejects duplicate material before decoding and still clears raw Secret bytes', async () => {
    const evidence: { raw?: Uint8Array; disposed?: boolean } = {};
    const payload = { ...validPayload(), keys: [
      { version: 'v2', status: 'current', material: currentMaterial, activatedAt: '2026-07-21T00:00:00.000Z' },
      { version: 'v1', status: 'retained', material: currentMaterial, activatedAt: '2026-06-01T00:00:00.000Z', retainedAt: '2026-07-21T00:00:00.000Z', retireNotBefore: '2026-08-21T00:00:00.000Z' }
    ] };
    await expect(resolveInboxDigestKeyring({
      reference,
      inboxRetentionSeconds: 2_592_000,
      telegramRetryWindowSeconds: 86_400,
      now
    }, resolverFor(payload, evidence))).rejects.toMatchObject({ code: 'DUPLICATE_MATERIAL' });
    expect(evidence.disposed).toBe(true);
    expect(evidence.raw === undefined ? [] : [...evidence.raw]).toEqual(
      new Array(evidence.raw?.length ?? 0).fill(0)
    );
  });

  it.each([
    ['INVALID_UTF8', Uint8Array.from([0xff, 0xfe])],
    ['INVALID_JSON', new TextEncoder().encode('{"schemaVersion":')],
    ['INVALID_SCHEMA', new TextEncoder().encode('{"schemaVersion":1,"keys":[],"raw":"synthetic-raw-json"}')]
  ])('zeroes raw Secret bytes after %s', async (code, raw) => {
    const evidence: { raw?: Uint8Array; disposed?: boolean } = {};
    await expect(resolveInboxDigestKeyring({
      reference,
      inboxRetentionSeconds: 2_592_000,
      telegramRetryWindowSeconds: 86_400,
      now
    }, resolverForRaw(raw, evidence))).rejects.toMatchObject({ code });
    expect(evidence.disposed).toBe(true);
    expect(evidence.raw === undefined ? [] : [...evidence.raw]).toEqual(
      new Array(evidence.raw?.length ?? 0).fill(0)
    );
  });

  it.each([
    ['INVALID_NOW', { now: new Date(Number.NaN) }],
    ['INVALID_POLICY_VALUE', { inboxRetentionSeconds: Number.NaN }],
    ['INVALID_POLICY_VALUE', { inboxRetentionSeconds: Number.POSITIVE_INFINITY }],
    ['INVALID_POLICY_VALUE', { inboxRetentionSeconds: 86_400.5 }],
    ['INVALID_POLICY_VALUE', { inboxRetentionSeconds: -1 }],
    ['INVALID_POLICY_VALUE', { telegramRetryWindowSeconds: 604_801 }]
  ])('rejects invalid time or policy input with %s', async (code, override) => {
    await expect(resolveInboxDigestKeyring({
      reference,
      inboxRetentionSeconds: 2_592_000,
      telegramRetryWindowSeconds: 86_400,
      now,
      ...override
    }, resolverFor(validPayload()))).rejects.toMatchObject({ code });
  });

  it.each([
    [86_400, 1, '2026-07-22T00:00:01.000Z'],
    [7_776_000, 604_800, '2026-10-26T00:00:00.000Z']
  ])('accepts policy boundaries %i + %i', async (
    inboxRetentionSeconds,
    telegramRetryWindowSeconds,
    retireNotBefore
  ) => {
    const payload = { ...validPayload(), keys: [
      { version: 'v2', status: 'current', material: currentMaterial, activatedAt: '2026-07-21T00:00:00.000Z' },
      { version: 'v1', status: 'retained', material: retainedMaterial, activatedAt: '2026-06-01T00:00:00.000Z', retainedAt: '2026-07-21T00:00:00.000Z', retireNotBefore }
    ] };
    const keyring = await resolveInboxDigestKeyring({
      reference, inboxRetentionSeconds, telegramRetryWindowSeconds, now
    }, resolverFor(payload));
    expect(keyring.current.version).toBe('v2');
    keyring.dispose();
  });

  it.each([
    ['CURRENT_NOT_ACTIVE', { ...validPayload(), keys: [
      { version: 'v2', status: 'current', material: currentMaterial, activatedAt: '2026-07-22T00:00:00.000Z' }
    ] }],
    ['INVALID_ACTIVATION_ORDER', { ...validPayload(), keys: [
      { version: 'v2', status: 'current', material: currentMaterial, activatedAt: '2026-07-21T00:00:00.000Z' },
      { version: 'v1', status: 'retained', material: retainedMaterial, activatedAt: '2026-07-20T00:00:00.000Z', retainedAt: '2026-07-19T00:00:00.000Z', retireNotBefore: '2026-08-21T00:00:00.000Z' }
    ] }],
    ['RETAINED_AFTER_CURRENT', { ...validPayload(), keys: [
      { version: 'v2', status: 'current', material: currentMaterial, activatedAt: '2026-07-21T00:00:00.000Z' },
      { version: 'v1', status: 'retained', material: retainedMaterial, activatedAt: '2026-06-01T00:00:00.000Z', retainedAt: '2026-07-22T01:00:00.000Z', retireNotBefore: '2026-08-22T01:00:00.000Z' }
    ] }],
    ['VERSION_ACTIVATION_ORDER', { ...validPayload(), keys: [
      { version: 'v2', status: 'current', material: currentMaterial, activatedAt: '2026-06-01T00:00:00.000Z' },
      { version: 'v1', status: 'retained', material: retainedMaterial, activatedAt: '2026-07-01T00:00:00.000Z', retainedAt: '2026-07-01T00:00:00.000Z', retireNotBefore: '2026-08-01T00:00:00.000Z' }
    ] }]
  ])('rejects impossible key chronology with %s', async (code, payload) => {
    await expect(resolvePayload(payload)).rejects.toMatchObject({ code });
  });

  it('zeroes a valid earlier material and the failing later material', async () => {
    const fillSpy = vi.spyOn(Buffer.prototype, 'fill');
    const payload = { ...validPayload(), keys: [
      { version: 'v2', status: 'current', material: currentMaterial, activatedAt: '2026-07-21T00:00:00.000Z' },
      { version: 'v1', status: 'retained', material: Buffer.alloc(31, 1).toString('base64url'), activatedAt: '2026-06-01T00:00:00.000Z', retainedAt: '2026-07-21T00:00:00.000Z', retireNotBefore: '2026-08-21T00:00:00.000Z' }
    ] };
    await expect(resolvePayload(payload)).rejects.toMatchObject({ code: 'KEY_TOO_SHORT' });
    const clearedLengths = fillSpy.mock.contexts.flatMap((context, index) =>
      fillSpy.mock.calls[index]?.[0] === 0 ? [(context as Buffer).byteLength] : []
    );
    expect(clearedLengths).toEqual(expect.arrayContaining([31, 32]));
  });

  it('rejects a retained key at its destruction boundary', async () => {
    await expect(resolvePayload(validPayload(), new Date('2026-08-21T00:00:00.000Z')))
      .rejects.toMatchObject({ code: 'RETAINED_KEY_EXPIRED' });
  });

  it('never includes raw payload or material in strings, JSON, inspect, or snapshots', () => {
    const error = new InboxDigestKeyringError('INVALID_SCHEMA');
    expect(String(error)).toBe('InboxDigestKeyringError: INVALID_SCHEMA');
    expect(String(error)).not.toContain(currentMaterial);
    expect(JSON.stringify(error)).not.toContain(currentMaterial);
    expect(inspect(error)).not.toContain(currentMaterial);
    expect({ name: error.name, code: error.code }).toMatchInlineSnapshot(`
      {
        "code": "INVALID_SCHEMA",
        "name": "InboxDigestKeyringError",
      }
    `);
  });
});
```

- [x] **Step 2: 运行 RED**

Run:

```powershell
pnpm build
pnpm exec vitest run --project unit packages/config/test/inbox-digest-keyring.spec.ts
```

Expected: FAIL，稳定原因是 `inbox-digest-keyring.js` 或导出不存在。

- [x] **Step 3: 写完整 keyring 实现**

```ts
// packages/config/src/inbox-digest-keyring.ts
import { inspect } from 'node:util';
import { z } from 'zod';
import type { SecretReference } from './secret-reference.js';
import { type SecretResolver, withResolvedSecret } from './secret-resolver.js';

export type InboxDigestKeyVersion = `v${number}`;

export type InboxDigestKeyringErrorCode =
  | 'INVALID_UTF8'
  | 'INVALID_JSON'
  | 'INVALID_SCHEMA'
  | 'INVALID_NOW'
  | 'INVALID_POLICY_VALUE'
  | 'CURRENT_COUNT'
  | 'DUPLICATE_VERSION'
  | 'DUPLICATE_MATERIAL'
  | 'NON_CANONICAL_MATERIAL'
  | 'KEY_TOO_SHORT'
  | 'KEY_TOO_LONG'
  | 'CURRENT_VERSION_NOT_HIGHEST'
  | 'INVALID_ACTIVATION_ORDER'
  | 'CURRENT_NOT_ACTIVE'
  | 'RETAINED_AFTER_CURRENT'
  | 'VERSION_ACTIVATION_ORDER'
  | 'RETENTION_WINDOW_TOO_SHORT'
  | 'RETAINED_KEY_EXPIRED'
  | 'KEYRING_DISPOSED'
  | 'SERIALIZATION_FORBIDDEN';

export class InboxDigestKeyringError extends Error {
  public constructor(public readonly code: InboxDigestKeyringErrorCode) {
    super(code);
    this.name = 'InboxDigestKeyringError';
  }
}

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

export interface ResolveInboxDigestKeyringInput {
  readonly reference: SecretReference;
  readonly inboxRetentionSeconds: number;
  readonly telegramRetryWindowSeconds: number;
  readonly now: Date;
}

const versionPattern = /^v[1-9][0-9]{0,8}$/;
const materialPattern = /^[A-Za-z0-9_-]+$/;
const common = {
  version: z.string().regex(versionPattern),
  material: z.string().min(1),
  activatedAt: z.string().datetime({ offset: true })
};
const currentSchema = z.object({
  ...common,
  status: z.literal('current')
}).strict();
const retainedSchema = z.object({
  ...common,
  status: z.literal('retained'),
  retainedAt: z.string().datetime({ offset: true }),
  retireNotBefore: z.string().datetime({ offset: true })
}).strict();
const payloadSchema = z.object({
  schemaVersion: z.literal(1),
  keys: z.array(z.discriminatedUnion('status', [currentSchema, retainedSchema])).max(32)
}).strict();

class KeyMaterial {
  private disposed = false;
  readonly #bytes: Buffer;
  public constructor(bytes: Buffer) { this.#bytes = bytes; }
  public use<T>(consumer: (material: Uint8Array) => T): T {
    if (this.disposed) throw new InboxDigestKeyringError('KEYRING_DISPOSED');
    const borrowed = Buffer.from(this.#bytes);
    try { return consumer(borrowed); }
    finally { borrowed.fill(0); }
  }
  public dispose(): void {
    if (!this.disposed) this.#bytes.fill(0);
    this.disposed = true;
  }
}

class RuntimeInboxDigestKey implements InboxDigestKey {
  readonly #keyMaterial: KeyMaterial;
  public constructor(
    public readonly version: InboxDigestKeyVersion,
    public readonly status: 'current' | 'retained',
    public readonly activatedAt: string,
    keyMaterial: KeyMaterial,
    public readonly retainedAt: string | undefined,
    public readonly retireNotBefore: string | undefined
  ) {
    this.#keyMaterial = keyMaterial;
    Object.freeze(this);
  }
  public withMaterial<T>(consumer: (material: Uint8Array) => T): T {
    return this.#keyMaterial.use(consumer);
  }
  public dispose(): void { this.#keyMaterial.dispose(); }
  public toJSON(): never {
    throw new InboxDigestKeyringError('SERIALIZATION_FORBIDDEN');
  }
  public [inspect.custom](): string { return '[InboxDigestKey redacted]'; }
}

class RuntimeInboxDigestKeyring implements InboxDigestKeyring {
  public readonly current: RuntimeInboxDigestKey;
  public readonly retained: readonly RuntimeInboxDigestKey[];
  public constructor(
    current: RuntimeInboxDigestKey,
    retained: readonly RuntimeInboxDigestKey[]
  ) {
    this.current = current;
    this.retained = Object.freeze([...retained]);
    Object.freeze(this);
  }
  public dispose(): void {
    this.current.dispose();
    for (const key of this.retained) key.dispose();
  }
  public toJSON(): never {
    throw new InboxDigestKeyringError('SERIALIZATION_FORBIDDEN');
  }
  public [inspect.custom](): string { return '[InboxDigestKeyring redacted]'; }
}

function decodeMaterial(value: string): Buffer {
  if (!materialPattern.test(value) || value.includes('=')) {
    throw new InboxDigestKeyringError('NON_CANONICAL_MATERIAL');
  }
  const bytes = Buffer.from(value, 'base64url');
  let accepted = false;
  try {
    if (bytes.toString('base64url') !== value) {
      throw new InboxDigestKeyringError('NON_CANONICAL_MATERIAL');
    }
    if (bytes.byteLength < 32) throw new InboxDigestKeyringError('KEY_TOO_SHORT');
    if (bytes.byteLength > 64) throw new InboxDigestKeyringError('KEY_TOO_LONG');
    accepted = true;
    return bytes;
  } finally {
    if (!accepted) bytes.fill(0);
  }
}

function versionNumber(version: string): number { return Number(version.slice(1)); }
function timestamp(value: string): number { return new Date(value).getTime(); }

function retentionWindowMilliseconds(input: ResolveInboxDigestKeyringInput): number {
  const values = [input.inboxRetentionSeconds, input.telegramRetryWindowSeconds];
  if (!values.every(Number.isSafeInteger) ||
    input.inboxRetentionSeconds < 86_400 || input.inboxRetentionSeconds > 7_776_000 ||
    input.telegramRetryWindowSeconds < 1 || input.telegramRetryWindowSeconds > 604_800) {
    throw new InboxDigestKeyringError('INVALID_POLICY_VALUE');
  }
  const seconds = input.inboxRetentionSeconds + input.telegramRetryWindowSeconds;
  return seconds * 1000;
}

export async function resolveInboxDigestKeyring(
  input: ResolveInboxDigestKeyringInput,
  resolver: SecretResolver
): Promise<InboxDigestKeyring> {
  const nowMilliseconds = input.now instanceof Date ? input.now.getTime() : Number.NaN;
  if (!Number.isFinite(nowMilliseconds)) throw new InboxDigestKeyringError('INVALID_NOW');
  const retentionMilliseconds = retentionWindowMilliseconds(input);
  const unknownPayload = await withResolvedSecret(resolver, input.reference, bytes => {
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new InboxDigestKeyringError('INVALID_UTF8'); }
    try { return JSON.parse(text) as unknown; }
    catch { throw new InboxDigestKeyringError('INVALID_JSON'); }
  });
  const parsed = payloadSchema.safeParse(unknownPayload);
  if (!parsed.success) throw new InboxDigestKeyringError('INVALID_SCHEMA');
  const entries = parsed.data.keys;
  const currentEntries = entries.filter(entry => entry.status === 'current');
  if (currentEntries.length !== 1) throw new InboxDigestKeyringError('CURRENT_COUNT');
  const versions = entries.map(entry => entry.version);
  if (new Set(versions).size !== versions.length) throw new InboxDigestKeyringError('DUPLICATE_VERSION');
  const materialStrings = entries.map(entry => entry.material);
  if (new Set(materialStrings).size !== materialStrings.length) {
    throw new InboxDigestKeyringError('DUPLICATE_MATERIAL');
  }
  const currentEntry = currentEntries[0];
  if (currentEntry === undefined) throw new InboxDigestKeyringError('CURRENT_COUNT');
  if (entries.some(entry => versionNumber(entry.version) > versionNumber(currentEntry.version))) {
    throw new InboxDigestKeyringError('CURRENT_VERSION_NOT_HIGHEST');
  }
  const currentActivatedAt = timestamp(currentEntry.activatedAt);
  if (currentActivatedAt > nowMilliseconds) {
    throw new InboxDigestKeyringError('CURRENT_NOT_ACTIVE');
  }
  const byVersion = [...entries].sort(
    (left, right) => versionNumber(left.version) - versionNumber(right.version)
  );
  for (let index = 1; index < byVersion.length; index += 1) {
    const previous = byVersion[index - 1];
    const next = byVersion[index];
    if (previous === undefined || next === undefined) continue;
    if (timestamp(previous.activatedAt) >= timestamp(next.activatedAt)) {
      throw new InboxDigestKeyringError('VERSION_ACTIVATION_ORDER');
    }
  }
  for (const entry of entries) {
    if (entry.status !== 'retained') continue;
    const activatedAt = timestamp(entry.activatedAt);
    const retainedAt = timestamp(entry.retainedAt);
    const retireNotBefore = timestamp(entry.retireNotBefore);
    if (retainedAt < activatedAt) {
      throw new InboxDigestKeyringError('INVALID_ACTIVATION_ORDER');
    }
    if (retainedAt > currentActivatedAt) {
      throw new InboxDigestKeyringError('RETAINED_AFTER_CURRENT');
    }
    if (retireNotBefore < retainedAt + retentionMilliseconds) {
      throw new InboxDigestKeyringError('RETENTION_WINDOW_TOO_SHORT');
    }
    if (nowMilliseconds >= retireNotBefore) {
      throw new InboxDigestKeyringError('RETAINED_KEY_EXPIRED');
    }
  }

  const decoded: Buffer[] = [];
  try {
    const runtime = entries.map(entry => {
      const material = decodeMaterial(entry.material);
      decoded.push(material);
      return new RuntimeInboxDigestKey(
        entry.version as InboxDigestKeyVersion,
        entry.status,
        new Date(entry.activatedAt).toISOString(),
        new KeyMaterial(material),
        entry.status === 'retained' ? new Date(entry.retainedAt).toISOString() : undefined,
        entry.status === 'retained' ? new Date(entry.retireNotBefore).toISOString() : undefined
      );
    });
    const current = runtime.find(entry => entry.status === 'current');
    if (current === undefined) throw new InboxDigestKeyringError('CURRENT_COUNT');
    return new RuntimeInboxDigestKeyring(
      current,
      runtime.filter(entry => entry.status === 'retained')
        .sort((left, right) => versionNumber(right.version) - versionNumber(left.version))
    );
  } catch (error: unknown) {
    for (const bytes of decoded) bytes.fill(0);
    throw error;
  }
}
```

```ts
// packages/config/src/index.ts after Subtask 2.3
export * from './environment.js';
export * from './inbox-digest-keyring.js';
export * from './secret-reference.js';
export * from './secret-resolver.js';
```

- [x] **Step 4: 运行 GREEN**

Run:

```powershell
node --input-type=module -e "import { rm } from 'node:fs/promises'; await Promise.all(['apps/platform/dist','apps/worker/dist','packages/contracts/dist','packages/config/dist','packages/testing/dist'].map(path => rm(path,{recursive:true,force:true})))"
pnpm build
pnpm exec vitest run --project unit packages/config/test/environment.spec.ts packages/config/test/inbox-digest-keyring.spec.ts
pnpm typecheck
```

Expected: 两个 config 测试文件全部 PASS；非法 keyring 全部以稳定分类失败；raw buffer 与 key material 清零断言 PASS；序列化和 inspect 禁止断言 PASS；没有 Secret 值出现在输出。

- [ ] **Step 5: Git 检查点**

`NOT_AUTHORIZED`。不运行 Git 命令。

### Subtask 2.4: SafeLogger 运行时白名单与 Pino destination 注入

**Files:**
- Create: `packages/config/src/logging-policy.ts`
- Modify: `packages/config/src/index.ts`
- Create: `apps/platform/test/unit/logger.spec.ts`
- Create: `apps/worker/test/unit/logger.spec.ts`
- Create: `apps/platform/src/infrastructure/logging/create-platform-logger.ts`
- Create: `apps/worker/src/infrastructure/logging/create-worker-logger.ts`

**Interfaces:**
- Consumes: `SafeLogEvent`、`SafeLogContext`、注入 `DestinationStream`。
- Produces: `validateSafeLogEntry`、`SafeLoggingError`、`createPlatformLogger`、`createWorkerLogger`。

**运行时白名单:** event 只允许观测合同中的六个字面值。字段只允许 `correlation_id`、`route`、`outcome`、`error_category`、`duration_ms`，并进一步按 event 收紧。字符串最多 128 字符、不得含 C0/C1 控制字符；`correlation_id` 必须以 `corr_` 开头；其余字符串必须属于字面值集合。数字必须是有限整数并落入字段边界。任何 unknown key、object、array、Error、Uint8Array、boolean、null 或 undefined 值均拒绝整条日志，不做部分放行。

- [x] **Step 1: 写 platform logger RED 测试**

```ts
// apps/platform/test/unit/logger.spec.ts
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createPlatformLogger } from '../../src/infrastructure/logging/create-platform-logger.js';

function capture() {
  let output = '';
  const destination = new Writable({
    write(chunk, _encoding, done) { output += String(chunk); done(); }
  });
  return { destination, read: () => output };
}

describe('createPlatformLogger', () => {
  it('writes one flat allowlisted JSON record to the injected destination', () => {
    const sink = capture();
    const logger = createPlatformLogger(sink.destination);
    logger.info('app_configuration_loaded', {
      correlation_id: 'corr_platform_1', route: 'configuration',
      outcome: 'success', duration_ms: 12
    });
    const record = JSON.parse(sink.read()) as Record<string, unknown>;
    expect(record).toMatchObject({
      service: 'xht-platform', event: 'app_configuration_loaded',
      correlation_id: 'corr_platform_1', route: 'configuration', outcome: 'success', duration_ms: 12
    });
  });

  it.each([
    ['unknown_event', {}],
    ['toString', {}],
    ['process_started', { unknown_key: 'value' }],
    ['process_started', { [Symbol('secret')]: 'synthetic-secret' }],
    ['process_started', Object.defineProperty({}, 'route', {
      enumerable: true,
      get(): never { throw new Error('SECRET_GETTER_EXECUTED'); }
    })],
    ['process_started', { route: { nested: true } }],
    ['process_started', { route: ['bootstrap'] }],
    ['process_started', { route: 'bootstrap\nsecret' }],
    ['process_started', { correlation_id: `corr_${'x'.repeat(129)}` }],
    ['process_started', { duration_ms: Number.NaN }],
    ['process_started', { route: 'bootstrap' }],
    ['process_started', { route: 'telemetry', outcome: 'success' }],
    ['telemetry_disabled', { route: 'telemetry', outcome: 'configured' }],
    ['process_stopped', { route: 'bootstrap', outcome: 'success' }],
    ['app_configuration_rejected', { route: 'configuration', outcome: 'rejected' }]
  ])('rejects invalid runtime input without writing: %s', (event, context) => {
    const sink = capture();
    const logger = createPlatformLogger(sink.destination) as unknown as {
      info(inputEvent: unknown, inputContext: unknown): void;
    };
    expect(() => logger.info(event, context)).toThrowError(
      expect.objectContaining({ name: 'SafeLoggingError' })
    );
    expect(sink.read()).toBe('');
  });
});
```

- [x] **Step 2: 写 worker logger RED 测试**

```ts
// apps/worker/test/unit/logger.spec.ts
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createWorkerLogger } from '../../src/infrastructure/logging/create-worker-logger.js';

function capture() {
  let output = '';
  const destination = new Writable({
    write(chunk, _encoding, done) { output += String(chunk); done(); }
  });
  return { destination, read: () => output };
}

describe('createWorkerLogger', () => {
  it('writes the worker service name and approved fields only', () => {
    const sink = capture();
    const logger = createWorkerLogger(sink.destination);
    logger.warn('telemetry_disabled', {
      correlation_id: 'corr_worker_1', route: 'telemetry', outcome: 'disabled'
    });
    expect(JSON.parse(sink.read())).toMatchObject({
      service: 'xht-worker', event: 'telemetry_disabled',
      correlation_id: 'corr_worker_1', route: 'telemetry', outcome: 'disabled'
    });
  });

  it('rejects an Error, byte array, and secret-shaped unknown field before Pino', () => {
    const sink = capture();
    const logger = createWorkerLogger(sink.destination) as unknown as {
      error(inputEvent: unknown, inputContext: unknown): void;
    };
    for (const context of [
      { error_category: new Error('synthetic-secret') },
      { correlation_id: new Uint8Array([1, 2, 3]) },
      { secret_token: 'synthetic-secret' }
    ]) {
      expect(() => logger.error('app_configuration_rejected', context)).toThrowError(
        expect.objectContaining({ name: 'SafeLoggingError' })
      );
    }
    expect(sink.read()).toBe('');
  });

  it.each([
    ['telemetry_configured', { outcome: 'configured' }],
    ['telemetry_configured', { route: 'configuration', outcome: 'configured' }],
    ['app_configuration_loaded', { route: 'configuration', outcome: 'rejected' }],
    ['app_configuration_rejected', {
      route: 'configuration', outcome: 'rejected', error_category: 'invalid_log_entry',
      duration_ms: 1
    }]
  ])('throws for missing or mismatched event policy without writing: %s', (event, context) => {
    const sink = capture();
    const logger = createWorkerLogger(sink.destination) as unknown as {
      info(inputEvent: unknown, inputContext: unknown): void;
    };
    expect(() => logger.info(event, context)).toThrowError(
      expect.objectContaining({ name: 'SafeLoggingError' })
    );
    expect(sink.read()).toBe('');
  });
});
```

- [x] **Step 3: 运行 RED**

Run:

```powershell
pnpm build
pnpm exec vitest run --project unit apps/platform/test/unit/logger.spec.ts apps/worker/test/unit/logger.spec.ts
```

Expected: 两个测试文件 FAIL，稳定原因是 logger factory 或 logging policy 不存在。

- [x] **Step 4: 写完整运行时 logging policy**

```ts
// packages/config/src/logging-policy.ts
import type { SafeLogContext, SafeLogEvent } from '@xht/contracts';

export type SafeLoggingErrorCode =
  | 'EVENT_NOT_ALLOWED'
  | 'CONTEXT_NOT_OBJECT'
  | 'UNKNOWN_FIELD'
  | 'REQUIRED_FIELD_MISSING'
  | 'EVENT_POLICY_MISMATCH'
  | 'NESTED_VALUE'
  | 'VALUE_TYPE_NOT_ALLOWED'
  | 'STRING_TOO_LONG'
  | 'CONTROL_CHARACTER'
  | 'VALUE_NOT_ALLOWED';

export class SafeLoggingError extends Error {
  public constructor(public readonly code: SafeLoggingErrorCode) {
    super(code);
    this.name = 'SafeLoggingError';
  }
}

export interface SafeLogEntry {
  readonly event: SafeLogEvent;
  readonly context: Readonly<Record<string, string | number>>;
}

type ContextKey = keyof SafeLogContext;
interface EventPolicy {
  readonly required: readonly ContextKey[];
  readonly optional: readonly ContextKey[];
  readonly route: NonNullable<SafeLogContext['route']>;
  readonly outcome: NonNullable<SafeLogContext['outcome']>;
}

const eventPolicies = {
  app_configuration_loaded: {
    required: ['route', 'outcome'], optional: ['correlation_id', 'duration_ms'],
    route: 'configuration', outcome: 'success'
  },
  app_configuration_rejected: {
    required: ['route', 'outcome', 'error_category'], optional: ['correlation_id'],
    route: 'configuration', outcome: 'rejected'
  },
  telemetry_disabled: {
    required: ['route', 'outcome'], optional: ['correlation_id'],
    route: 'telemetry', outcome: 'disabled'
  },
  telemetry_configured: {
    required: ['route', 'outcome'], optional: ['correlation_id', 'duration_ms'],
    route: 'telemetry', outcome: 'configured'
  },
  process_started: {
    required: ['route', 'outcome'], optional: ['correlation_id', 'duration_ms'],
    route: 'bootstrap', outcome: 'success'
  },
  process_stopped: {
    required: ['route', 'outcome'], optional: ['correlation_id', 'duration_ms'],
    route: 'bootstrap', outcome: 'stopped'
  }
} as const satisfies Record<SafeLogEvent, EventPolicy>;

const routes = new Set(['bootstrap', 'configuration', 'telemetry']);
const outcomes = new Set(['success', 'rejected', 'disabled', 'configured', 'stopped']);
const errorCategories = new Set([
  'configuration_invalid', 'secret_reference_invalid', 'secret_resolution_failed',
  'telemetry_initialization_failed', 'invalid_log_entry'
]);
const controlCharacters = /[\u0000-\u001f\u007f-\u009f]/;

function validateString(key: string, value: string): void {
  if (value.length > 128) throw new SafeLoggingError('STRING_TOO_LONG');
  if (controlCharacters.test(value)) throw new SafeLoggingError('CONTROL_CHARACTER');
  if (key === 'correlation_id' && !/^corr_[A-Za-z0-9_-]{1,59}$/.test(value)) {
    throw new SafeLoggingError('VALUE_NOT_ALLOWED');
  }
  if (key === 'route' && !routes.has(value)) throw new SafeLoggingError('VALUE_NOT_ALLOWED');
  if (key === 'outcome' && !outcomes.has(value)) throw new SafeLoggingError('VALUE_NOT_ALLOWED');
  if (key === 'error_category' && !errorCategories.has(value)) {
    throw new SafeLoggingError('VALUE_NOT_ALLOWED');
  }
}

function validateNumber(key: string, value: number): void {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new SafeLoggingError('VALUE_TYPE_NOT_ALLOWED');
  }
  if (key === 'duration_ms' && (value < 0 || value > 600_000)) {
    throw new SafeLoggingError('VALUE_NOT_ALLOWED');
  }
}

export function validateSafeLogEntry(event: unknown, context: unknown = {}): SafeLogEntry {
  if (typeof event !== 'string' || !Object.hasOwn(eventPolicies, event)) {
    throw new SafeLoggingError('EVENT_NOT_ALLOWED');
  }
  if (typeof context !== 'object' || context === null || Array.isArray(context)) {
    throw new SafeLoggingError('CONTEXT_NOT_OBJECT');
  }
  const prototype = Object.getPrototypeOf(context);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new SafeLoggingError('CONTEXT_NOT_OBJECT');
  }
  const typedEvent = event as SafeLogEvent;
  const policy = eventPolicies[typedEvent];
  const allowed = new Set<string>([...policy.required, ...policy.optional]);
  const selected: Record<string, string | number> = {};
  for (const key of Reflect.ownKeys(context)) {
    if (typeof key !== 'string' || !allowed.has(key)) throw new SafeLoggingError('UNKNOWN_FIELD');
    const descriptor = Object.getOwnPropertyDescriptor(context, key);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      throw new SafeLoggingError('VALUE_TYPE_NOT_ALLOWED');
    }
    const value = descriptor.value as unknown;
    if (typeof value === 'object' && value !== null) throw new SafeLoggingError('NESTED_VALUE');
    if (typeof value === 'string') validateString(key, value);
    else if (typeof value === 'number') validateNumber(key, value);
    else throw new SafeLoggingError('VALUE_TYPE_NOT_ALLOWED');
    selected[key] = value;
  }
  for (const key of policy.required) {
    if (!Object.hasOwn(selected, key)) throw new SafeLoggingError('REQUIRED_FIELD_MISSING');
  }
  if (selected.route !== policy.route || selected.outcome !== policy.outcome) {
    throw new SafeLoggingError('EVENT_POLICY_MISMATCH');
  }
  return { event: typedEvent, context: Object.freeze(selected) };
}
```

```ts
// packages/config/src/index.ts after Subtask 2.4
export * from './environment.js';
export * from './inbox-digest-keyring.js';
export * from './logging-policy.js';
export * from './secret-reference.js';
export * from './secret-resolver.js';
```

- [x] **Step 5: 写完整 platform Pino 适配**

```ts
// apps/platform/src/infrastructure/logging/create-platform-logger.ts
import pino, { type DestinationStream } from 'pino';
import type { SafeLogContext, SafeLogEvent, SafeLogger } from '@xht/contracts';
import { validateSafeLogEntry } from '@xht/config';

export function createPlatformLogger(destination: DestinationStream): SafeLogger {
  const backend = pino({ base: { service: 'xht-platform' }, timestamp: false }, destination);
  const write = (level: 'info' | 'warn' | 'error', event: SafeLogEvent, context?: SafeLogContext): void => {
    const safe = validateSafeLogEntry(event, context ?? {});
    backend[level]({ event: safe.event, ...safe.context });
  };
  return {
    info: (event, context) => write('info', event, context),
    warn: (event, context) => write('warn', event, context),
    error: (event, context) => write('error', event, context)
  };
}
```

- [x] **Step 6: 写完整 worker Pino 适配**

```ts
// apps/worker/src/infrastructure/logging/create-worker-logger.ts
import pino, { type DestinationStream } from 'pino';
import type { SafeLogContext, SafeLogEvent, SafeLogger } from '@xht/contracts';
import { validateSafeLogEntry } from '@xht/config';

export function createWorkerLogger(destination: DestinationStream): SafeLogger {
  const backend = pino({ base: { service: 'xht-worker' }, timestamp: false }, destination);
  const write = (level: 'info' | 'warn' | 'error', event: SafeLogEvent, context?: SafeLogContext): void => {
    const safe = validateSafeLogEntry(event, context ?? {});
    backend[level]({ event: safe.event, ...safe.context });
  };
  return {
    info: (event, context) => write('info', event, context),
    warn: (event, context) => write('warn', event, context),
    error: (event, context) => write('error', event, context)
  };
}
```

- [x] **Step 7: 运行 GREEN**

Run:

```powershell
node --input-type=module -e "import { rm } from 'node:fs/promises'; await Promise.all(['apps/platform/dist','apps/worker/dist','packages/contracts/dist','packages/config/dist','packages/testing/dist'].map(path => rm(path,{recursive:true,force:true})))"
pnpm build
pnpm exec vitest run --project unit apps/platform/test/unit/logger.spec.ts apps/worker/test/unit/logger.spec.ts
pnpm typecheck
```

Expected: platform 与 worker logger 测试全部 PASS；合法记录只进入各自注入 destination；所有非法输入抛稳定分类且 destination 长度为 0；没有控制字符、Secret 或嵌套值输出。

- [ ] **Step 8: Git 检查点**

`NOT_AUTHORIZED`。不运行 Git 命令。

---

### Subtask 2.5: platform/worker OpenTelemetry API 与 exporter 注入边界

**Files:**
- Create: `apps/platform/test/unit/telemetry.spec.ts`
- Create: `apps/worker/test/unit/telemetry.spec.ts`
- Create: `apps/platform/src/infrastructure/telemetry/create-platform-telemetry.ts`
- Create: `apps/worker/src/infrastructure/telemetry/create-worker-telemetry.ts`

**Interfaces:**
- Consumes: `TelemetryConfig`、可选 `OtlpExporterFactory`、`@opentelemetry/api`。
- Produces: `createPlatformTelemetry(config, factory?)` 与 `createWorkerTelemetry(config, factory?)`。

**连接边界:** 两个 factory 都只能调用 `trace.getTracer` 和注入的 exporter factory。disabled 分支即使传入 factory 也不能调用。otlp 分支缺 factory 必须以 `EXPORTER_FACTORY_REQUIRED` 失败；传入的测试 factory 只记录参数，不注册 SDK provider、不打开 socket。真实 exporter 属于后续独立授权范围。

- [x] **Step 1: 写 platform telemetry RED 测试**

```ts
// apps/platform/test/unit/telemetry.spec.ts
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OtlpExporterFactory, OtlpExporterRegistration } from '@xht/contracts';
import { createPlatformTelemetry } from '../../src/infrastructure/telemetry/create-platform-telemetry.js';

const require = createRequire(import.meta.url);
const http = require('node:http') as typeof import('node:http');
const https = require('node:https') as typeof import('node:https');
const net = require('node:net') as typeof import('node:net');
const dns = require('node:dns') as typeof import('node:dns');

function installNetworkGuards() {
  const forbidden = (..._arguments: unknown[]): never => { throw new Error('NETWORK_FORBIDDEN'); };
  const spies = [
    vi.spyOn(globalThis, 'fetch').mockImplementation(forbidden as typeof fetch),
    vi.spyOn(http, 'request').mockImplementation(forbidden as typeof http.request),
    vi.spyOn(https, 'request').mockImplementation(forbidden as typeof https.request),
    vi.spyOn(net, 'connect').mockImplementation(forbidden as typeof net.connect),
    vi.spyOn(dns, 'lookup').mockImplementation(forbidden as typeof dns.lookup)
  ];
  return { calls: () => spies.reduce((total, spy) => total + spy.mock.calls.length, 0) };
}

afterEach(() => vi.restoreAllMocks());

describe('createPlatformTelemetry', () => {
  it('keeps disabled mode no-op without factory registration or network', async () => {
    const network = installNetworkGuards();
    const registration: OtlpExporterRegistration = { shutdown: vi.fn(async () => undefined) };
    const factory: OtlpExporterFactory = { register: vi.fn(async () => registration) };
    const telemetry = await createPlatformTelemetry({ mode: 'disabled' }, factory);
    expect(telemetry.enabled).toBe(false);
    expect(telemetry.serviceName).toBe('xht-platform');
    telemetry.startSpan('telemetry.initialize').end();
    await telemetry.shutdown();
    expect(factory.register).not.toHaveBeenCalled();
    expect(registration.shutdown).not.toHaveBeenCalled();
    expect(network.calls()).toBe(0);
  });

  it('shares one pending shutdown result, closes spans immediately, and shuts down once', async () => {
    const network = installNetworkGuards();
    let releaseShutdown!: () => void;
    const shutdownGate = new Promise<void>(resolve => { releaseShutdown = resolve; });
    const registration: OtlpExporterRegistration = { shutdown: vi.fn(() => shutdownGate) };
    const factory: OtlpExporterFactory = { register: vi.fn(async () => registration) };
    const telemetry = await createPlatformTelemetry({
      mode: 'otlp', endpoint: 'https://collector.example/v1/traces'
    }, factory);
    expect(factory.register).toHaveBeenCalledWith({
      serviceName: 'xht-platform', endpoint: 'https://collector.example/v1/traces'
    });
    const first = telemetry.shutdown();
    const second = telemetry.shutdown();
    expect(second).toBe(first);
    let secondSettled = false;
    void second.then(() => { secondSettled = true; });
    await Promise.resolve();
    expect(secondSettled).toBe(false);
    expect(() => telemetry.startSpan('telemetry.initialize')).toThrowError(
      expect.objectContaining({ code: 'TELEMETRY_CLOSED' })
    );
    releaseShutdown();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    expect(telemetry.shutdown()).toBe(first);
    expect(registration.shutdown).toHaveBeenCalledTimes(1);
    expect(network.calls()).toBe(0);
  });

  it('shares one shutdown promise when the exporter synchronously reenters shutdown', async () => {
    let telemetry!: Awaited<ReturnType<typeof createPlatformTelemetry>>;
    let reentrantPromise!: Promise<void>;
    let reentered = false;
    const registration: OtlpExporterRegistration = {
      shutdown: vi.fn(() => {
        if (!reentered) {
          reentered = true;
          reentrantPromise = telemetry.shutdown();
        }
        return Promise.resolve();
      })
    };
    const factory: OtlpExporterFactory = { register: vi.fn(async () => registration) };
    telemetry = await createPlatformTelemetry({
      mode: 'otlp', endpoint: 'https://collector.example/v1/traces'
    }, factory);

    const first = telemetry.shutdown();
    expect(() => telemetry.startSpan('telemetry.initialize')).toThrowError(
      expect.objectContaining({ code: 'TELEMETRY_CLOSED' })
    );
    await Promise.resolve();
    const later = telemetry.shutdown();

    expect(reentrantPromise).toBe(first);
    expect(later).toBe(first);
    await expect(first).resolves.toBeUndefined();
    expect(registration.shutdown).toHaveBeenCalledTimes(1);
  });

  it('rejects otlp without an injected factory', async () => {
    await expect(createPlatformTelemetry({
      mode: 'otlp', endpoint: 'https://collector.example/v1/traces'
    })).rejects.toMatchObject({ code: 'EXPORTER_FACTORY_REQUIRED' });
  });

  it('maps exporter registration failures without leaking their body', async () => {
    const registrationFailure: OtlpExporterFactory = {
      register: vi.fn(async () => { throw new Error('synthetic-secret registration endpoint'); })
    };
    let thrown: unknown;
    try {
      await createPlatformTelemetry({
        mode: 'otlp', endpoint: 'https://collector.example/v1/traces'
      }, registrationFailure);
    } catch (error: unknown) { thrown = error; }
    expect(thrown).toMatchObject({ code: 'EXPORTER_REGISTRATION_FAILED' });
    expect(String(thrown)).not.toContain('synthetic-secret');
  });

  it('shares one sticky shutdown failure without leaking its body or retrying', async () => {
    let rejectShutdown!: () => void;
    const shutdownGate = new Promise<void>((_resolve, reject) => {
      rejectShutdown = () => reject(new Error('synthetic-secret authorization header'));
    });
    const registration: OtlpExporterRegistration = { shutdown: vi.fn(() => shutdownGate) };
    const shutdownFailure: OtlpExporterFactory = { register: vi.fn(async () => registration) };
    const telemetry = await createPlatformTelemetry({
      mode: 'otlp', endpoint: 'https://collector.example/v1/traces'
    }, shutdownFailure);
    const first = telemetry.shutdown();
    const second = telemetry.shutdown();
    expect(second).toBe(first);
    const concurrent = Promise.allSettled([first, second]);
    rejectShutdown();
    const results = await concurrent;
    for (const result of results) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') {
        expect(result.reason).toMatchObject({ code: 'EXPORTER_SHUTDOWN_FAILED' });
        expect(String(result.reason)).not.toContain('synthetic-secret');
      }
    }
    const third = telemetry.shutdown();
    expect(third).toBe(first);
    await expect(third).rejects.toMatchObject({ code: 'EXPORTER_SHUTDOWN_FAILED' });
    expect(registration.shutdown).toHaveBeenCalledTimes(1);
  });

  it('shares one sticky failure when the exporter synchronously reenters shutdown', async () => {
    let telemetry!: Awaited<ReturnType<typeof createPlatformTelemetry>>;
    let reentrantPromise!: Promise<void>;
    let reentered = false;
    const registration: OtlpExporterRegistration = {
      shutdown: vi.fn(() => {
        if (!reentered) {
          reentered = true;
          reentrantPromise = telemetry.shutdown();
          void reentrantPromise.catch(() => undefined);
        }
        return Promise.reject(new Error('synthetic-secret authorization header'));
      })
    };
    const factory: OtlpExporterFactory = { register: vi.fn(async () => registration) };
    telemetry = await createPlatformTelemetry({
      mode: 'otlp', endpoint: 'https://collector.example/v1/traces'
    }, factory);

    const first = telemetry.shutdown();
    void first.catch(() => undefined);
    expect(() => telemetry.startSpan('telemetry.initialize')).toThrowError(
      expect.objectContaining({ code: 'TELEMETRY_CLOSED' })
    );
    await Promise.resolve();
    const later = telemetry.shutdown();

    expect(reentrantPromise).toBe(first);
    expect(later).toBe(first);
    const results = await Promise.allSettled([first, reentrantPromise, later]);
    for (const result of results) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') {
        expect(result.reason).toMatchObject({ code: 'EXPORTER_SHUTDOWN_FAILED' });
        expect(String(result.reason)).not.toContain('synthetic-secret');
      }
    }
    expect(registration.shutdown).toHaveBeenCalledTimes(1);
  });
});
```

- [x] **Step 2: 写 worker telemetry RED 测试**

```ts
// apps/worker/test/unit/telemetry.spec.ts
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OtlpExporterFactory, OtlpExporterRegistration } from '@xht/contracts';
import { createWorkerTelemetry } from '../../src/infrastructure/telemetry/create-worker-telemetry.js';

const require = createRequire(import.meta.url);
const http = require('node:http') as typeof import('node:http');
const https = require('node:https') as typeof import('node:https');
const net = require('node:net') as typeof import('node:net');
const dns = require('node:dns') as typeof import('node:dns');

function installNetworkGuards() {
  const forbidden = (..._arguments: unknown[]): never => { throw new Error('NETWORK_FORBIDDEN'); };
  const spies = [
    vi.spyOn(globalThis, 'fetch').mockImplementation(forbidden as typeof fetch),
    vi.spyOn(http, 'request').mockImplementation(forbidden as typeof http.request),
    vi.spyOn(https, 'request').mockImplementation(forbidden as typeof https.request),
    vi.spyOn(net, 'connect').mockImplementation(forbidden as typeof net.connect),
    vi.spyOn(dns, 'lookup').mockImplementation(forbidden as typeof dns.lookup)
  ];
  return { calls: () => spies.reduce((total, spy) => total + spy.mock.calls.length, 0) };
}

afterEach(() => vi.restoreAllMocks());

describe('createWorkerTelemetry', () => {
  it('keeps disabled mode no-op without factory registration or network', async () => {
    const network = installNetworkGuards();
    const registration: OtlpExporterRegistration = { shutdown: vi.fn(async () => undefined) };
    const factory: OtlpExporterFactory = { register: vi.fn(async () => registration) };
    const telemetry = await createWorkerTelemetry({ mode: 'disabled' }, factory);
    expect(telemetry.enabled).toBe(false);
    expect(telemetry.serviceName).toBe('xht-worker');
    telemetry.startSpan('telemetry.initialize').end();
    await telemetry.shutdown();
    expect(factory.register).not.toHaveBeenCalled();
    expect(registration.shutdown).not.toHaveBeenCalled();
    expect(network.calls()).toBe(0);
  });

  it('shares one pending shutdown result, closes spans immediately, and shuts down once', async () => {
    const network = installNetworkGuards();
    let releaseShutdown!: () => void;
    const shutdownGate = new Promise<void>(resolve => { releaseShutdown = resolve; });
    const registration: OtlpExporterRegistration = { shutdown: vi.fn(() => shutdownGate) };
    const factory: OtlpExporterFactory = { register: vi.fn(async () => registration) };
    const telemetry = await createWorkerTelemetry({
      mode: 'otlp', endpoint: 'https://collector.example/v1/traces'
    }, factory);
    expect(factory.register).toHaveBeenCalledWith({
      serviceName: 'xht-worker', endpoint: 'https://collector.example/v1/traces'
    });
    const first = telemetry.shutdown();
    const second = telemetry.shutdown();
    expect(second).toBe(first);
    let secondSettled = false;
    void second.then(() => { secondSettled = true; });
    await Promise.resolve();
    expect(secondSettled).toBe(false);
    expect(() => telemetry.startSpan('telemetry.initialize')).toThrowError(
      expect.objectContaining({ code: 'TELEMETRY_CLOSED' })
    );
    releaseShutdown();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    expect(telemetry.shutdown()).toBe(first);
    expect(registration.shutdown).toHaveBeenCalledTimes(1);
    expect(network.calls()).toBe(0);
  });

  it('shares one shutdown promise when the exporter synchronously reenters shutdown', async () => {
    let telemetry!: Awaited<ReturnType<typeof createWorkerTelemetry>>;
    let reentrantPromise!: Promise<void>;
    let reentered = false;
    const registration: OtlpExporterRegistration = {
      shutdown: vi.fn(() => {
        if (!reentered) {
          reentered = true;
          reentrantPromise = telemetry.shutdown();
        }
        return Promise.resolve();
      })
    };
    const factory: OtlpExporterFactory = { register: vi.fn(async () => registration) };
    telemetry = await createWorkerTelemetry({
      mode: 'otlp', endpoint: 'https://collector.example/v1/traces'
    }, factory);

    const first = telemetry.shutdown();
    expect(() => telemetry.startSpan('telemetry.initialize')).toThrowError(
      expect.objectContaining({ code: 'TELEMETRY_CLOSED' })
    );
    await Promise.resolve();
    const later = telemetry.shutdown();

    expect(reentrantPromise).toBe(first);
    expect(later).toBe(first);
    await expect(first).resolves.toBeUndefined();
    expect(registration.shutdown).toHaveBeenCalledTimes(1);
  });

  it('rejects otlp without an injected factory', async () => {
    await expect(createWorkerTelemetry({
      mode: 'otlp', endpoint: 'https://collector.example/v1/traces'
    })).rejects.toMatchObject({ code: 'EXPORTER_FACTORY_REQUIRED' });
  });

  it('maps exporter registration failures without leaking their body', async () => {
    const registrationFailure: OtlpExporterFactory = {
      register: vi.fn(async () => { throw new Error('synthetic-secret registration endpoint'); })
    };
    let thrown: unknown;
    try {
      await createWorkerTelemetry({
        mode: 'otlp', endpoint: 'https://collector.example/v1/traces'
      }, registrationFailure);
    } catch (error: unknown) { thrown = error; }
    expect(thrown).toMatchObject({ code: 'EXPORTER_REGISTRATION_FAILED' });
    expect(String(thrown)).not.toContain('synthetic-secret');
  });

  it('shares one sticky shutdown failure without leaking its body or retrying', async () => {
    let rejectShutdown!: () => void;
    const shutdownGate = new Promise<void>((_resolve, reject) => {
      rejectShutdown = () => reject(new Error('synthetic-secret authorization header'));
    });
    const registration: OtlpExporterRegistration = { shutdown: vi.fn(() => shutdownGate) };
    const shutdownFailure: OtlpExporterFactory = { register: vi.fn(async () => registration) };
    const telemetry = await createWorkerTelemetry({
      mode: 'otlp', endpoint: 'https://collector.example/v1/traces'
    }, shutdownFailure);
    const first = telemetry.shutdown();
    const second = telemetry.shutdown();
    expect(second).toBe(first);
    const concurrent = Promise.allSettled([first, second]);
    rejectShutdown();
    const results = await concurrent;
    for (const result of results) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') {
        expect(result.reason).toMatchObject({ code: 'EXPORTER_SHUTDOWN_FAILED' });
        expect(String(result.reason)).not.toContain('synthetic-secret');
      }
    }
    const third = telemetry.shutdown();
    expect(third).toBe(first);
    await expect(third).rejects.toMatchObject({ code: 'EXPORTER_SHUTDOWN_FAILED' });
    expect(registration.shutdown).toHaveBeenCalledTimes(1);
  });

  it('shares one sticky failure when the exporter synchronously reenters shutdown', async () => {
    let telemetry!: Awaited<ReturnType<typeof createWorkerTelemetry>>;
    let reentrantPromise!: Promise<void>;
    let reentered = false;
    const registration: OtlpExporterRegistration = {
      shutdown: vi.fn(() => {
        if (!reentered) {
          reentered = true;
          reentrantPromise = telemetry.shutdown();
          void reentrantPromise.catch(() => undefined);
        }
        return Promise.reject(new Error('synthetic-secret authorization header'));
      })
    };
    const factory: OtlpExporterFactory = { register: vi.fn(async () => registration) };
    telemetry = await createWorkerTelemetry({
      mode: 'otlp', endpoint: 'https://collector.example/v1/traces'
    }, factory);

    const first = telemetry.shutdown();
    void first.catch(() => undefined);
    expect(() => telemetry.startSpan('telemetry.initialize')).toThrowError(
      expect.objectContaining({ code: 'TELEMETRY_CLOSED' })
    );
    await Promise.resolve();
    const later = telemetry.shutdown();

    expect(reentrantPromise).toBe(first);
    expect(later).toBe(first);
    const results = await Promise.allSettled([first, reentrantPromise, later]);
    for (const result of results) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') {
        expect(result.reason).toMatchObject({ code: 'EXPORTER_SHUTDOWN_FAILED' });
        expect(String(result.reason)).not.toContain('synthetic-secret');
      }
    }
    expect(registration.shutdown).toHaveBeenCalledTimes(1);
  });
});
```

- [x] **Step 3: 运行 RED**

Run:

```powershell
pnpm build
pnpm exec vitest run --project unit apps/platform/test/unit/telemetry.spec.ts apps/worker/test/unit/telemetry.spec.ts
```

Expected: 两个测试文件 FAIL，稳定原因是 telemetry factory 不存在。

- [x] **Step 4: 写完整 platform telemetry factory**

```ts
// apps/platform/src/infrastructure/telemetry/create-platform-telemetry.ts
import { trace } from '@opentelemetry/api';
import {
  TelemetryConfigurationError,
  type OtlpExporterFactory,
  type OtlpExporterRegistration,
  type TelemetryConfig,
  type TelemetryHandle,
  type TelemetrySpanName
} from '@xht/contracts';

export async function createPlatformTelemetry(
  config: TelemetryConfig,
  exporterFactory?: OtlpExporterFactory
): Promise<TelemetryHandle> {
  const tracer = trace.getTracer('xht-platform', '0.1.0');
  let registration: OtlpExporterRegistration | undefined;
  if (config.mode === 'otlp') {
    if (exporterFactory === undefined) {
      throw new TelemetryConfigurationError('EXPORTER_FACTORY_REQUIRED');
    }
    try {
      registration = await exporterFactory.register({
        serviceName: 'xht-platform', endpoint: config.endpoint
      });
    } catch {
      throw new TelemetryConfigurationError('EXPORTER_REGISTRATION_FAILED');
    }
  }
  let closed = false;
  let shutdownPromise: Promise<void> | undefined;
  return {
    enabled: config.mode === 'otlp',
    serviceName: 'xht-platform',
    startSpan(name: TelemetrySpanName) {
      if (closed) throw new TelemetryConfigurationError('TELEMETRY_CLOSED');
      const span = tracer.startSpan(name);
      return { end: () => span.end() };
    },
    shutdown(): Promise<void> {
      if (shutdownPromise !== undefined) return shutdownPromise;
      closed = true;
      shutdownPromise = Promise.resolve().then(async () => {
        try { await registration?.shutdown(); }
        catch { throw new TelemetryConfigurationError('EXPORTER_SHUTDOWN_FAILED'); }
      });
      return shutdownPromise;
    }
  };
}
```

- [x] **Step 5: 写完整 worker telemetry factory**

```ts
// apps/worker/src/infrastructure/telemetry/create-worker-telemetry.ts
import { trace } from '@opentelemetry/api';
import {
  TelemetryConfigurationError,
  type OtlpExporterFactory,
  type OtlpExporterRegistration,
  type TelemetryConfig,
  type TelemetryHandle,
  type TelemetrySpanName
} from '@xht/contracts';

export async function createWorkerTelemetry(
  config: TelemetryConfig,
  exporterFactory?: OtlpExporterFactory
): Promise<TelemetryHandle> {
  const tracer = trace.getTracer('xht-worker', '0.1.0');
  let registration: OtlpExporterRegistration | undefined;
  if (config.mode === 'otlp') {
    if (exporterFactory === undefined) {
      throw new TelemetryConfigurationError('EXPORTER_FACTORY_REQUIRED');
    }
    try {
      registration = await exporterFactory.register({
        serviceName: 'xht-worker', endpoint: config.endpoint
      });
    } catch {
      throw new TelemetryConfigurationError('EXPORTER_REGISTRATION_FAILED');
    }
  }
  let closed = false;
  let shutdownPromise: Promise<void> | undefined;
  return {
    enabled: config.mode === 'otlp',
    serviceName: 'xht-worker',
    startSpan(name: TelemetrySpanName) {
      if (closed) throw new TelemetryConfigurationError('TELEMETRY_CLOSED');
      const span = tracer.startSpan(name);
      return { end: () => span.end() };
    },
    shutdown(): Promise<void> {
      if (shutdownPromise !== undefined) return shutdownPromise;
      closed = true;
      shutdownPromise = Promise.resolve().then(async () => {
        try { await registration?.shutdown(); }
        catch { throw new TelemetryConfigurationError('EXPORTER_SHUTDOWN_FAILED'); }
      });
      return shutdownPromise;
    }
  };
}
```

- [x] **Step 6: 运行 GREEN**

Run:

```powershell
node --input-type=module -e "import { rm } from 'node:fs/promises'; await Promise.all(['apps/platform/dist','apps/worker/dist','packages/contracts/dist','packages/config/dist','packages/testing/dist'].map(path => rm(path,{recursive:true,force:true})))"
pnpm build
pnpm exec vitest run --project unit apps/platform/test/unit/telemetry.spec.ts apps/worker/test/unit/telemetry.spec.ts
pnpm typecheck
```

Expected: platform/worker disabled 与 injected-otlp 测试全部 PASS；disabled factory call 0；disabled exporter registration 0；`fetch/http/https/net/dns` 调用总数 0；没有真实 collector。

- [ ] **Step 7: Git 检查点**

`NOT_AUTHORIZED`。不运行 Git 命令。

---

### Subtask 2.6: 最终回归与文档同步

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/runtime-topology.md`
- Modify: `docs/governance/ai-handoff.md`
- Modify: `docs/governance/state-model.md`
- Modify: `docs/operations/observability.md`
- Modify: `docs/plans/2026-07-20-stage-1-foundation-identity-implementation-plan.md`
- Modify: `docs/plans/2026-07-21-stage-1-task-2-config-observability-implementation-plan.md`
- Modify: `docs/plans/active-plan-index.md`
- Modify: `docs/plans/roadmap.md`
- Modify: `docs/security/threat-model.md`
- Modify: `docs/status/current.md`
- Modify: `docs/status/next.md`
- Modify: `docs/status/active-work.md`
- Modify: `docs/status/verification.md`
- Modify: `docs/status/progress-log.md`
- Modify: `docs/00-index.md`
- Modify: `docs/testing/strategy.md`

**Interfaces:**
- Consumes: Subtasks 2.1–2.5 的最终代码、测试输出、lockfile hash、禁止范围计数。
- Produces: 一致的 Task 2 实现状态、可重跑验证证据和唯一下一步。

- [x] **Step 1: 从无 dist 状态执行完整 GREEN**

Run，严格保持顺序：

```powershell
node --version
pnpm --version
pnpm install --offline --frozen-lockfile --ignore-scripts
node --input-type=module -e "import { rm } from 'node:fs/promises'; await Promise.all(['apps/platform/dist','apps/worker/dist','packages/contracts/dist','packages/config/dist','packages/testing/dist'].map(path => rm(path,{recursive:true,force:true})))"
pnpm build
pnpm exec vitest run --project unit packages/config/test/environment.spec.ts apps/platform/test/unit/telemetry.spec.ts apps/worker/test/unit/telemetry.spec.ts
pnpm typecheck
pnpm test:unit
node --input-type=module -e "await Promise.all(['@xht/contracts','@xht/config','@xht/testing'].map(name => import(name))); process.stdout.write('PACKAGE_IMPORTS_OK\n')"
pnpm install --offline --frozen-lockfile --ignore-scripts
```

Expected:

- `node --version` 为 `v24.18.0`；`pnpm --version` 为 `11.15.1`。
- frozen install exit 0；`pnpm-lock.yaml` SHA-256 仍为 `EE1F63DBFC72897F3483E9D6E96545801873988EA3E7EE15FCFB27C1E42AD9BC`；lifecycle 执行数 0；`allowBuilds` 为空。
- clean build exit 0；五个 workspace 都产生确定性 dist。
- 三个指定测试文件全部 PASS，记录最终真实 file/test 数，不沿用 v1.2.4 的 95/96 历史计数；没有 failed/skipped/only/retry。
- platform 与 worker logger 各有真实 destination 输出测试。
- platform 与 worker telemetry 各证明 disabled factory call 0、exporter registration 0、五类网络 API 调用总数 0。
- `pnpm typecheck` exit 0。
- `pnpm test:unit` 完整 unit project 全部 PASS；failed、skipped、only、retry 均为 0。
- `pnpm build` 和 `pnpm typecheck` 中缺失 Vitest 导入与 `exactOptionalPropertyTypes` 错误均为 0；file reference 反向测试中的路径穿越错误放行 0。
- 本门禁不得运行 `architecture:check`、database、integration、`test:all`、容器或外部服务测试；`.dependency-cruiser.cjs` 属于 Task 12，尚未创建。

- [x] **Step 2: 执行安全与范围静态检查**

检查并把计数写入 `docs/status/verification.md`：

- Task 2 Files 表中的工程路径与真实新增/修改路径精确相等。
- 跨工作区相对 import 数量 0；所有 `@xht/*` import 均有真实 package export。
- `process.env` 只出现在批准 bootstrap 与 `packages/config` 边界。
- `.env`、PEM、Bot Token、带凭据数据库 URL、npm auth、真实 collector URL 命中 0。
- key material、raw keyring JSON、ResolvedSecret bytes、完整 Update、canonical bytes 进入 logger/trace/error/Outbox/Inbox/audit 的路径 0。
- `fetch`、`node:http`、`node:https`、`node:net`、`node:dns` 的生产调用路径 0；它们只允许出现在 telemetry 负向测试 guard 中。
- keyring 实现抛出的稳定错误码集合与测试直接引用集合完全相等；不可达稳定错误码 0，可从公共入口触发但没有直接测试的稳定错误码 0。
- `inboxRetentionSeconds` 最小值 `86400` 与 `telegramRetryWindowSeconds` 最小值 `1` 的和为 `86401` 秒；最大值 `7776000 + 604800 = 8380800` 秒，乘以 `1000` 为 `8380800000`，远小于 `Number.MAX_SAFE_INTEGER = 9007199254740991`，不存在策略窗口安全整数溢出分支。
- current 已生效、current version 最高且 version 越高 `activatedAt` 必须严格越晚，因此任何低版本 retained key 的 `activatedAt` 必然早于 current；`RETAINED_NOT_ACTIVE` 在这些前置不变量后不可达，不保留该错误码或分支。
- 新依赖 0；依赖版本修改 0；lockfile 漂移 0。
- Git/worktree/子代理、容器、数据库、Flyway、Testcontainers、Telegram、外部 collector、部署使用数均为 0。

- [x] **Step 3: 按精确事实同步十七份文档**

只有 Step 1–2 全部通过才写成功状态。各权威文件必须写入以下事实，不复制 key material、测试 Secret 或完整环境样本：

- `docs/architecture/runtime-topology.md`：packages/config 已实现已知键投影、SecretReference/Resolver 分离和 request-scope keyring；platform/worker 各自拥有 logger/telemetry 适配；默认 telemetry disabled；otlp 仅有注入接口，没有真实 exporter 或连接。
- `docs/operations/observability.md`：六个允许 event 的精确 route/outcome/error_category policy、五个基础允许字段、每字段字面值/长度/数值边界、required/optional、unknown/nested/control rejection、destination 注入、platform/worker 测试结果和网络调用计数。
- `docs/security/threat-model.md`：env/file reference 在 URL 解析前拒绝 `.`、`..`、空中间片段、反斜杠、百分号编码、query、fragment 和控制字符，再执行 URL 与 realpath 允许根校验；同步 1–65536 bytes Secret 生命周期、keyring 单一受管理解码 Buffer、每次调用借用 Buffer、32–64 bytes、版本/current/retained/retention+retry、时间/策略验证、dispose 清零、运行时冻结、禁止序列化/日志/trace/错误/快照，以及真实密钥管理仍未开始。
- `docs/status/current.md`：阶段 0 VERIFIED；阶段 1 总计划 READY v1.2.5；阶段 1 代码 BUILDING；Task 1 VERIFIED；Task 2 详细计划 READY v1.2.5；Task 2 代码 READY、等待复审；数据库、Telegram、外部连接和部署仍 NOT_STARTED。
- `docs/status/next.md`：唯一下一步为等待用户审查第 4/48 步 Task 2 实现包和证据；不得自动规划或实施 Task 3。
- `docs/status/active-work.md`：真实文件清单、授权、排除项、RED/GREEN、lockfile 与残余风险；历史基线明确标为历史，不冒充当前事实。
- `docs/status/verification.md`：每条命令分别登记 executed/pass、executed/fail、not executed、static inspection；任何失败不得省略。
- `docs/status/progress-log.md`：保留第 3 步历史记录，追加第 4 步代码 NOT_STARTED→BUILDING→READY 的真实过程；不修改历史 Task 1 或 v1.2.1 记录。
- `docs/00-index.md`：链接本 Task 2 计划，并摘要真实 Task 2 状态与唯一下一步。

- [x] **Step 4: 文档一致性检查**

检查全部 Markdown 相对链接，要求断链 0、逃逸 0；检查 README、handoff、state-model、roadmap、主阶段计划、本计划、active-plan-index、current、next、active-work 的版本和状态完全一致。静态检查不得记录成运行测试。

- [ ] **Step 5: Git 检查点**

`NOT_AUTHORIZED`。不运行 Git 命令；实现结束不自动创建分支、提交、push 或 PR。

### Subtask 2.7: v1.2.5 外部复审修复

**Files:**
- Modify: `apps/platform/src/infrastructure/telemetry/create-platform-telemetry.ts`
- Modify: `apps/worker/src/infrastructure/telemetry/create-worker-telemetry.ts`
- Modify: `apps/platform/test/unit/telemetry.spec.ts`
- Modify: `apps/worker/test/unit/telemetry.spec.ts`
- Modify: `packages/config/src/secret-reference.ts`
- Modify: `packages/config/test/environment.spec.ts`

**Interfaces:**
- Consumes: 既有 `TelemetryHandle`、`OtlpExporterRegistration`、`SecretReference` 和注入式 `SecretResolverOptions.fileUrlToPath`；不改变公共签名。
- Produces: shutdown 开始即关闭 span、同一 Promise 的成功或失败粘滞结果、exporter shutdown 最多一次，以及 Windows/POSIX canonical file reference 的跨平台语法门禁。

- [x] **Step 1: 独立复现三个审查问题**

Run: 使用当前 dist 创建 pending/failing exporter registration，并分别调用 platform/worker 两次并发 shutdown 与第三次 shutdown；调用 `parseSecretReference` 比较 Windows 与 POSIX reference；扫描当前 `active-work` 和阶段主计划 Task 2 摘要。

Expected: 两进程第二次并发 shutdown 在 gate 释放前错误 fulfilled，失败时结果为 rejected/fulfilled 且第三次 fulfilled；Windows 返回 `INVALID_FILE_REFERENCE`、POSIX 接受；两处状态漂移均命中。

- [x] **Step 2: 写并运行 telemetry 与 file reference RED**

Run:

```powershell
pnpm exec vitest run --project unit packages/config/test/environment.spec.ts apps/platform/test/unit/telemetry.spec.ts apps/worker/test/unit/telemetry.spec.ts
```

Expected: 新增 Windows canonical 正向用例失败；platform/worker 并发 shutdown 用例因 Promise 不同一、第二次提前成功或失败不粘滞而失败。既有安全反向用例不删除、不放宽。

- [x] **Step 3: 写最小实现并运行聚焦 GREEN**

实现必须与 Subtask 2.2 和 2.5 的 v1.2.5 权威代码块一致：首段只对精确 drive segment 例外，shutdown 只新增每实例一个缓存 Promise，并保留稳定错误映射。

Run: 与 Step 2 相同。

Expected: 三个文件全部 PASS；Windows/POSIX 正向通过，非法 drive/path 门禁仍拒绝；两进程 pending/failure/sticky/closure/max-one/no-leak 全部通过。

- [x] **Step 4: 执行最终门禁并同步文档**

Run: Subtask 2.6 Step 1 的 offline install → clean dist → build → 三文件聚焦 → typecheck → unit → 三包 import → offline install 顺序；随后执行范围、安全、链接、状态和 artifact 验证。

Expected: 所有必需门禁 exit 0、lockfile hash 与基线相同、工程新增/删除 0、依赖和版本漂移 0；Task 2 恢复 `READY（等待用户复审）`，不是 `VERIFIED`。

- [ ] **Step 5: Git 检查点**

`NOT_AUTHORIZED`。不运行 Git 命令。

### Subtask 2.8: v1.2.6 同步重入 shutdown

**Files:**
- Modify: `apps/platform/test/unit/telemetry.spec.ts`
- Modify: `apps/worker/test/unit/telemetry.spec.ts`
- Modify: `apps/platform/src/infrastructure/telemetry/create-platform-telemetry.ts`
- Modify: `apps/worker/src/infrastructure/telemetry/create-worker-telemetry.ts`

**Interfaces:**
- Consumes: 既有 `TelemetryHandle` 与 `OtlpExporterRegistration.shutdown(): Promise<void>`；不改变任何公共签名。
- Produces: 普通并发、同步重入和后续调用共享的单一 shutdown Promise；成功或失败结果粘滞；exporter shutdown 最多一次。

- [x] **Step 1: 只写同步重入 RED 测试**

两个 telemetry spec 分别增加一个同步重入成功测试和一个同步重入失败测试。成功测试以闭包中的 exporter registration 同步调用同一 handle 的 `shutdown()`，保存 `first`、`reentrant` 和 `later`，并断言三者同一、registration 调用一次、shutdown 后 `startSpan` 立即以 `TELEMETRY_CLOSED` 拒绝。失败测试使用 `new Error('synthetic-secret authorization header')`，并断言三个同一 Promise 全部以脱敏 `EXPORTER_SHUTDOWN_FAILED` 拒绝。

```ts
let telemetry!: Awaited<ReturnType<typeof createPlatformTelemetry>>;
let reentrantPromise!: Promise<void>;
let reentered = false;
const registration: OtlpExporterRegistration = {
  shutdown: vi.fn(() => {
    if (!reentered) {
      reentered = true;
      reentrantPromise = telemetry.shutdown();
    }
    return Promise.resolve();
  })
};
telemetry = await createPlatformTelemetry(
  { mode: 'otlp', endpoint: 'https://collector.example/v1/traces' },
  { register: vi.fn(async () => registration) }
);
const first = telemetry.shutdown();
expect(() => telemetry.startSpan('telemetry.initialize')).toThrowError(
  expect.objectContaining({ code: 'TELEMETRY_CLOSED' })
);
await Promise.resolve();
const later = telemetry.shutdown();
expect(reentrantPromise).toBe(first);
expect(later).toBe(first);
await expect(first).resolves.toBeUndefined();
expect(registration.shutdown).toHaveBeenCalledTimes(1);
```

worker 测试使用 `createWorkerTelemetry` 和相同 registration 合同；失败测试把 registration 的最终返回改为 `Promise.reject(new Error('synthetic-secret authorization header'))`，对 `Promise.allSettled([first, reentrantPromise, later])` 的三个结果逐项断言 rejected、错误码为 `EXPORTER_SHUTDOWN_FAILED` 且字符串不含 `synthetic-secret`。

- [x] **Step 2: 运行并记录真实 RED**

Run:

```powershell
pnpm exec vitest run --project unit apps/platform/test/unit/telemetry.spec.ts apps/worker/test/unit/telemetry.spec.ts
```

Expected: exit 1；四个新增同步重入测试在 v1.2.5 上因 `first !== reentrant` 或 registration 调用两次而失败，既有测试保持通过。记录真实文件数、测试总数、通过数、失败数和首个稳定断言。

- [x] **Step 3: 写两个 factory 的最小同构实现**

platform 与 worker 的 `shutdown()` 只改为先缓存 microtask Promise，再在其中调用 exporter：

```ts
shutdown(): Promise<void> {
  if (shutdownPromise !== undefined) return shutdownPromise;
  closed = true;
  shutdownPromise = Promise.resolve().then(async () => {
    try { await registration?.shutdown(); }
    catch { throw new TelemetryConfigurationError('EXPORTER_SHUTDOWN_FAILED'); }
  });
  return shutdownPromise;
}
```

不得改变 disabled、registration、span、公共合同、错误码或重试语义。

- [x] **Step 4: 运行聚焦 GREEN**

Run: 与 Step 2 相同。

Expected: 两个文件全部通过；failed/skipped/only/retry 均为 0；同步重入成功/失败均共享同一 Promise，registration shutdown 各只调用一次。

- [x] **Step 5: 运行独立同步重入成功与失败用例**

从最终 dist 分别导入 platform/worker factory。成功场景必须输出 `calls=1`、`samePromise=true`、`laterSame=true`、`closedCode=TELEMETRY_CLOSED`；失败场景必须输出三个 rejected、三个 `EXPORTER_SHUTDOWN_FAILED`、同一 Promise、调用一次、`synthetic-secret` 泄露 0。

- [x] **Step 6: 执行最终离线门禁**

严格按用户指定顺序执行 Node/pnpm 版本、lockfile/package.json 前置哈希、offline frozen install、删除五个 dist 并确认 0、build、两个 telemetry 聚焦文件、typecheck、完整 unit、platform 三包真实导入、第二次 offline frozen install和后置哈希。禁止运行 architecture、test:all、database 或 integration。

- [x] **Step 7: 同步 v1.2.6 文档与 CreateNew 交付物**

只在全部门禁通过后把阶段总计划与本计划恢复 `READY v1.2.6`、Task 2 代码恢复 `READY（等待用户最终复审，非 VERIFIED）`，同步授权的 17 份 Markdown 中确有受影响者；生成不覆盖旧文件的 v1.2.6 ZIP 与报告，完整解压并逐文件哈希复核后清理系统 TEMP。

- [ ] **Step 8: Git 检查点**

`NOT_AUTHORIZED`。不运行任何 Git 命令，包括只读探针。

## Failure and Stop Rules

- 任一测试出现非预期失败，进入 `systematic-debugging`，保留 Task 2 为 BUILDING；不得通过放宽 runtime validation 或删除反向测试取得绿灯。
- 任一 lockfile hash 变化，立即标记 BLOCKED；不得接受自动 lockfile 更新。
- 任一生命周期脚本执行、真实网络调用、真实 Secret、额外工程文件或新依赖出现，立即停止并记录对应事实。
- disabled telemetry 调用 exporter factory 或五类网络 API 中任一项时，Task 2 不得标记 READY。
- keyring 无法证明 raw buffer 与 decoded material 的销毁时机，Task 2 不得标记 READY。
- 文档状态与代码事实不一致时，保持 BUILDING，先修复文档再重新执行最终验证。

## Self-Review Record

- 文件清单：工程路径 18 个，其中新建 16、修改 2；实施后同步授权 Markdown 17 个。所有工程写路径均在 Planned File Map 中。
- 接口一致性：`SecretReference` 只在 `secret-reference.ts` 定义；`SecretResolver`、`ResolvedSecret` 只在 `secret-resolver.ts` 定义；`AppEnvironment` 的 Secret 字段全部引用品牌类型。
- Buffer 与不可变性：每个 key 只有一个受管理解码 Buffer；canonical 检查不复制；每次 `withMaterial` 创建一个 finally 清零的借用 Buffer；内部 material 永不直出；公共时间字段显式为 `string | undefined`，status 决定 current/retained 语义，key/retained/keyring 运行时冻结。
- file reference：URL 解析前检查原始片段并拒绝 dot/dotdot、空中间片段、反斜杠、百分号编码、query、fragment 和控制字符；随后执行 canonical URL、realpath 与允许根边界检查，不让 URL 规范化掩盖原始路径穿越。
- keyring 错误集合：删除经边界证明不可达的 `POLICY_WINDOW_OVERFLOW` 与 `RETAINED_NOT_ACTIVE`；为 `INVALID_ACTIVATION_ORDER` 增加直接负向测试；最终实现抛出集合必须与直接测试引用集合完全相等。
- 策略边界：最小组合 `86400 + 1` 与最大组合 `7776000 + 604800` 都使用合法 `retireNotBefore` 成功解析并 dispose；最大毫秒值 `8380800000` 远小于 `Number.MAX_SAFE_INTEGER`。
- 测试覆盖：环境、reference、env/file resolver 同步抛错/异步 reject 清零；keyring UTF-8/JSON/schema、canonical/过短/过长/重复、后项失败、时间/策略边界、借用隔离、dispose/序列化；platform/worker logger event policy；platform/worker telemetry registration/shutdown 脱敏、v1.2.5 普通并发/失败粘滞和 v1.2.6 同步重入成功/失败均以最终真实计数记录，不沿用 95/96 或 47/104 历史计数。
- 命令完整性：最终验证严格包含 Node/pnpm 版本、frozen install、无 dist build、六文件聚焦 Vitest、typecheck 与完整 `test:unit`；不运行 architecture/database/integration/test:all。
- 依赖方向：contracts 不依赖 config/apps；config 只依赖 contracts；platform/worker 只经 package export 依赖 contracts/config；两个 app 不互相导入。
- Secret 与网络：测试只使用合成值；错误、JSON、inspect 和 snapshot 不含 raw JSON/material；生产代码没有真实 Secret、真实 exporter 或 collector；disabled 分支五类网络 API 调用计数为 0；register/shutdown 原始异常正文不越过稳定错误边界。
- 依赖矩阵：新增依赖 0、升级 0、版本修改 0；与 Task 1 的 build/main/types/exports 方式一致。
- Git 检查点：全部为 `NOT_AUTHORIZED`。

## Execution Handoff

第 5/48 步已根据用户最终复审 PASS、R5-01 ACCEPT 和新鲜复核，把 Task 2 v1.2.6 代码与测试正式标记为 `VERIFIED`。Task 3 独立详细计划已另行形成并为 `READY v1.0`，但代码仍为 `NOT_STARTED`；唯一下一步是用户审查 Task 3 计划并另行决定是否授权第 6/48 步，不得自动实施 Task 3。

---
