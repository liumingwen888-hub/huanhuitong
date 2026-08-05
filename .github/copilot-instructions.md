# 换汇通仓库级 AI 指令

开始任何任务前，先读取根目录 `AGENTS.md`，再按其上下文恢复顺序读取 `docs/00-index.md`、`docs/status/current.md`、`docs/status/next.md`、`docs/status/active-work.md`、`docs/product/open-decisions.md`、`docs/plans/active-plan-index.md` 和当前计划。

当前断点（2026-08-05）：第 9/48 步 `WAITING_EXTERNAL_REVIEW`；Tasks 1–4 `VERIFIED`；Task 5 详细计划 `READY v1.3 / WAITING_EXTERNAL_REVIEW`；Task 5 代码和第 10/48 步 `NOT_STARTED`。唯一下一步是等待用户外部复审 Task 5 v1.3。未获新的复审结论和明确实施授权时，不实施 Task 5。

完整交接说明见 `docs/governance/ai-handoff.md`。不要从聊天记录、历史报告或计划代码块推断当前实现；已执行事实只取 `docs/status/verification.md`。

不可变底线：PostgreSQL 是事实源；资金只经复式账本；JavaScript `number` 不承载金额；`UNKNOWN` 不自动重付；内部 UID 是资产主体；默认拒绝权限；真实 Secret、Bot Token、私钥、支付密码、验证码和恢复凭证不得进入代码、文档、日志、trace、普通审计或测试 fixture。

修改必须遵守计划文件矩阵、TDD、文档同步合同和完成前真实验证。未经用户明确授权，不新增依赖、migration、外部服务连接、共享/生产数据库、部署、Git push、PR 或 release。
