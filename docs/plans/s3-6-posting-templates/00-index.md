# S3-6 记账模板 详细计划索引

计划版本：`v1.0`。风险级别：`L2`。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S3-6 代码状态：`NOT_STARTED`。

## 权威需求来源

[ledger-model 记账模板](../../architecture/ledger-model.md)（充值/转账/红包/提现/换汇/代付六模板的权威定义）、S3-2 过账内核（已验证）。

## 目标

**纯记账语义模板**——每个模板是把业务参数（金额、资产、参与者账户）映射为合法 `PostMoneyCommand` 的纯函数/类。不含外部连接、不含业务决策（费用/风控在 S3-4 已建）；阶段 4～8 的业务模块直接调用这些模板生成过账命令。

1. `templates/deposit.ts`：确认充值——DR 托管/CR 用户可用（S3-2 已实证；模板化=参数化+幂等键标准化）。
2. `templates/internal-transfer.ts`：DR 付款人可用/CR 收款人可用 + 费用腿（DR 付款人/CR 费用收入）。
3. `templates/claim.ts`：领取——DR 领取负债/CR 接收人可用。
4. `templates/red-packet.ts`：创建 DR 可用/CR 领取负债；领取同 claim；退款反向。
5. `templates/withdrawal.ts`：申请 DR 可用/CR 冻结；成功 DR 冻结/CR 托管 + 费用腿；失败反向释放。
6. `templates/exchange.ts`：卖出冻结 DR 可用/CR 冻结；成交 DR 冻结/CR 清算差 + DR 清算差/CR 买入可用（双腿两资产）。
7. `templates/fiat-payout.ts`：冻结→成功结算至供应商清算/应付；失败释放。

每个模板返回 `{command: PostMoneyCommand, description: string}` 或抛稳定错误（金额≤0、账户缺失、资产不匹配等——复用 S3-2 命令防御）。

## 冻结未来工程矩阵

Create：`apps/platform/src/modules/ledger/templates/` 七文件 + `apps/platform/test/database/posting-templates.integration.spec.ts`。Modify：0。

## 测试矩阵（S3T）

每个模板（经真实数据库过账验证）：
- 借贷平衡（触发器通过=已证）；
- 涉及账户投影变化正确（DR 账户增/CREDIT 账户减符合正常余额方向）；
- 幂等键格式包含业务类型+订单号；
- 负余额被拒（金额不足时）；
- 特有断言（如换汇两资产、红包冻结与领取闭环、提现失败释放）。

## 停止条件

模板需要外部连接或业务决策（违反纯函数约束）、需要新迁移、三锁漂移。

## 裁决

模板不做账户存在性/状态校验（由 S3-2 内核在过账时做）；模板只负责构造合法命令——**关注点分离**：模板管"该记什么账"，内核管"能不能记"。
