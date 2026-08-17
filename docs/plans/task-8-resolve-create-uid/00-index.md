# Task 8 ResolveOrCreateUid 并发幂等 详细计划索引

计划版本：`v1.0`。风险级别：`L3`。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。Task 8 代码状态：`NOT_STARTED`。

当前为第 15/48 步 `IN_PROGRESS`。第 14/48 步与 Task 7 实施结果均为 `COMPLETED / IMPLEMENTED / VERIFIED / EXTERNAL REVIEW PASS`；第 16/48 步 `NOT_STARTED`。

## 权威需求来源

- [阶段 1 总计划 Task 8 节](../2026-07-20-stage-1-foundation-identity-implementation-plan.md)（目标、Files、失败场景、Step 1–8 含参考实现骨架）。
- Task 7 已交付：`createRegistrationKey`（SHA-1 UUIDv5 服务端派生）、`IdentityRepository`/`RegistrationIdempotencyRepository`。
- Task 6 已交付：`PostgresOutboxRepository.enqueue(tx, envelope)`。
- 总计划 Global Constraints：自动注册事务只创建 UID、Membership、绑定、资料、幂等记录和身份 Outbox 事件；`UidCreatedV1` 无资金效果；外部主菜单发送在提交后由 Outbox 驱动。

## 权威阅读顺序

1. 本索引。
2. [范围与状态](01-scope-and-status.md)。
3. [编排算法与并发语义](02-orchestration-and-concurrency.md)。
4. [事件工厂与 Outbox 映射](03-events-and-outbox-mapping.md)。
5. [测试矩阵](04-test-matrix.md)。
6. [实施步骤与门禁](05-implementation-and-gates.md)。

## 冻结未来工程矩阵

| 操作 | 路径 |
|---|---|
| Create | `apps/platform/src/modules/identity/application/resolve-or-create-uid.ts` |
| Create | `apps/platform/src/modules/identity/application/identity-event-factory.ts` |
| Create | `apps/platform/test/database/resolve-or-create-uid.integration.spec.ts` |

合计 Create 3、Modify 0、Delete 0。Target 集合外写入即停止。

## v1.0 状态说明

合同层先行；canonical fragments 延后至复审通过后的 v1.1（与 Task 6/7 同流程）。并发强度测试（独立连接 + 屏障真实并发）按总计划留在 Task 13；本 Task 测首次/重复/username 变化/空 username/Outbox 失败回滚，另加受控并发冒烟。
