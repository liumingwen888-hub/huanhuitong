# 实施步骤与门禁

[返回索引](00-index.md)

## 实施步骤（第 22/48 步获授权后执行）

- [ ] Step 1：基线核对——3 Create 不存在、5 Modify 输入一致、三锁无漂移；记录基线 ZIP SHA-256。
- [ ] Step 2：写双 security spec 红灯。
- [ ] Step 3：contracts observability Modify（事件/上下文/route/outcome 扩展）。
- [ ] Step 4：logging-policy Modify（八事件 matrix + 值级防御 + 零写入保证）。
- [ ] Step 5：telegram-user-reference Create（withResolvedSecret + 版本化独立 HMAC）。
- [ ] Step 6：config index Modify + 双 logger Modify（接入新 policy；Pino redact 第二层核对）。
- [ ] Step 7：spec 逐项绿灯；全量回归 build/typecheck/unit/db。
- [ ] Step 8：重构检查（T11C16 静态搜索；span 无 context 透传路径）。
- [ ] Step 9：文档同步（observability、threat-model、security-gates、status、verification、progress-log）。
- [ ] Step 10：交付与验收报告；等待用户外部复审。

## 验证命令

```
pnpm build && pnpm typecheck
pnpm exec vitest run --project unit apps/platform/test/security/sensitive-logging.spec.ts apps/worker/test/security/sensitive-logging.spec.ts
pnpm test:unit && pnpm test:db
```

## 停止条件

- 需要改 SecretResolver/keyring 实现或新增依赖：停止。
- Task 2 既有六事件回归失败：停止登记。
- 三锁漂移或目标外写入：停止。

## 完成标准（总计划原文收敛）

事件、字段、值、长度、控制字符和嵌套均失败关闭；标识要么省略要么以版本化独立 HMAC 伪名出现；任何 Secret、raw Update、canonical bytes 或 Inbox digest key material 不可进入日志/trace。
