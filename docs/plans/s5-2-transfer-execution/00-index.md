# S5-2 转账执行服务 详细计划索引

计划版本：`v1.0`。风险级别：`L3`（资金写入口编排）。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S5-2 代码状态：`NOT_STARTED`。

## 权威需求来源

[阶段 5 总体规划 v1.0](../2026-08-17-stage-5-transfers-redpackets-master-plan.md)（即时到账+免费）、[ledger-model 转账模板](../../architecture/ledger-model.md)、S3-6 internalTransfer 模板、S3-2 PostMoneyService、S3-4 RiskGate、S5-1 V7 表。

## 目标

**`TransferExecutionService`**——用户间转账的完整编排：

1. **execute(input: TransferCommand): Promise<TransferResult>**：
   ```
   1. 幂等：findByOrderRef → EXECUTED 已存在 → 返回既有结果
   2. 创建 PENDING 订单（S5-1 createOrder 幂等）
   3. RiskGate 校验（金额/限额——免费但仍有风控）
   4. 获取 sender/recipient 的 USER_AVAILABLE 账户
   5. S3-6 internalTransfer 模板构造命令
   6. S3-2 PostMoneyService.post()
   7. markExecuted(transferId, ledgerTransactionId)
   8. Outbox 通知：telegram.transfer-completed.v1（双端各一条）
   ```
2. **失败路径**：过账失败（余额不足）→ markFailed(reason)；不自动重试。
3. **并发安全**：PostMoneyService 行锁 + 正常余额防线兜底；order_ref UNIQUE 防重复。

## 冻结未来工程矩阵

Create：`apps/platform/src/modules/transfers/application/transfer-execution.service.ts`、`test/database/transfer-execution.integration.spec.ts`。Modify：0。

## 测试矩阵（S5TE）

- 正常转账：PENDING→EXECUTED + 余额变化 + 双端通知；
- 幂等：同 order_ref 重放返回既有结果零新行；
- 余额不足：PENDING→FAILED + 零余额变化 + 通知零条；
- sender = recipient 拒绝；
- 并发双花：同 sender 并发两笔恰一成功；
- 通知 topic 双端（sender 收到+recipient 收到）。

## 停止条件

需要新迁移、需要绕过 S3-2 过账内核、三锁漂移。
