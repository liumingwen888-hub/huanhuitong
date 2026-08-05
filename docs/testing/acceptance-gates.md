# 验收门禁

需求状态：APPROVED。交付状态：DESIGNING。

## 规划验收

要求权威文件完整非空、总索引覆盖、相对链接有效、17 个领域文档一致、状态不冲突、P0 不超过 10、未来能力未进入开发、不含业务代码或敏感信息，开发授权为 0。

## 领域实现验收

每个功能必须有 APPROVED 需求、设计、威胁模型、书面计划、TDD 证据、代码与安全审查、领域/架构文档同步和用户验收。状态机所有非法转换被拒绝，公开接口有契约与错误语义。

阶段 1 的 23 项具名验收还必须覆盖：Inbox 同 ID 的完整 Update canonical HMAC duplicate/conflict、object key-order 等价、字段变化、key rotation retained replay、缺 key 失败关闭和 raw-column 禁止；Flyway LOGIN + SET ROLE 与 platform/worker 越权拒绝；Outbox workerId/lease token/generation CAS 与 at-least-once 崩溃重投；配置禁用不忙循环；合法非文本 Telegram Update 的 200 ignored；grammY adapter 零网络；日志与 trace 的值级 raw Update/key material 防泄漏；服务端 registrationKey 派生；以及真实 platform/worker 进程的 readiness、SIGTERM 和清理。计划内测试未获授权运行前不得报告 PASS。

Task 3 数据库基础已通过用户最终复审并为 VERIFIED v1.5：19 个工程路径精确落位，build/typecheck、database unit 24/24、全量 unit 132/132、M01–M17、P01–P23、scenario 01–24 和真实 database 65/65 通过；锁定镜像平台 2/2，越权、Secret、raw Inbox 列、资金/链字段和资源残留均为 0。T3R-13 已关闭；未来 Task 12 的 `.dependency-cruiser.cjs` 缺失不是 Task 3 阻断。

Task 4 代码验收必须以[独立详细计划 v1.10 / LAYOUT-S1](../plans/task-4-unit-of-work/00-index.md) 的 UOW01–UOW25、REV01、CLEAN01、REL01–REL05、IMM01、TXCTL01–TXCTL25、LEX01–LEX23 与 SQLPOL01–SQLPOL57 共 138 条为准：实施前 `146/91/55`，Create 3/Modify 2/Delete 0 后 `149/91/58`；五文件唯一施工输入位于 [canonical fragments](../plans/task-4-unit-of-work/fragments/00-index.md)，Step 62 必须按 manifest 重构为 5/5 IDENTICAL；Step 8～26 必须为 19/19 STEP-FILTER IDENTICAL、LEX union 23/23、duplicate 0、empty 0；九个既有过滤器及 `SQLPOL(0[1-9]|[1-4][0-9]|5[0-7])`=57 必须有精确真实匹配数，完整文件 skipped 0。T4R-27 RED 必须只从当前 canonical 在 TEMP 以两处各命中 1 的反向 delta 重建 24624/878/指定哈希的 v1.8，SQLPOL51 连续两次和 51～57 批量均须核对精确失败 ID、delegate 0→1 原因与环境错误 0；恢复 canonical 后须 7/7 GREEN。同一 callback 使用同一 executor/connection/backend，settle 后先 revoke；同连接 pre-commit probe 排除 aborted false success。callback SQL 只能经 QueryCreator 或受保护 executeSql/CallbackConnection，在发送前由 ordinary/E-string scanner 与有限 allowlist 共同约束：顶层只允许 SELECT/INSERT/UPDATE/DELETE/MERGE/VALUES 及最终属于这些族的 WITH，其余语句 fail closed；有效 token 中精确 `set_config`/`pg_catalog.set_config` 调用及每一可执行语句作用域中的精确 `UPDATE [ONLY] pg_settings`/`pg_catalog.pg_settings` 必须拒绝，UPDATE、可选 ONLY、目标 identifier 与点号必须位于正确的同一 depth，不得使用 substring；字符串、Escape string、dollar quote、注释、只读 `current_setting`、普通标识符、普通业务数据修改 CTE 与只读 pg_settings CTE不得误报。所有策略拒绝须直接证明第一次目标 delegate 0，不得只依赖 pg extended config，后者只作第二层；内部 BEGIN/COMMIT/ROLLBACK 与必要 SET LOCAL 只能走 UnitOfWork 私有 connection，callback 不得取得或伪装私有通道。wrapper 必须记录 outcome/poison，普通 release failure 尝试 destroy fallback，且 COMMITTED、ROLLED_BACK、UNKNOWN、callback+rollback、commit+rollback 分类不被 cleanup failure 覆盖；真实 PostgreSQL 故障须直接观察 `release(true)`、failed pid 普通归还 0 和后续新 pid，并证明多语句零部分副作用。三类 identity-safe error 必须具有模块私有 WeakSet 品牌、固定不可写脱敏 stack、冻结实例/prototype 和精确类型检查；beforeAll 与 CLEAN01 必须共用 setup/catch 并覆盖部分初始化 cleanup。最终 Step 63 必须是最后编号步骤，自行创建并清理 TEMP type=module 环境，用 TypeScript 7.0.2 strict/noEmit 编译五文件，diagnostics/TS2578 均为 0。第 7 步的 TEMP future 证据不替代第 8 步已经取得的真实 138/138 database integration、unit、typecheck、build 和资源清理证据；Task 4 代码为 IMPLEMENTED / VERIFIED，第 8/48 步 COMPLETED。

### Task 4 实施验收结果

第 7 步外部复审已经 PASS。第 8 步冻结 `-t '^LEX01:'` 的 0 matched / 138 skipped 被正确判为 EMPTY MATCH；用户确认 Vitest 4.1.10 完整名称匹配根因后，运行时过滤器最小修正为 `-t 'LEX01:'` 并得到唯一 LEX01、1/1 PASS、137 skipped。Task 4 最终达到 138/138 unique、LEX 23/23、SQLPOL 57/57、SQLPOL51～57 真实 7/7、完整 database 203/203、unit 132/132、build/typecheck exit 0、5/5 canonical、149/91/58、三锁不变和资源残留 0。Task 4 代码为 IMPLEMENTED / VERIFIED / EXTERNAL REVIEW PASS，第 8/48 步 COMPLETED / EXTERNAL REVIEW PASS。

Task 5 实施验收以 [v1.3 独立详细计划](../plans/task-5-inbox-dedup/00-index.md) 的 Step 1～40、T5C01～T5C50 与七文件 canonical manifest 为准：未来 Create 6/Modify 1/Delete 0；unit 24、真实 database 26 且连续两次、全量 unit/database、build/typecheck、完整 Update fixed vector/array own-property/Proxy观察前拒绝、轮换/清零、PostgreSQL 微秒 lease 与数据库内 `<=`、旧 claimedUntil 精确相等 CAS 0、独立 claimant/generation/inbox CAS、candidate accessor/Proxy 与 claim/mark Date 自有 accessor/method/Date subclass authentic error 和零触达、普通 Date intrinsic 成功、完整 runtime sentinel/allowlist、精确 Task 4 callback+rollback failure/destroy/normal-release/new-PID、同 UoW rollback、schema/权限、三锁和资源残留均须新鲜通过。实施 Step 1 与回滚必须使用用户在第 10/48 步授权中明确提供且外部复审通过的最新完整 Task 5 计划 ZIP，不得硬编码历史 v16/v17。当前第 9/48 步只有 TEMP TypeScript 7.0.2 strict/noEmit、unit 24/24、database 26-title collection 与直接探针的计划可执行性证据；未运行 PostgreSQL，Task 5 代码与第 10/48 步仍 NOT_STARTED。

## 资金验收

- 第一个资金功能开始前，最小费用、风险、限额、追加式审计、配置版本、管理授权、订单到账本关联、对账与可靠任务合同可验证。
- 所有账本交易借贷平衡且不可变。
- 重复/并发请求最多产生一个授权结果和一次资金效果。
- 余额不得为负，冻结、在途和可用用途不混淆。
- UNKNOWN 不释放、不重付，恢复后不重复外部动作。
- 费用、收入、上游成本和舍入独立。
- 业务订单、账本、外部结果和账单可追踪并能对账。
- 提现开始前，独立管理员身份、Maker-Checker、高风险重新认证、Signer 策略审批和审计证据可验证。

## 发布验收

功能、集成、性能、安全、观测、备份恢复、对账、合规与回滚全部有环境证据；生产部署授权大于 0。缺少任何一项不得标记 VERIFIED 或 RELEASED。
