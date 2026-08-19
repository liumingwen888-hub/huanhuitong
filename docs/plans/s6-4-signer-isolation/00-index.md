# S6-4 Signer 隔离接口 详细计划索引

计划版本：`v1.0`。风险级别：`L3`（密钥边界）。计划状态：`READY v1.0`（2026-08-19 用户外部复审通过并授权实施）。S6-4 代码状态：`VERIFIED`（2026-08-19 实施完成；见下方实施验证）。

## 权威需求来源

[阶段 6 总体规划 v1.0](../2026-08-17-stage-6-withdrawals-master-plan.md)（S6-4 任务行 + 决策 2 同进程接口隔离、决策 3 初期全热钱包）、[提现领域](../../domains/withdrawals.md)（SigningIntent 实体、"不保存私钥，不直接签名"）、[signer 边界底线](../../../AGENTS.md)（私钥不得进普通业务进程/明文库/日志）。

## 目标

按已裁决的"同进程接口隔离"建立签名边界：**业务侧只依赖 TransactionSignerPort 纯接口**；密钥材料永不跨越 VaultPort 边界（入参摘要、出参签名，HSM 型语义）；签名编排 APPROVED→SIGNING 幂等可重试。真实密钥存储、独立进程/容器隔离留生产阶段（授权另行申请）。

## 架构（沿用 S4-6 端口先例：平台模块 domain 层本地端口 + Fake）

```
withdrawals/application            signer/domain
┌──────────────────┐  WithdrawalSigningRequest  ┌─────────────────────────┐
│ WithdrawalSign-  │ ─────────────────────────► │ TransactionSignerPort   │
│ ingService       │ ◄───────────────────────── │ (真实实现未来接 Vault)    │
└──────────────────┘      signatureRef          └─────────────────────────┘
                                   │                      │
                        FakeSigner（测试）        VaultPort（keyRef+digest
                                                 →signature；密钥不出边界）
```

1. **TransactionSignerPort**（`modules/signer/domain/transaction-signer.port.ts`）：
   - `WithdrawalSigningRequest`：withdrawalId、orderRef、network、fromAddress（策略热钱包）、toAddress（订单目标）、amount、feeAmount、canonicalDigest。
   - `WithdrawalSigningResult`：signatureRef、algorithm。
   - 接口仅 `sign(request)`。
2. **VaultPort**（`modules/signer/domain/vault.port.ts`）：`sign({ keyRef, digest }) → { signature, algorithm }`——**不存在返回密钥材料的方法**；接口层即表达"密钥不出库"。
3. **FakeSigner**（`modules/signer/domain/fake-signer.ts`）：确定性（同请求同结果）、记录全部请求供断言、可配置失败。
4. **canonicalDigest 纯函数**（signer/domain）：对绑定字段做规范序列化后 SHA-256；防篡改/防替换的基础。
5. **WithdrawalSigningService**（withdrawals/application）：
   - 输入 withdrawalId；加载订单；
   - 状态门：`APPROVED` → CAS `markSigning`；`SIGNING` → 幂等重签（崩溃恢复路径）；其他状态 → `WITHDRAWAL_INVALID_TRANSITION` 拒绝；
   - 组装 canonical request（订单字段 + 活跃策略热钱包/费率）→ 计算 digest → `signerPort.sign`；
   - 返回 `{ order(快照), signing: { request, signatureRef } }`——签名产物不落库（广播编排 S6-5 即取即用；崩溃后重签安全：确定性请求 + 广播幂等）。

## 防重放与防替换

canonical request 绑定 withdrawalId + orderRef + amount + toAddress + fromAddress + feeAmount：任一字段变化 → digest 变化 → 旧签名不可复用；同订单重放 → 相同请求 → 相同签名。S6-5 广播时再校验 request 与订单一致（纵深）。

## 实施裁决记录（2026-08-19）

1. canonical request 的字段来源切分：amount/toAddress/orderRef/withdrawalId/feeAmount 取**订单事实**，network/fromAddress 取**活跃策略**（热钱包轮换场景下订单金额与目标不可变，出账钱包跟随运营策略）。
2. FakeSigner 内置摘要一致性校验（canonicalFieldsMatch）——篡改请求直接 SIGNER_DIGEST_MISMATCH，Fake 亦守边界。
3. 签名失败：SignerError 原样传播（调用方决定重试节奏），订单停留 SIGNING 由幂等重签恢复——与计划的崩溃恢复路径一致。

## 冻结未来工程矩阵

Create：`modules/signer/domain/{transaction-signer.port.ts, vault.port.ts, fake-signer.ts, canonical-digest.ts}`、`modules/withdrawals/application/withdrawal-signing.service.ts`、`apps/platform/test/unit/canonical-digest.spec.ts`（S6WS 单元部分）、`apps/platform/test/database/withdrawal-signing.integration.spec.ts`（S6WS 集成部分）。Modify：无（contracts 不动，端口按 S4-6 先例留在平台侧）。

## 测试矩阵（S6WS）

- S6WS01（集成）APPROVED → SIGNING，快照/签名引用返回
- S6WS02（集成）SIGNING 态重调幂等（同摘要同签名引用，无状态回退）
- S6WS03（集成）PENDING_APPROVAL / REJECTED 订单拒绝（INVALID_TRANSITION），零签名调用
- S6WS04（集成）签名器失败：错误传播、订单停留 SIGNING；重试成功
- S6WS05（单元）canonical digest：任一绑定字段变化 → 摘要变化；字段序稳定
- S6WS06（单元）请求/结果类型运行时序列化不含密钥材料字段（扫描 `key`/`secret`/`private`）

## 边界与不做

- 不做真实密钥存储/Vault 实现/独立进程隔离（生产阶段独立授权）；不做广播（S6-5）；不做热钱包余额管理（阶段 10 运营范围）。
- 签名产物不持久化：有意为之（避免签名落库引出新的敏感数据治理面）；确定性 + 广播幂等保证安全。

## 实施验证（2026-08-19，macOS/arm64 本地）

- `pnpm build` + 全 workspace typecheck exit 0；`pnpm architecture:check` 0 违规（158 模块、185 依赖）。
- unit 28 文件 228/228 PASS（含 canonical-digest 2 项：七字段任一变化摘要必变、属性序不影响、序列化无密钥材料字段）。
- S6WS01–S6WS04 集成全 PASS：APPROVED→SIGNING 确定性签名、SIGNING 幂等重签（同摘要同签名引用）、非可签状态零签名调用、签名器失败后订单停留 SIGNING 且重试成功。
- 数据库回归 426/429（M06/M14/M16 已知环境边界项）。
- 交付物：`modules/signer/domain/{transaction-signer.port, vault.port, canonical-digest, fake-signer, signer.errors}.ts`、`modules/withdrawals/application/withdrawal-signing.service.ts`、单测与集成测试两文件。

## 停止条件

端口泄漏密钥材料、与 authority-map 的 signer 边界冲突、确定性假设被真实链语义破坏（届时升级为持久化 SigningIntent + V9）。
