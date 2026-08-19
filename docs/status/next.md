# 下一步

阶段 6 进行中（阶段 1–5 已 VERIFIED，S6-1～S6-5 已实施 VERIFIED）。S6-6"提现完成/失败结算"详细计划 v1.0 已完成（`docs/plans/s6-6-settlement-release/`），`READY v1.0 / WAITING_EXTERNAL_REVIEW`。

复审重点：结算前链上权威复查（不信任调用方传入的 ready 标记）、费用不可扣时的 fail-closed 方向（订单停留 BROADCAST 待运营，绝不部分收费）、过期 TTL 无配置时的反向 fail-closed（无配置不过期——误杀进行中审批比挂起更危险）。复审通过后实施（仓储增 findExpirable，无迁移）。
