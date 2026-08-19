# S4-5 充值入账编排 详细计划索引

计划版本：`v1.0`。风险级别：`L3`（资金写入口编排）。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S4-5 代码状态：`NOT_STARTED`。

## 权威需求来源

[阶段 4 总体规划](../2026-08-17-stage-4-deposits-master-plan.md)、[ledger-model 充值模板](../../architecture/ledger-model.md)、S4-4 确认输出、S3-6 depositConfirmed 模板、S3-2 PostMoneyService。

## 目标

**`DepositPostingService`**——充值全链路汇聚点：把 CONFIRMED 检测转为账本过账 + Outbox 通知：

1. **入账编排** `postConfirmedDeposits(network): Promise<PostingBatchResult>`：
   ```
   for each CONFIRMED detection (ordered by detected_at):
     1. 幂等检查：detection.ledger_transaction_id != null → 跳过（已入账）
     2. 构造 PostMoneyCommand：
        - 模板：depositConfirmed(custody, userAvailable, amount, orderId=`DEP:{network}:{txid}`)
        - custody：platform 账户（PLATFORM_CUSTODY, asset）
        - userAvailable：uid 的 USER_AVAILABLE 账户（S3-1 openUserAccount 或已存在）
     3. PostMoneyService.post(command)
     4. 检测状态 CAS：CONFIRMED→POSTED + ledger_transaction_id 写入
     5. Outbox 通知：telegram.deposit-confirmed.v1（uid/chatRef/金额/资产摘要）
   ```

2. **幂等三层防线**：
   - detection.ledger_transaction_id 非空 → 跳过（应用层）；
   - PostMoneyCommand 幂等键 = `DEPOSIT:{network}:{txid}:CONFIRM:0`（账本层 UNIQUE）；
   - CONFIRMED→POSTED CAS（状态层——并发恰一）。

3. **账户自动开通**：用户首次充值时自动 openUserAccount（方案 A——显式幂等，S3-1 语义）。custody 平台账户由 bootstrap 或配置创建。

4. **失败处理**：过账失败（如负余额——不应发生但防线兜底）→ CONFIRMED→FAILED_POST + 错误码记录；**不自动重试**——等待人工裁决。

## 冻结未来工程矩阵

Create：`apps/platform/src/modules/deposits/application/deposit-posting.service.ts`、`test/database/deposit-posting.integration.spec.ts`。Modify：0。

## 测试矩阵（S4PO）

- 确认检测入账：CONFIRMED → POSTED + ledger_entries 落库 + 投影正确 + Outbox 通知生成；
- 幂等：同检测重复 postConfirmedDeposits → 零新过账零新通知；
- 并发：双连接同时入账同一检测 → 恰一 POSTED；
- 用户可用账户自动开通（首次充值前无账户 → 充值后存在）；
- 过账失败路径：注入失败 → FAILED_POST + 不自动重试；
- 多笔批量：多 CONFIRMED 检测按时间序全部入账。

## 停止条件

需要新迁移、需要绕过 S3-2 过账内核、三锁漂移。

## 裁决

- 幂等键格式 `DEPOSIT:{network}:{txid}:CONFIRM:0`——网络+txid 唯一标识一笔链上充值，操作=CONFIRM，代次=0（重试由 S3-2 幂等查重处理，不递增代次）。
- 通知 topic：`telegram.deposit-confirmed.v1`（worker 侧需注册对应 handler——S4-5 一起实施或留 S4-6 归集时统一处理）。
