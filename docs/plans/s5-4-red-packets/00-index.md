# S5-4 红包服务 详细计划索引

计划版本：`v1.0`。风险级别：`L3`。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S5-4 代码状态：`NOT_STARTED`。

## 权威需求来源

[阶段 5 总体规划 v1.0](../2026-08-17-stage-5-transfers-redpackets-master-plan.md)（普通固定金额红包）、[ledger-model 红包模板](../../architecture/ledger-model.md)、S5-1 RedPacketRepository、S5-3 ClaimLinkService 模式复用。

## 目标

**`RedPacketService`**——多份红包的完整生命周期：

1. **创建红包** `createPacket(creatorUid, assetCode, totalAmount, packetCount, perPersonAmount)`：
   - 冻结：DR creator 可用 / CR CLAIM_LIABILITY（同链接创建）；
   - 红包记录：red_packets 表（packetCount、expires_at 24h）；
   - Outbox 通知 creator。

2. **领取** `claimPacket(packetId, claimerUid)`：
   - UNCLAIMED + ACTIVE + 未过期；
   - 每人金额 = totalAmount / packetCount（普通固定）；
   - 过账：DR CLAIM_LIABILITY / CR claimer 可用（同链接领取）；
   - claimPacket（S5-1 已有：UNIQUE + ON CONFLICT）+ 领完自动 DEPLETED；
   - Outbox 通知双方。

3. **过期退款** `expirePacket(packetId)`：
   - ACTIVE + expires_at <= now；
   - 剩余金额 = totalAmount - 已领取总额；
   - 退款：DR CLAIM_LIABILITY / CR creator 可用；
   - markExpired。

## 与 S5-3 的核心差异

| 维度 | 领取链接 | 红包 |
|---|---|---|
| 份额 | 1 份（一次性） | N 份（packetCount） |
| 领取者 | 1 人 | 多人（每人最多一次） |
| 领完状态 | CLAIMED | DEPLETED |
| 过期退款 | 全额退回 | 仅退剩余未领取部分 |

## 冻结未来工程矩阵

Create：`apps/platform/src/modules/transfers/application/red-packet.service.ts`、`test/database/red-packet.integration.spec.ts`。Modify：0。

## 测试矩阵（S5RP）

- 创建红包：冻结正确（creator 可用减少 / 负债增加）；
- 领取：每人金额正确 + 多人可领 + 负债逐次减少；
- 同一用户重复领取拒绝；
- 领完自动 DEPLETED + 后续领取拒绝；
- 过期退款：仅退剩余（已领部分不退）；
- 并发领取恰一 per user。

## 停止条件

需要新迁移、需要绕过 S3-2 过账内核、三锁漂移。
