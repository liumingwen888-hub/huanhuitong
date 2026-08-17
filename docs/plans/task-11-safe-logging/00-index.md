# Task 11 日志字段白名单与敏感数据泄露测试 详细计划索引

计划版本：`v1.0`。风险级别：`L3`。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。Task 11 代码状态：`NOT_STARTED`。

当前为第 21/48 步 `IN_PROGRESS`。第 20/48 步与 Task 10 实施结果均为 `COMPLETED / IMPLEMENTED / VERIFIED / EXTERNAL REVIEW PASS`；第 22/48 步 `NOT_STARTED`。

## 权威需求来源

- [阶段 1 总计划 Task 11 节](../2026-07-20-stage-1-foundation-identity-implementation-plan.md)（目标、Files、失败场景、Step 1–N 含参考 SafeLogEvent/SafeLogContext/logging-policy 代码）。
- 裁决 F-09 与 R2-01～R2-07（Task 2）：值级防泄漏、六事件 policy matrix、`SafeLoggingError` + destination 零写入；`withResolvedSecret` 边界。
- 总计划 Global Constraints：日志白名单——Bot Token、secret_token、完整 Update、正文、callback、start 令牌、手机号、支付密码、TOTP、供应商密钥、DB 凭证不得入日志。

## 权威阅读顺序

1. 本索引。
2. [范围与状态](01-scope-and-status.md)。
3. [白名单与值级防御合同](02-policy-and-sanitizer.md)。
4. [伪名与密钥分离](03-pseudonym-and-key-separation.md)。
5. [测试矩阵](04-test-matrix.md)。
6. [实施步骤与门禁](05-implementation-and-gates.md)。

## 冻结未来工程矩阵

| 操作 | 路径 |
|---|---|
| Modify | `packages/contracts/src/observability.ts` |
| Modify | `packages/config/src/logging-policy.ts` |
| Create | `packages/config/src/telegram-user-reference.ts` |
| Modify | `packages/config/src/index.ts` |
| Modify | `apps/platform/src/infrastructure/logging/create-platform-logger.ts` |
| Modify | `apps/worker/src/infrastructure/logging/create-worker-logger.ts` |
| Create | `apps/platform/test/security/sensitive-logging.spec.ts` |
| Create | `apps/worker/test/security/sensitive-logging.spec.ts` |

合计 Create 3、Modify 5、Delete 0（与总计划一致）。vitest 已含 `apps/*/test/security/**` glob。

## v1.0 状态说明

合同层先行；canonical fragments 延后至复审通过后的 v1.1。Task 2 已实现六事件 policy 与 SafeLogger 骨架，本 Task 是其 Telegram 阶段扩展与泄露证明闭环。
