# 权威来源映射

状态：APPROVED。交付状态：READY。

## 优先级

同一主题发生冲突时按以下顺序处理：

1. 用户当前明确指令。
2. 目标目录适用的最近层级 AGENTS.override.md 或 AGENTS.md。
3. 本文件定义的主题权威文档。
4. 已批准决策记录。
5. 计划、状态摘要和研究记录。
6. 聊天上下文仅作线索，不是权威。

无法判断时，将冲突记录到 [开放决策](../product/open-decisions.md)。资金、安全、身份、权限和范围冲突在决定前停止实现。

## 主题归属

| 主题 | 完整权威来源 |
|---|---|
| 长期协作与授权规则 | [AGENTS.md](../../AGENTS.md) |
| 导航与主题映射 | [docs/00-index.md](../00-index.md) |
| 产品愿景、范围、功能、旅程、交易对 | [product](../product/vision.md) 目录内对应文件 |
| P0 与 DRAFT 决策 | [open-decisions.md](../product/open-decisions.md) |
| 当前、下一步、活动、验证、进度 | [status](../status/current.md) 目录内对应文件 |
| 状态语义 | [state-model.md](state-model.md) |
| Skill 与代理触发 | [skill-routing.md](skill-routing.md)、[agent-routing.md](agent-routing.md) |
| 文档更新与交接 | [documentation-contract.md](documentation-contract.md)、[ai-handoff.md](ai-handoff.md) |
| 已批准决定的理由 | [decisions](../decisions/README.md) |
| 系统、运行时、领域、资金流、账本、信任、集成 | [architecture](../architecture/system-context.md) 目录内对应文件 |
| 每个业务领域完整规则 | [domains](../domains/README.md) 中对应领域文档 |
| 威胁、风险、安全门禁 | [security](../security/threat-model.md) |
| 测试方法与验收 | [testing](../testing/strategy.md) |
| 可观测性、备份恢复、发布 | [operations](../operations/observability.md) |
| 外部事实与来源 | [research](../research/source-register.md)，不得直接升级为产品决定 |
| 路线与未完成计划 | [plans](../plans/roadmap.md) |

决策记录解释“为什么”，领域或架构文档描述“现在的规则”。摘要不得复制完整权威规则。

