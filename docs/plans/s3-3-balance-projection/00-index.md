# S3-3 余额投影 详细计划索引

计划版本：`v1.0`。风险级别：`L3`。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S3-3 代码状态：`NOT_STARTED`。

## 权威需求来源

[ledger-model](../../architecture/ledger-model.md)（"余额投影是可重建读模型，不是独立资金事实"）、S3-2 已交付内核（行锁 + entries SUM 为权威）。

## 目标

1. **V4 增量迁移**（`account_balances` 表）：account_id PK/FK、signed_balance BIGINT（与内核同符号约定：借方正常为正、贷方正常为负）、last_transaction_id、updated_at。**只授予 platform SELECT/INSERT/UPDATE；worker 只读；投影不是资金事实——条目仍为唯一权威**。
2. **内核同步写入**：PostMoneyService / ReverseTransactionService 过账成功后**同事务** UPSERT 受影响账户投影（signed_balance += 净额；last_transaction_id 指向本交易）。冲正同样同步（反向净额自然回写）。
3. **投影读服务** `application/balance-query.service.ts`：`accountBalanceOf(accountId)`（读投影）与 `recomputeAll()`（全量重建：SUM entries 重写投影，一致性任务接口——worker 对账任务调用入口）。
4. **重建一致性**：`recomputeAll` 以 entries 为唯一来源幂等重写；提供 `verifyProjection()` 对比投影 vs SUM，返回差异清单（对账基础，S3-5 消费）。
5. **红线**：业务模块只经读服务查询；投影表无 DELETE 权限（重建=UPSERT 覆盖）；投影永不参与内核防线（防线继续走 entries SUM + 行锁——避免投影-条目竞态）。

## 冻结未来工程矩阵

Create：`database/migrations/V4__stage_3_balance_projection.sql`、`apps/platform/src/modules/ledger/application/balance-query.service.ts`、`apps/platform/test/database/balance-projection.integration.spec.ts`。Modify：S3-2 两服务（过账成功后同步投影）、S3-1 仓储接口（投影 UPSERT/读取两方法——按先例登记）。

## 测试矩阵（S3BP）

- 过账后投影即时等于 entries SUM（S3-2 场景复跑 + 投影断言）；
- 冲正后投影回退正确；
- 幂等重放不产生投影漂移（posted:false 零写入）；
- 手工篡改投影 → verifyProjection 捕获差异 → recomputeAll 修复 → 差异清零；
- 并发过账投影原子性（双花场景投影终值正确）；
- 投影表无 DELETE 权限实证。

## 停止条件

需要投影参与内核决策（禁止）、V3 兼容破坏、三锁漂移、V4 未获显式授权。
