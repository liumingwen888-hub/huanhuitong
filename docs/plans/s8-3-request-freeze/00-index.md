# S8-3 创建与冻结 详细计划索引

计划版本：`v1.0`。风险级别：`L3`（法币出站冻结编排）。计划状态：`READY v1.0`（2026-08-19 用户外部复审通过）。S8-3 代码状态：`VERIFIED`（2026-08-19 实施完成；见下方实施验证）。

## 权威需求来源

[阶段 8 总体规划 v1.0](../2026-08-19-stage-8-fiat-payout-master-plan.md)（S8-3 任务行 + 决策 1）、[法币代付领域](../../domains/fiat-payouts.md)（授权、资金预留）、[S3-6 fiatPayoutRequested 模板](../../../apps/platform/src/modules/ledger/templates/posting-templates.ts)（幂等键 `FIAT_PAYOUT:{orderId}:FREEZE:0`）、[S6-2 先例](../s6-2-withdrawal-request-freeze/00-index.md)。

## 目标

用户代付申请到资金冻结：**证明绑定校验（七维，operationType='fiat-payout'——已在联合类型中，零扩展）→ 配置/限额 → RiskGate → 冻结过账 → 订单创建（含供应商幂等键与收款人摘要）→ Outbox**。编排复用提现验证过的"顺序事务 + 幂等自愈"模式。

## 服务设计（PayoutRequestService.request）

输入：`{orderRef, uid, route, amount, beneficiaryRef}` + 证明。

1. **证明绑定**：S6-2 同型七维（type/uid/operationType='fiat-payout'/orderRef/amountSummary=amount 十进制串/assetSummary=route——**绑定为路线而非资产码**，因源资产由配置派生，用户命令面只有路线；裁决记录）+ 过期拒绝。
2. 幂等前置：findByOrderRef → `ALREADY_REQUESTED`。
3. 配置：findLatestByRoute → 无 → `PAYOUT_PROVIDER_CONFIG_NOT_FOUND`；金额限额 → `PAYOUT_AMOUNT_OUT_OF_RANGE`。
4. **源资产由配置派生**（config.sourceAssetCode）——用户不可指定，路线即资产。
5. RiskGate（operationType='FIAT_PAYOUT'，S3-4 联合已含）→ 拒绝 `PAYOUT_RISK_DENIED`。
6. 余额预检（贷方正常取反）→ 不足 `PAYOUT_INSUFFICIENT_FUNDS`。
7. 冻结：ensure 源资产可用/冻结账户 → fiatPayoutRequested（orderId=orderRef）→ 内核过账（崩溃自愈：模板幂等键 + order_ref UNIQUE 双保险）。
8. 订单创建：fee = config.fixedFee 快照；**beneficiaryDigest 由服务端计算**（SHA-256(beneficiaryRef)，不信任客户端摘要）；`provider_idempotency_key = PPO:{providerId}:{orderRef}`（确定性派生——同意图重试同键，S8-4 消费）；config_version 快照。
9. Outbox：`telegram.payout-requested.v1`。
10. 返回快照。

## 冻结未来工程矩阵

Create：`modules/fiatpayout/application/payout-request.service.ts`、`apps/platform/test/database/payout-request.integration.spec.ts`（S8PR）。Modify：contracts/fiat-payouts.ts（命令/结果类型——错误码已有）。

## 测试矩阵（S8PR）

- S8PR01 证明绑定七维拒绝（含 operationType='withdrawal' 跨类证明）零落库
- S8PR02 幂等：同 orderRef 重放 ALREADY_REQUESTED，账本单笔冻结
- S8PR03 未知路线/限额越界 fail-closed 零写入
- S8PR04 冻结后可用减少/冻结增加（符号断言）；订单快照（fee/config 版本/摘要/供应商幂等键）正确
- S8PR05 余额不足零订单；RiskGate 拒绝零写入
- S8PR06 源资产不可绕过（命令无资产参数；订单资产=配置资产）
- S8PR07 收款人 token 形状校验（服务层 + V12 CHECK 双层）

## 边界与不做

- 不做供应商提交（S8-4）、回调（S8-5）、结算/释放（S8-6）；不做收款人真实校验（token 即引用，真实性生产阶段）。

## 实施裁决记录（2026-08-19）

1. PayoutCommand.uid 品牌化为 Uid（与 WithdrawalCommand 一致——裸 string 与品牌类型混用导致 RiskGate 调用类型错误）。
2. 供应商幂等键格式 `PPO:{providerId}:{orderRef}`（计划冻结值原样落地）。

## 实施验证（2026-08-19，macOS/arm64 本地）

- `pnpm build` + 全 workspace typecheck exit 0；`pnpm architecture:check` 0 违规（183 模块、203 依赖）。
- unit 31 文件 246/246 PASS。
- S8PR01–S8PR07 全 PASS：七维绑定拒绝（含 operationType='withdrawal' 跨类证明）零落库、同 orderRef 重放 ALREADY 单笔冻结、未知路线/限额越界零写入、冻结方向与订单快照（fee/config 版本/服务端摘要/供应商幂等键）全断言、余额不足与 RiskGate 拒绝双零写入、命令面无资产参数、收款人 token 形状前置校验零写入。
- 数据库回归 491/494（M06/M14/M16 已知环境边界项）；integration 109/109。
- 交付物：`payout-request.service.ts`、contracts 命令/结果类型、S8PR 集成规格。

## 停止条件

绑定维度退化为宽松比较、摘要接受客户端值、供应商幂等键非确定派生。
