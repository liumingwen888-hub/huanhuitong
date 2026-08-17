# 实施步骤与门禁

[返回索引](00-index.md)

## 实施步骤（第 16/48 步获授权后执行）

- [ ] Step 1：基线核对——3 个 Create 目标不存在、三锁无漂移；记录基线 ZIP SHA-256。
- [ ] Step 2：写 spec 红灯（T8C01–T8C10，模块不存在）。
- [ ] Step 3：实现 `identity-event-factory.ts`（冻结事件 + id factory 注入）。
- [ ] Step 4：实现 `resolve-or-create-uid.ts`（按 02 编排算法三分支）。
- [ ] Step 5：database spec 逐项绿灯。
- [ ] Step 6：全量回归 build/typecheck/unit/db。
- [ ] Step 7：重构检查（T8C09 静态断言 + 人工核对：不自开事务、不发 Telegram、不写 audit、不碰资金表）。
- [ ] Step 8：文档同步（identity-and-membership、data-and-money-flow、telegram-experience 摘要、status、verification、progress-log）。
- [ ] Step 9：交付与验收报告；等待用户外部复审。

## 验证命令

```
pnpm build && pnpm typecheck
pnpm exec vitest run --project database apps/platform/test/database/resolve-or-create-uid.integration.spec.ts
pnpm test:unit && pnpm test:db
```

## 停止条件

- 需要 migration 或 Task 7/6 接口变更：停止申请。
- 并发冒烟出现非确定性双 UID：停止登记（不得以重试掩盖）。
- 三锁漂移或目标外写入：停止。

## 完成标准（总计划原文收敛）

同 Telegram 主体并发只得到一个 UID/会员/绑定/注册/UidCreated；冲突默认拒绝且不合并；所有变化同事务；首次、重复、空 username、username 变化、Outbox 失败回滚均有数据库证据。
