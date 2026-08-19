# 下一步

S6-1（提现领域合同与 V8 迁移）已于 2026-08-19 实施完成并验证：V8 三表（withdrawal_orders 10 态 / withdrawal_approvals UNIQUE / signer_policies 版本化）、contracts/withdrawals.ts、平台 withdrawals 模块三仓储、S6WC01–06 集成测试全 PASS。

下一步：**S6-2 提现申请与冻结服务**详细计划（支付密码验证 → RiskGate → withdrawalRequested 模板过账（DR 可用/CR 冻结）→ 订单 FROZEN → 双轨路由（低额自动 APPROVED / 高额 PENDING_APPROVAL）→ Outbox 通知）。等待用户"继续下一步工作"启动。
