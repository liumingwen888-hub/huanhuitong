# 范围、状态与排除项

[返回索引](00-index.md)

## 目标

在 Task 3 `outbox_messages`/`durable_jobs` 表、Task 4 `TransactionContext`/`UnitOfWork` 与 Task 5 Inbox 之上，建立业务事务内原子 Outbox 写入与 worker at-least-once 投递边界：

1. `OutboxRepository.enqueue(tx, envelope)` 与业务效果共用调用方事务，原子提交。
2. worker `claimBatch` 短事务内 `FOR UPDATE SKIP LOCKED` + 原子租约更新（`locked_by`、随机 `lease_token`、`lock_generation` 递增、`locked_until`、`attempt_count`），处理器执行不持有数据库锁。
3. `markSucceeded`/`applyFailure`/`extendLease` 全部以 `id + workerId + leaseToken + lockGeneration + status=LEASED` CAS；受影响行数≠1 返回 `stale_lease`，旧 worker 不得覆盖新租约结果。
4. 投递语义明示 at-least-once；外部成功、本地确认前崩溃时重启重投，重复风险进入运营审计说明，不宣称端到端 Exactly Once。
5. 持久任务状态机：`READY/LEASED/SUCCEEDED/RETRY_WAIT/DEAD_LETTER/PAUSED/WAITING_CONFIGURATION`；瞬时错误有界指数退避（base 1s、cap 15min、全抖动、最多 8 次）；永久错误死信；配置禁用进入 `WAITING_CONFIGURATION` 并从可领取查询排除，不轮询写库、不刷日志。
6. Outbox payload 不含完整 Update、Secret、消息正文；错误分类不序列化原始错误对象。

## 当前状态

- 第 10/48 步：`COMPLETED / EXTERNAL REVIEW PASS`；Task 5 代码：`IMPLEMENTED / VERIFIED / EXTERNAL REVIEW PASS`。
- 第 11/48 步：`IN_PROGRESS`（本计划 DESIGNING→READY v1.0）。
- Task 6 计划：`READY v1.0 / WAITING_EXTERNAL_REVIEW`；代码 `NOT_STARTED`；第 12/48 步 `NOT_STARTED`。

## 方案裁决

- 采用总计划 Task 6 的 Files 清单与 F-05/F-06 裁决，不再重开方案比较：租约表即 `outbox_messages`（Task 3 已建），不引入 advisory lock、Redis 或外部队列。
- canonical fragments 延后到 v1.1 冻结（见 00-index“v1.0 状态说明”）：v1.0 冻结合同、状态机、测试矩阵与步骤；代码正文在合同复审通过后再机械固化，防止未复审合同产生的代码浪费。

## 明确排除

- Telegram 真实发送 Gateway、HTTP 客户端与任何外部业务连接（Task 6 handler 由测试注入 fake）。
- Inbox、身份、注册、`/start` 与主菜单（Tasks 7–10）。
- migration、表结构、索引、角色 grant 修改（沿用 Task 3 schema；若实施中发现 schema 缺口，停下按范围外处理）。
- 生产容量、死信运营 UI、完整告警（阶段 9/10）。
- Git、共享/生产数据库、真实 Secret、依赖与锁文件修改。

## 实施授权边界

本计划是未来施工输入。只有用户外部复审通过 v1.0 合同（如需 v1.1 fragments 再复审一次）并明确授权第 12/48 步后，才可实施。任何范围、接口或锁漂移先停止。
