# 下一步

阶段 6 进行中（阶段 1–5 已 VERIFIED，S6-1/S6-2 已实施 VERIFIED）。S6-3"Maker-Checker 审批流"详细计划 v1.0 已完成（`docs/plans/s6-3-withdrawal-approval/`），`READY v1.0 / WAITING_EXTERNAL_REVIEW`。

复审重点：分级阈值规则（minAutoAmount/dualApprovalThreshold/maxAmount 三段）、fail-closed 默认（配置缺失一律双审批）、必需角色定为 FINANCE_OFFICER（SUPER_ADMIN 不直接审批的职责分离）、并发双批的 CAS 恰好一次迁移。复审通过后实施（无新迁移）。
