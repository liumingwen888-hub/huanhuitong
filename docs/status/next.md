# 下一步

阶段 7 进行中（S7-1～S7-4 已实施 VERIFIED，2026-08-19）。S7-5"失败/过期/UNKNOWN 处理"详细计划 v1.0 已完成（`docs/plans/s7-5-failure-expiry/`），`READY v1.0 / WAITING_EXTERNAL_REVIEW`。

复审重点：两步释放（决策态与资金动作分离）、挂单超时 TTL 的反向 fail-closed（无配置不扫描——误杀进行中换汇比挂起更危险）、合成期 UNKNOWN 原则形态（结算失败停留 EXECUTING 可重试，唯一人工失败入口带 reason）。复审通过后实施（无新迁移）。
