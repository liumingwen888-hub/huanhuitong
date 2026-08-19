# 下一步

阶段 8 进行中（S8-1～S8-5 已实施 VERIFIED，2026-08-19）。S8-6"结算/释放/冲正"详细计划 v1.0 已完成（`docs/plans/s8-6-settlement-release/`），`READY v1.0 / WAITING_EXTERNAL_REVIEW`。

复审重点：新增 fiatPayoutReversed 冲正补偿模板（镜像成功过账，REVERSE 动作与 SETTLE/RELEASE 互斥）、费用可扣性 fail-closed 与 S6-6 对齐、冲正的合成语义边界（上游回款对账生产阶段）。复审通过后实施（无迁移）。
