# Task 7 身份领域实体、接口和数据库约束 详细计划索引

计划版本：`v1.0`。风险级别：`L3`。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。Task 7 代码状态：`NOT_STARTED`。

当前为第 13/48 步 `IN_PROGRESS`。第 12/48 步与 Task 6 实施结果均为 `COMPLETED / IMPLEMENTED / VERIFIED / EXTERNAL REVIEW PASS`；第 14/48 步 `NOT_STARTED`。本计划只描述未来实施。

## 权威需求来源

- [阶段 1 总计划 Task 7 节](../2026-07-20-stage-1-foundation-identity-implementation-plan.md)（目标、Files 清单、失败场景、完成标准、Step 1–8）。
- 总计划 Global Constraints：Telegram user.id 为十进制字符串（text，禁 32 位整数、禁 username 作身份）；UID 用 uuid + gen_random_uuid() 无业务含义；`channel_bindings` 有效 `(channel_type, external_user_id)` 唯一；F-10（服务端派生 registrationKey）。
- [identity-and-membership 领域](../../domains/identity-and-membership.md)：UID 是账户主体；UidCreated 无资金效果。

## 权威阅读顺序

1. 本索引。
2. [范围与状态](01-scope-status-and-boundaries.md)。
3. [当前接口与 schema 基线](02-current-baseline.md)。
4. [合同与仓储设计](03-contracts-and-repositories.md)。
5. [测试矩阵](04-test-matrix.md)。
6. [实施步骤与验证门禁](05-implementation-and-gates.md)。

## 冻结未来工程矩阵

| 操作 | 路径 |
|---|---|
| Create | `packages/contracts/src/identity.ts` |
| Modify | `packages/contracts/src/index.ts` |
| Create | `apps/platform/src/modules/identity/domain/identity.types.ts` |
| Create | `apps/platform/src/modules/identity/domain/identity.errors.ts` |
| Create | `apps/platform/src/modules/identity/application/identity.repository.ts` |
| Create | `apps/platform/src/modules/identity/infrastructure/postgres-identity.repository.ts` |
| Create | `apps/platform/src/modules/identity/infrastructure/postgres-registration-idempotency.repository.ts` |
| Create | `apps/platform/test/unit/identity-contract.spec.ts` |
| Create | `apps/platform/test/database/identity-constraints.integration.spec.ts` |

合计 Create 8、Modify 1、Delete 0（与总计划 Task 7 Files 清单一致）。Target 集合外写入即停止。

## v1.0 状态说明

与 Task 6 v1.0 相同：先冻结合同层（类型、仓储接口、schema 事实、测试矩阵、步骤）；canonical fragments 延后至合同复审通过后的 v1.1。Task 8（ResolveOrCreateUid 并发幂等编排）不在本计划范围，本计划只交付实体、接口与仓储。
