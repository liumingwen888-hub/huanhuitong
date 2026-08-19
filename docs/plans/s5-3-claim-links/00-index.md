# S5-3 领取链接服务 详细计划索引

计划版本：`v1.0`。风险级别：`L3`。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S5-3 代码状态：`NOT_STARTED`。

## 权威需求来源

[阶段 5 总体规划 v1.0](../2026-08-17-stage-5-transfers-redpackets-master-plan.md)（24h 过期+惰性退款）、[ledger-model 红包/领取模板](../../architecture/ledger-model.md)、S5-1 ClaimLinkRepository、S5-2 TransferExecutionService 模式。

## 目标

**`ClaimLinkService`**——一次性领取链接的完整生命周期：

1. **创建链接** `createLink(creatorUid, assetCode, amount): ClaimLinkSnapshot`：
   - 生成 claim_code（随机 UUID 或短码）；
   - 冻结资金：DR creator USER_AVAILABLE / CR CLAIM_LIABILITY（S3-6 redPacketCreated 同构）；
   - 过期时间：24 小时（可配置）；
   - Outbox 通知 creator。

2. **领取** `claim(claimCode, claimerUid): ClaimResult`：
   - findByCode → ACTIVE + 未过期 → 执行；
   - 过账：DR CLAIM_LIABILITY / CR claimer USER_AVAILABLE（S3-6 claimExecuted 同构）；
   - markClaimed CAS（S5-1 已有，含 expires_at > now 条件）；
   - Outbox 通知双方。

3. **过期退款** `expireLink(linkId)`：
   - 检查 ACTIVE + expires_at <= now；
   - 反向过账：DR CLAIM_LIABILITY / CR creator USER_AVAILABLE（资金退回）；
   - markExpired CAS；
   - 惰性触发：领取时发现过期 → 自动退款。

## 冻结未来工程矩阵

Create：`apps/platform/src/modules/transfers/application/claim-link.service.ts`、`test/database/claim-link.integration.spec.ts`。Modify：0。

## 测试矩阵（S5CL）

- 创建链接：冻结正确（creator 可用减少/领取负债增加）+ claim_code 生成 + 通知；
- 正常领取：冻结释放（负债减少/claimer 可用增加）+ CAS + 双端通知；
- 重复领取拒绝（markClaimed CAS）；
- 过期后领取拒绝 + 自动退款（惰性检查）；
- 并发领取恰一成功。

## 停止条件

需要新迁移、需要绕过 S3-2 过账内核、三锁漂移。
