# S3-2 过账内核 详细计划索引

计划版本：`v1.0`。风险级别：`L3`（全项目最高——资金写入口）。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S3-2 代码状态：`NOT_STARTED`。

## 权威需求来源

[ledger-model 并发/冲正/对账](../../architecture/ledger-model.md)、[AGENTS 资金红线](../../../AGENTS.md)、S3-1 已交付（V3 五表、命令解析、仓储）。

## 目标

1. **`PostMoneyService`**（唯一过账入口）：
   ```
   post(command: PostMoneyCommand): Promise<PostingResult>
   ── 单一 UoW：
   1. parsePostMoneyCommand（防御+平衡，S3-1 已有）
   2. 幂等：findTransactionIdByIdempotencyKey 命中 → 返回 existing（posted:false 语义区分）
   3. 账户校验：逐行 findAccount——存在、ACTIVE、资产一致（同交易内资产一致裁决：允许跨资产？换汇模板需双腿两资产 → **允许跨资产，但每行金额单位须匹配该账户资产**；由调用方模板保证经济语义，内核校验账户存在/ACTIVE/行级 BigInt>0）
   4. 负余额防线：对每账户（本交易净变动后）余额投影检查——余额来源：S3-3 投影尚未建 → 本任务内置**行级锁定校验**：SELECT ... FOR UPDATE 账户行（锁 version），计算 existing entries SUM ± 本交易净额，<0 → 拒绝 LEDGER_NEGATIVE_BALANCE（仅对负债方向账户？裁决：**统一防线**——所有账户不允许负余额，平台账户亦然；聚合负债账户天然为贷方余额）
   5. insertPostedTransaction（entries 全插）
   6. bump 受影响账户 version（乐观并发痕迹 + 行锁下安全）
   ```
2. **`ReverseTransactionService`**：原交易 POSTED→生成 REVERSAL 新交易（行全反向、引用原交易）→ 原交易 status=REVERSED + reversed_by；幂等（已 REVERSED 拒绝）；绝不改历史行。
3. **禁止事项**：内核不含业务语义（费用/风控在 S3-4）；不读余额表（S3-3 前 SUM entries 为权威）；金额零 number。

## 冻结未来工程矩阵

Create：`apps/platform/src/modules/ledger/application/post-money.service.ts`、`application/reverse-transaction.service.ts`、`test/unit/post-money-validation.spec.ts`、`test/database/posting-engine.integration.spec.ts`。Modify：S3-1 仓储接口（账户行锁读取 + entries 聚合查询两方法——按 S2-4 先例登记）。

## 测试矩阵（S3PE）

unit：命令层防御复用断言（负数/零/小数/1 行/Proxy）。
database：
- 过账成功（用户+负债双腿）→ entries 落库 + 交易 POSTED + version 递增；
- **幂等重放**返回同 transactionId（posted:false）且零新行；
- 幂等键冲突（不同内容同键）→ LEDGER_IDEMPOTENCY_CONFLICT；
- 账户不存在/FROZEN/CLOSED 拒绝；REVERSAL 类型经 service 而非直接 post 拒绝；
- **负余额拒绝**：余额不足账户扣减 → LEDGER_NEGATIVE_BALANCE 零行写入；
- 并发双花：两连接同时扣同一账户恰一成功；
- 冲正：原额反向新交易 + 原 REVERSED + 双向平衡 + 二次冲正拒绝；
- 平台聚合账户贷方累积多笔正常。
