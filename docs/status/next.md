# 下一步

阶段 10 进行中（S10-1～S10-3 已实施 VERIFIED，2026-08-19）。S10-4"恢复演练"详细计划 v1.0 已完成（`docs/plans/s10-4-restore-drill/`），`READY v1.0 / WAITING_EXTERNAL_REVIEW`。

复审重点：无重复副作用断言（恢复不是重发器——Outbox 原样保留 + 无新 LEASED）、失败保留现场（不静默清理）、RestoreRun 五状态机的通过/失败判据。复审通过后实施（无迁移）。
