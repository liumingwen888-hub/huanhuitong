# S8-4 供应商提交端口 详细计划索引

计划版本：`v1.0`。风险级别：`L3`（法币出站提交 + 防重付）。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S8-4 代码状态：`NOT_STARTED`。

## 权威需求来源

[阶段 8 总体规划 v1.0](../2026-08-19-stage-8-fiat-payout-master-plan.md)（S8-4 任务行 + 决策 3/5）、[法币代付领域](../../domains/fiat-payouts.md)（ProviderAttempt、"同一业务意图不得因超时创建新付款"）、[S6-4/S6-5 端口先例](../s6-4-signer-isolation/00-index.md)。

## 目标

供应商提交的端口隔离与编排：**PayoutProviderPort 纯接口 + FakeBankProvider（可配置结果/查询状态/故障）** + 提交编排（FUNDS_RESERVED→SUBMITTING→ACCEPTED / FAILED）——防重付三层防线在本任务闭合。

## 防重付三层防线（本任务闭合论证）

1. **确定性键派生**（S8-3 已落地）：`PPO:{providerId}:{orderRef}`——任何重试生成相同键；
2. **V12 UNIQUE**（S8-1 已落地）：同键第二订单被数据库拒绝；
3. **供应商侧按键去重**（本任务）：FakeBankProvider 对同键重复 submit 返回**首次结果**（不产生第二次付款）——真实供应商的幂等键语义同构，生产适配器必须实现并测试此契约。

推论：提交超时/崩溃后重试 = 同键重放 = 供应商去重 = **结构上不可能双付**（与提现广播窗口同型的确定性论证）。

## 端口设计（fiatpayout/domain）

```ts
PayoutProviderPort {
  submit(input: {providerIdempotencyKey, route, sourceAssetCode,
                 amount, estimatedFiat, beneficiaryRef, beneficiaryDigest})
    → {status: 'ACCEPTED'} | {status: 'REJECTED', reasonCode}
  query(providerIdempotencyKey)
    → {status: 'ACCEPTED'|'SUCCEEDED'|'FAILED'|'UNKNOWN'}
}
```
- submit 抛错 = 结果 UNKNOWN（不可推断）——订单停留 SUBMITTING，同键重试安全；
- 真实供应商的回调 URL/鉴权/字段映射属生产适配器，端口不泄露。

## FakeBankProvider（domain）

- 按键去重提交（同键返回首次结果 + 去重计数暴露供断言）；
- 可配置：默认结果（ACCEPTED/REJECTED+reason）、故障抛错、查询状态（S8-5/6 消费）；
- 记录全部提交输入。

## 提交编排（PayoutSubmissionService.submit）

1. 状态门：`FUNDS_RESERVED` → CAS `markSubmitting`；`SUBMITTING` → 幂等重入（崩溃恢复）；其他 → `PAYOUT_INVALID_TRANSITION`。
2. `estimatedFiat = amount − fee`（订单快照 BigInt）。
3. `provider.submit({键 = 订单.providerIdempotencyKey, ...})`。
4. ACCEPTED → `markAccepted` CAS（SUBMITTING→ACCEPTED）→ Outbox `telegram.payout-submitted.v1`；CAS 失败但快照 ACCEPTED → 幂等返回。
5. REJECTED → `markFailed`（+ provider reason）→ S8-6 释放路径接管。
6. 抛错（UNKNOWN）→ 零状态写入，停留 SUBMITTING 待重试。

**裁决**：供应商外部引用（providerAttemptId）暂不持久化——V12 无此列且合成期查询以我方键为准；真实供应商外部单号属生产 V13 范围（记录在案）。

## 冻结未来工程矩阵

Create：`fiatpayout/domain/{payout-provider.port.ts, fake-bank.provider.ts}`、`fiatpayout/application/payout-submission.service.ts`、`apps/platform/test/database/payout-submission.integration.spec.ts`（S8PS）。Modify：`payout.repository.ts` + Postgres（markSubmitting/markAccepted/markFailed CAS）。

## 测试矩阵（S8PS）

- S8PS01 提交成功：ACCEPTED、供应商收到键+全部事实
- S8PS02 崩溃窗口重放：同键两次 submit → 供应商单次逻辑提交（去重计数断言）、订单单次 ACCEPTED
- S8PS03 供应商拒绝 → FAILED + 原因落库
- S8PS04 供应商不可用（抛错）→ 停留 SUBMITTING 零写入；恢复后重试成功
- S8PS05 非可提交状态拒绝（SUCCEEDED/REFUNDED）
- S8PS06 传递键 = 订单.providerIdempotencyKey（三层防线贯通断言）
- S8PS07 查询端口返回配置状态（ACCEPTED/SUCCEEDED/FAILED/UNKNOWN 矩阵）

## 边界与不做

- 不做回调接收（S8-5）、结算/释放过账（S8-6）；不做真实供应商适配器（生产）。

## 停止条件

Fake 去重语义与真实供应商幂等契约偏离、UNKNOWN 路径出现任何状态写入。
