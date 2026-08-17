# 平台运维领域

## 目标

保证持久任务、观测、备份、恢复和发布过程可验证，不因故障或恢复重复执行资金动作。

## 职责

Outbox/Inbox、任务租约与重试、健康与容量、指标/日志/追踪、备份、恢复演练、灾难模式和发布门禁。

## 不负责什么

不解释业务成功，不修改账本，不用缓存替代事实源，不让恢复任务在对账前自动向外付款。

## 用户流程

用户只感知稳定状态和明确的处理中提示。运维人员按权限查看健康、暂停新订单、恢复服务；恢复后先冻结外部副作用，核对时间点、任务租约、Outbox 和资金差异，再逐步恢复。

## 核心实体

OutboxMessage、InboxReceipt、DurableJob、JobLease、RetryPolicy、OperationalIncident、BackupSet、RestoreRun、ReleaseGate。

## 状态机

Job：READY、LEASED、SUCCEEDED、RETRY_WAIT、DEAD_LETTER、PAUSED、WAITING_CONFIGURATION。Restore：PLANNED、RESTORING、VALIDATING、RECONCILING、SAFE_TO_RESUME、FAILED。

## 输入

领域事件、任务、运行遥测、备份清单、恢复点、发布候选和止损命令。

## 输出

可靠消息、任务结果、告警、恢复证据、发布决定和运营审计。

## 公开接口或事件

EnqueueOutbox、ClaimJob、RecordInbox、PauseSideEffects、ValidateRestore、EvaluateReleaseGate；JobFailed、SideEffectsPaused、RestoreValidated。

## 依赖方向

为所有领域提供可靠性设施，但不被业务领域内部实现反向侵入；依赖 PostgreSQL、OpenTelemetry 和备份基础设施。

## 资金影响

不直接记账；错误重试可能造成重复外部支付，因此所有任务必须携带业务幂等键，恢复后先查询和对账。

## 幂等要求

Outbox 事件 ID、Inbox 外部 ID、任务业务键和租约代次唯一；崩溃重启、租约过期和重复投递安全。

阶段 1 v1.2 计划将 Outbox 定义为 at-least-once。所有完成、失败和续租以 workerId、lease token、lock generation CAS；外部副作用成功但本地确认前崩溃允许重投，使用接收方幂等键或记录重复风险并审计/补偿。配置禁用不是瞬时错误：handler 不注册或任务进入 WAITING_CONFIGURATION，不得忙循环、持续写库或刷日志。

阶段 1 v1.2.2 计划边界（未实现）：Inbox 对进入业务处理的 Telegram Update 只保存完整 parsed Update 的 canonical JSON 版本化 HMAC `payload_digest` 与 `digest_key_version`，不保存 raw Update、正文、callback 或 canonical bytes。新记录使用 current key；重放按原记录 key version 比对 retained/current candidate。旧 key 保留不得短于 Inbox 保留期加 Telegram 重试窗口；缺少原版本 key 必须失败关闭、不得产生身份或 Outbox 效果。摘要/key material 不得进入日志、trace、Outbox 或 audit。

## 安全要求

最小运行权限、日志脱敏、备份加密、恢复隔离、发布签名、生产操作审批和秘密引用而非明文配置。

## 审计要求

记录任务重试、暂停/恢复、备份、恢复点、验证、发布门禁和生产操作，不记录 Secret。

## 测试重点

进程崩溃、重复投递、租约竞争、死信、备份损坏、时间点恢复、恢复后重复副作用和回滚。

## 需求状态

可靠性与恢复原则 APPROVED；RPO/RTO 和基础设施参数 DRAFT。

## 交付状态

NOT_STARTED。

## 开发门禁

阶段 1 必须先建立 PostgreSQL 事务边界、Unit of Work、Inbox、Outbox、持久任务、结构化日志、OpenTelemetry 接口、配置校验和敏感字段日志过滤的最小框架；第一个资金功能前验证任务幂等和最小对账调度。阶段 10 再完成生产级容量、完整告警、备份恢复、灾难演练、资金对账和发布门禁证据。当前开发与部署授权均为 0。

## 待确认问题

具体生产环境与法律数据要求受 [P0 第 9 项](../product/open-decisions.md) 影响；没有新增 P0。

## 阶段 1 实施事实（2026-08-17）

已实施：UoW 单连接事务边界、Inbox（RECEIVED/CLAIMED/PROCESSED/CONFLICT/FAILED + 30s 数据库时钟租约 + CAS）、Outbox at-least-once（FOR UPDATE SKIP LOCKED + 四元组 CAS + 七态）、持久任务、有界全抖动退避、F-06 禁用 WAITING_CONFIGURATION 零写库零日志。生产容量/告警/备份属阶段 10。
