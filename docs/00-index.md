# 换汇通文档总索引

这是项目唯一导航入口。每个主题的完整权威来源由 [authority-map.md](governance/authority-map.md) 定义；其他文件只摘要并链接。

## 根规则

- [AGENTS.md](../AGENTS.md)：长期行为、授权、资金、安全和验证底线。
- [README.md](../README.md)：项目入口。
- [AI接手提示词.md](../AI接手提示词.md)：其他电脑、其他设备或新 AI 会话的一键只读接手入口。

## 产品

- [vision.md](product/vision.md)：愿景与原则。
- [scope.md](product/scope.md)：第一阶段、当前交付、未来与非目标。
- [feature-catalog.md](product/feature-catalog.md)：功能归属与状态。
- [user-journeys.md](product/user-journeys.md)：主要用户旅程。
- [exchange-markets.md](product/exchange-markets.md)：14 个期望交易对与配置门槛。
- [open-decisions.md](product/open-decisions.md)：唯一 P0 开放问题清单。

## 状态

- [current.md](status/current.md)：当前权威状态与授权。
- [next.md](status/next.md)：唯一下一步。
- [active-work.md](status/active-work.md)：当前任务、范围、分支与计划。
- [verification.md](status/verification.md)：最近真实验证。
- [progress-log.md](status/progress-log.md)：阶段进展日志。

## 治理

- [authority-map.md](governance/authority-map.md)：冲突优先级与主题权威。
- [state-model.md](governance/state-model.md)：需求与交付状态。
- [skill-routing.md](governance/skill-routing.md)：Skill 最小触发规则。
- [agent-routing.md](governance/agent-routing.md)：代理角色与授权。
- [documentation-contract.md](governance/documentation-contract.md)：任务文档同步合同。
- [ai-handoff.md](governance/ai-handoff.md)：新会话与 AI 交接。
- [.github/copilot-instructions.md](../.github/copilot-instructions.md)：GitHub AI 的仓库级最小入口；完整规则仍以 AGENTS 与 ai-handoff 为准。

## 决策

- [decisions/README.md](decisions/README.md)：决策索引。
- [product-baseline.md](decisions/product-baseline.md)：产品与渠道基线。
- [identity-and-membership.md](decisions/identity-and-membership.md)：UID 与绑定决定。
- [scope-boundaries.md](decisions/scope-boundaries.md)：阶段和未来边界。
- [technical-foundation.md](decisions/technical-foundation.md)：技术基础和方案取舍。

## 架构

- [system-context.md](architecture/system-context.md)：参与者、外部系统和系统边界。
- [runtime-topology.md](architecture/runtime-topology.md)：未来 Monorepo 和进程拓扑。
- [domain-map.md](architecture/domain-map.md)：依赖方向和领域协作。
- [data-and-money-flow.md](architecture/data-and-money-flow.md)：身份、链上、转账、换汇和代付资金流。
- [ledger-model.md](architecture/ledger-model.md)：复式账本、金额与记账模板。
- [trust-boundaries.md](architecture/trust-boundaries.md)：信任与敏感数据边界。
- [integration-model.md](architecture/integration-model.md)：Telegram、链和供应商适配。

## 领域

- [domains/README.md](domains/README.md)：17 个领域及依赖说明。
- [identity-and-membership](domains/identity-and-membership.md)
- [account-security-and-recovery](domains/account-security-and-recovery.md)
- [asset-custody](domains/asset-custody.md)
- [ledger-and-balances](domains/ledger-and-balances.md)
- [deposits](domains/deposits.md)
- [internal-transfers](domains/internal-transfers.md)
- [claims](domains/claims.md)
- [red-packets](domains/red-packets.md)
- [withdrawals](domains/withdrawals.md)
- [exchange](domains/exchange.md)
- [fiat-payouts](domains/fiat-payouts.md)
- [fees-and-risk](domains/fees-and-risk.md)
- [bills-and-reconciliation](domains/bills-and-reconciliation.md)
- [telegram-experience](domains/telegram-experience.md)
- [admin-and-audit](domains/admin-and-audit.md)
- [platform-operations](domains/platform-operations.md)
- [future-apps-and-integrations](domains/future-apps-and-integrations.md)

## 安全

- [threat-model.md](security/threat-model.md)：资产、边界、威胁与控制。
- [risk-register.md](security/risk-register.md)：风险登记与负责人角色。
- [security-gates.md](security/security-gates.md)：代码、合并、发布和运行门禁。

## 测试

- [strategy.md](testing/strategy.md)：测试层次与高风险矩阵。
- [acceptance-gates.md](testing/acceptance-gates.md)：规划、实现、资金和发布验收。

## 运维

- [observability.md](operations/observability.md)：日志、指标、追踪与告警。
- [backup-and-recovery.md](operations/backup-and-recovery.md)：备份、恢复和副作用暂停。
- [release-gates.md](operations/release-gates.md)：未来发布门禁。

## 研究

- [source-register.md](research/source-register.md)：Telegram 与阶段 1 技术计划采用的官方来源。
- [telegram-feasibility.md](research/telegram-feasibility.md)：Bot 能力与产品约束。

## 计划

- [roadmap.md](plans/roadmap.md)：阶段 0 至 11。
- [active-plan-index.md](plans/active-plan-index.md)：活动计划索引。
- [AI 第一接手提示词设计](superpowers/specs/2026-08-05-ai-first-step-handoff-prompt-design.md)：根目录中文接手提示词的批准规格。
- [AI 第一接手提示词实施计划](superpowers/plans/2026-08-05-ai-first-step-handoff-prompt.md)：创建、验证与私有 GitHub 发布步骤。
- [foundation-plan.md](plans/foundation-plan.md)：阶段 0 基线计划。
- [2026-07-20-stage-1-foundation-identity-implementation-plan.md](plans/2026-07-20-stage-1-foundation-identity-implementation-plan.md)：阶段 1 总体实施计划 v1.2.6 READY；阶段 1 代码 BUILDING，Tasks 1–4 VERIFIED，Tasks 5–14 NOT_STARTED。
- [2026-07-21-stage-1-task-2-config-observability-implementation-plan.md](plans/2026-07-21-stage-1-task-2-config-observability-implementation-plan.md)：Task 2 配置、结构化日志和 OpenTelemetry 基础独立详细计划 v1.2.6；用户最终复审 PASS、R5-01 ACCEPT，代码与测试 VERIFIED。
- [2026-07-23-stage-1-task-3-database-foundation-implementation-plan.md](plans/2026-07-23-stage-1-task-3-database-foundation-implementation-plan.md)：Task 3 PostgreSQL、Kysely、Flyway 和 Testcontainers 基础独立详细计划及实施权威；第 6 步最终复审 PASS，T3R-13 已关闭，详细计划、代码与测试 VERIFIED v1.5，未解决阻断 0。
- [task-4-unit-of-work/00-index.md](plans/task-4-unit-of-work/00-index.md)：Task 4 Unit of Work 与 PostgreSQL 事务边界独立详细计划入口，技术版本 v1.10 / EXTERNAL REVIEW PASS、文档布局 LAYOUT-S1 VERIFIED，T4R-16～T4R-27 ACCEPT / CLOSED。第 8/48 步 COMPLETED，Task 4 代码 IMPLEMENTED / VERIFIED；[历史路径兼容入口](plans/2026-07-25-stage-1-task-4-unit-of-work-implementation-plan.md) 保留。
- [task-5-inbox-dedup/00-index.md](plans/task-5-inbox-dedup/00-index.md)：Task 5 Inbox 与 Telegram Webhook 去重独立详细计划唯一入口；v1.3 已实施并通过外部复审（第 10/48 步 COMPLETED，代码 IMPLEMENTED / VERIFIED / EXTERNAL REVIEW PASS）。
- [task-6-outbox-worker/00-index.md](plans/task-6-outbox-worker/00-index.md)：Task 6 Outbox、持久任务与安全 Worker 独立详细计划唯一入口；READY v1.0 / WAITING_EXTERNAL_REVIEW，T6C01–T6C28 测试合同、冻结 Create 8/Modify 2/Delete 0；已实施并通过外部复审（第 12/48 步 COMPLETED）。
