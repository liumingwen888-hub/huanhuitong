# S5-1 转账领域合同与 V7 迁移 详细计划索引

计划版本：`v1.0`。风险级别：`L3`（涉及资金 schema）。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S5-1 代码状态：`NOT_STARTED`。

## 权威需求来源

[阶段 5 总体规划 v1.0](../2026-08-17-stage-5-transfers-redpackets-master-plan.md)（即时到账+免费）、[ledger-model 转账模板](../../architecture/ledger-model.md)、S3-6 internalTransfer 模板已就绪。

## 目标

1. **V7 增量迁移**（须显式授权）：
   - `transfer_orders`：transfer_id PK、order_ref UNIQUE（幂等键）、sender_uid FK、recipient_uid FK、asset_code FK、amount BIGINT CHECK(>0)、fee_amount BIGINT DEFAULT 0、status（PENDING/EXECUTED/FAILED/EXPIRED/REFUNDED）、ledger_transaction_id FK、failure_reason、created_at、executed_at；UNIQUE(order_ref)。
   - `claim_links`：link_id PK、claim_code UNIQUE（一次性领取码）、creator_uid FK、amount、asset_code、status（ACTIVE/CLAIMED/EXPIRED/REFUNDED）、claimer_uid FK NULL、expires_at、claimed_at、ledger_transaction_id FK。
   - `red_packets`：packet_id PK、creator_uid FK、total_amount、packet_count、asset_code、status（ACTIVE/DEPLETED/EXPIRED/REFUNDED）、expires_at；`red_packet_claims`：claim_id PK、packet_id FK、claimer_uid FK、amount、claimed_at、ledger_transaction_id FK；UNIQUE(packet_id, claimer_uid)——同一用户对同一红包只能领一次。
   - 权限：platform 读写；worker 只读。

2. **contracts**：TransferOrderStatus、ClaimLinkStatus、RedPacketStatus、命令/结果类型。

3. **仓储接口**：转账订单（create/findByIdempotencyKey/markExecuted/markFailed）、领取链接（create/findByCode/markClaimed/markExpired）、红包（create/findById/claim 原子/查询剩余）。

## 冻结未来工程矩阵

Create：`database/migrations/V7__stage_5_transfers_redpackets.sql`、`packages/contracts/src/transfers.ts`、platform `modules/transfers/{domain,application,infrastructure}` 五文件、database spec。Modify：contracts index。

## 测试矩阵（S5TC）

- V7 迁移正反（V1-V6 兼容、角色矩阵、CHECK 拒绝）；
- 转账订单幂等创建（同 order_ref 恰一）；
- 领取链接一次性（同 code 二次领取拒绝）；
- 红包同一用户唯一领取（UNIQUE 约束）；
- 过期检测（expires_at < now 的 ACTIVE 记录）。

## 停止条件

V1-V6 兼容破坏、三锁漂移、V7 未获授权。
