# S6-8 威胁模型与验收 详细计划索引

计划版本：`v1.0`。风险级别：`L3`（阶段收官验收）。计划状态：`READY v1.0`（2026-08-19 用户"继续下一步工作"授权实施；验收结果的最终复审即阶段 6 用户验收）。S6-8 代码状态：`VERIFIED`（2026-08-19：S6A01-12 全 PASS、威胁模型九项增补落档、全量回归绿——见下）。

## 权威需求来源

[阶段 6 总体规划 v1.0](../2026-08-17-stage-6-withdrawals-master-plan.md)（S6-8 任务行 + 进入下一阶段证据列）、[威胁模型](../../security/threat-model.md)（阶段 1–5 增补先例）、S6-1～S6-7 各计划实施验证节。

## 目标

1. **阶段 6 威胁模型增补**：提现特有的九类威胁与控制映射（双付崩溃窗口、UNKNOWN 误判、审批合谋/自批、证明重放/替换、费用不可扣挪用、过期误杀、签名密钥越界、通知泄露、NULL-owner 建户缺陷），证据指向验收测试编号。
2. **全链路验收规格**（S6A01–S6A12，integration 项目）：六服务真实组合（申请/审批/签名/广播/结算 + FakeSigner + 确定性广播 Fake）驱动端到端生命周期。

## 验收矩阵（S6A）

- S6A01 低额自动轨全链路（申请→自动批准→签名→广播→链确认→结算→CONFIRMED；四账户终态断言）
- S6A02 高额双审批全链路（两票→…→CONFIRMED）
- S6A03 拒绝→退款全链路（资金全额回可用）
- S6A04 链上失败→退款全链路
- S6A05 过期→退款全链路（TTL 命中 + 释放）
- S6A06 全链路幂等扫荡（request/sign/broadcast/settle 各重放一次；FREEZE/SETTLE 账本各恰好一笔）
- S6A07 UNKNOWN 广播恢复（零状态写入→重试成功）
- S6A08 并发双审批（两管理员并发；恰好一次 APPROVED 迁移、两行审批记录）
- S6A09 账本守恒与对账（全链路后：借贷总额相等、每账户投影 == 权威重算）
- S6A10 通知完整性（成功链主题集合恰为 requested/approved/broadcast/succeeded 各一；零失败主题）
- S6A11 Outbox 载荷零敏感（全部提现主题 payload 无 password/key/secret/digest 字段）
- S6A12 状态机一致性（终态订单的冻结/收口过账关联存在且方向正确；非终态无收口关联）

## 冻结未来工程矩阵

Create：`apps/platform/test/integration/stage-six-acceptance.integration.spec.ts`。Modify：`docs/security/threat-model.md`（阶段 6 增补节）。

## 实施验证（2026-08-19，macOS/arm64 本地）

- S6A01–S6A12 全 PASS（12/12）：自动轨/双审批两条全链路、拒绝/链失败/过期三条退款链、崩溃窗口幂等扫荡（FREEZE/SETTLE 各恰好一笔）、UNKNOWN 恢复、并发双审批恰好一次、账本借贷平衡 + 投影与权威重算零偏差、通知主题集合精确、载荷零敏感字段、终态订单双过账关联。
- 阶段 6 威胁模型增补九项落档（docs/security/threat-model.md），证据指向 S6A/S6W* 编号。
- 全量回归：unit 29 文件 235/235；database 38 文件 440/443（M06/M14/M16 已知环境边界项）；integration 11 文件 97/97（阶段 1–5 历史验收规格全数复跑通过）。

## 停止条件

任一验收项失败且根因在 S6-1～S6-7 交付物（回溯修复后重跑全矩阵）。
