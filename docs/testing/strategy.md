# 测试策略

需求状态：APPROVED。交付状态：DESIGNING。

## 原则

未来业务开发采用 TDD。测试从公开行为和资金不变量出发，不以内部实现细节代替验收。每个失败路径必须证明没有伪成功、重复资金动作、负余额、敏感泄露或越权。

## 层次

- 单元测试：金额、精度、状态机、费用、限额、资格与策略纯逻辑，使用 Vitest。
- 属性测试：借贷平衡、总额守恒、舍入、红包分配、并发幂等与状态转换，使用 fast-check。
- 数据库集成：事务、唯一约束、锁、Outbox/Inbox、投影和 Flyway，使用 Testcontainers PostgreSQL。
- 契约测试：Telegram Update、链适配器、signer 和真实供应商合同的解析、验真、幂等与错误映射。
- 进程集成：platform、worker 与 signer 的版本化合同、任务崩溃恢复和重复投递。
- 端到端：Bot 到领域再到账本/通知的真实路径；不使用静态成功页替代。
- 运维测试：告警、备份恢复、RPO/RTO、恢复后重复副作用和发布回滚。

## 高风险矩阵

每个资金流覆盖成功、拒绝、取消、过期、重复、乱序、并发、超时、UNKNOWN、恢复和冲正。身份覆盖重复注册、绑定冲突、账号丢失与恢复欺诈。管理员覆盖越权、跨范围、自审、过期授权与字段脱敏。

## 数据

测试只用合成数据和假密钥。金额使用最小单位整数或十进制字符串。时间、随机数、上游与链观察可控注入，但集成层还需真实协议形状的契约样本。

## 完成证据

记录实际命令、环境、版本、通过/失败数和未执行原因。局部测试通过不等于全套通过；最终结果必须覆盖最后改动。

阶段 1 使用 `vitest.config.ts` 的 `test.projects`，不使用 workspace 配置或参数。完整套件只能由 Vitest 进程外的顶层命令编排，测试文件不得执行含自身的 `test`、`test:all` 或 `test:integration` 脚本。Task 2 的配置/日志/telemetry 边界保持。Task 3 加入后，最终全量 unit 为 9 文件 132/132；数据库基础使用真实 PostgreSQL/Flyway/Testcontainers，最终两个 database spec 为 65/65。Inbox 业务处理、真实进程集成和 Outbox worker 测试仍未执行。

Task 3 v1.5 的 platform/worker 两个 database unit spec 已各自覆盖 U01–U12，最终 24/24；独立 TypeScript 7.0.2 strict 命令消费 20 个 `@ts-expect-error`，runtime facade/链式关闭能力为 0。database integration 保持 M01–M17 与 P01–P23；M15/M16 内 scenario 01–24 分别覆盖 raw request 同步/异步/timeout/abort/late settle、Buffer/stream、三路密码、header/payload/trailing/type/reserved、stream error/close/timeout、三类边界、同步异常和 owner/cleanup 合同。空库、重复 migrate、validate、checksum、schema、权限和最终残留均由真实容器通过；每次后续修改仍须重跑完整两个 database spec，不能用 fake runner 代替真实 PostgreSQL。

Task 3 已由用户最终复审并为 VERIFIED v1.5。Task 4 第 7 步外部复审 PASS；[Task 4 v1.10 / LAYOUT-S1](../plans/task-4-unit-of-work/00-index.md) 为 READY v1.10 / EXTERNAL REVIEW PASS，T4R-16～T4R-27 ACCEPT / CLOSED。第 8 步 canonical T4R-27 RED 已证明预期 delegate 0→1 缺陷；冻结 `^LEX01:` 的 EMPTY MATCH 经用户裁决后仅把运行时过滤器修正为 `LEX01:`，不改测试或实现语义。最终 LEX 23/23、SQLPOL 57/57、SQLPOL51～57 真实专项 7/7、Task 4 integration 138/138、完整 database 203/203、unit 132/132、build/typecheck、5/5 canonical 与真实 PostgreSQL/Testcontainers 资源清理全部通过；Task 4 代码为 IMPLEMENTED / VERIFIED，第 8/48 步 COMPLETED。

Task 4 实施结果外部复审现已 PASS。Task 5 的 [v1.3 详细计划](../plans/task-5-inbox-dedup/00-index.md) 冻结 T5C01～T5C50：unit 24 个覆盖完整 Update canonical/HMAC、array own-property 与 Proxy 观察前拒绝、轮换、清零和错误边界；database 26 个覆盖唯一约束、并发、PostgreSQL 微秒 lease/数据库内 `<=`、独立 claimant/generation/inbox CAS、candidate accessor/Proxy 与 claim/mark Date 自有 accessor/method/Date subclass 零触达、普通 Date intrinsic 成功、同 UoW 回滚、完整 runtime sentinel/allowlist、精确 Task 4 连接故障/destroy/normal-release/new-PID、schema 和权限。本轮系统 TEMP 取得 TypeScript 7.0.2 strict/noEmit exit 0、unit 24/24 与 database 26-title collection；没有运行 PostgreSQL，因此 database 不是 PASS，Task 5 项目测试、数据库和代码仍 NOT_STARTED。

## 阶段 1 实施事实（2026-08-17）

四层测试项目落地：unit（191）、database（272，真实 Testcontainers）、integration（43，真实 HTTP server/子进程/屏障并发）、architecture（depcruise + 故意违规 fixture）。已知边界：M14（Windows 前置）、M06/M16（并行负载清理抖动，隔离 PASS）。
