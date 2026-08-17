# 实施步骤

[返回索引](00-index.md)

全部步骤在第 12/48 步获用户明确授权后执行；每步 TDD 红灯→最小实现→绿灯。所有 checkbox 在计划获批时未勾选。

- [ ] Step 1：实施前基线核对——十个冻结目标中 8 个 Create 不存在、2 个 Modify 输入与基线一致、三锁无漂移；记录 SHA-256。
- [ ] Step 2：创建 unit spec 骨架（T6C01–T6C10），运行红灯（模块不存在）。
- [ ] Step 3：实现 `packages/contracts/src/reliability.ts`（合同类型）+ index export；unit 红灯收敛到行为层。
- [ ] Step 4：实现 `apps/worker/src/outbox/outbox-worker.ts` + `outbox-store.ts` 接口层；T6C01–T6C08 绿灯。
- [ ] Step 5：实现错误分类与退避；T6C06–T6C08 绿灯；重构检查时钟/PRNG 注入。
- [ ] Step 6：实现 payload 哨兵扫描与日志白名单；T6C09–T6C10 绿灯。
- [ ] Step 7：创建 database spec（T6C11–T6C28），运行红灯（repository 不存在）。
- [ ] Step 8：实现 `OutboxRepository.enqueue`（platform 侧，TransactionContext 注入）；T6C11–T6C12 绿灯。
- [ ] Step 9：实现 `claimBatch`（CTE + FOR UPDATE SKIP LOCKED + 原子租约）；T6C13–T6C15 绿灯。
- [ ] Step 10：实现 `markSucceeded/applyFailure/extendLease` CAS；T6C16–T6C18、T6C26 绿灯。
- [ ] Step 11：崩溃重投与 UNKNOWN 路径；T6C19、T6C28 绿灯。
- [ ] Step 12：实现 `DurableJobRepository` 与状态机；T6C20–T6C24 绿灯。
- [ ] Step 13：权限矩阵与 F-06 禁用合同；T6C22–T6C23、T6C25、T6C27 绿灯。
- [ ] Step 14：`create-worker.ts` + `main.ts` 接线（不连接真实外部服务）。
- [ ] Step 15：全量回归 `pnpm build`、`pnpm typecheck`、`pnpm test:unit`、`pnpm test:db`。
- [ ] Step 16：重构检查——worker 不依赖 NestJS controller / identity 私有实现；payload 无敏感字段；错误不序列化。
- [ ] Step 17：文档同步（platform-operations 领域、runtime-topology、status、verification、progress-log）。
- [ ] Step 18：交付包与验收报告；等待用户外部复审。
