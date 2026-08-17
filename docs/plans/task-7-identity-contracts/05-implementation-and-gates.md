# 实施步骤与验证门禁

[返回索引](00-index.md)

## 实施步骤（第 14/48 步获授权后执行）

- [ ] Step 1：实施前基线——8 个 Create 目标不存在、contracts index 与基线一致、三锁无漂移；记录 SHA-256。
- [ ] Step 2：写 unit spec（T7C01–T7C06）与 database spec（T7C11–T7C21）红灯。
- [ ] Step 3：contracts identity.ts + index export；unit 类型合同绿灯。
- [ ] Step 4：domain types/errors（解析防御 + registrationKey 派生）；T7C02–T7C05 绿灯。
- [ ] Step 5：application 接口 + infrastructure 双仓储；database 合同逐项绿灯。
- [ ] Step 6：全量回归 build/typecheck/unit/db。
- [ ] Step 7：重构检查——identity 模块 Telegram 引用 0；资金列名 0；错误不序列化原始对象。
- [ ] Step 8：文档同步（identity-and-membership 领域、data-and-money-flow 摘要、status、verification、progress-log）。
- [ ] Step 9：交付与验收报告；等待用户外部复审。

## 验证命令

```
pnpm build && pnpm typecheck
pnpm exec vitest run --project unit apps/platform/test/unit/identity-contract.spec.ts
pnpm exec vitest run --project database apps/platform/test/database/identity-constraints.integration.spec.ts
pnpm test:unit && pnpm test:db
```

## 停止条件

- 发现身份表 schema 缺口需改 migration：停止申请。
- 权限矩阵与 V1 GRANT 不符：停止。
- 三锁漂移或目标外写入：停止。

## 完成标准（总计划原文收敛）

registrationKey 仅由服务端 `registration:v1:telegram:start:<externalUserId>` 确定生成并设长度上限；成功/失败/冲突 NULL 组合及唯一绑定由数据库拒绝非法值；identity 合同渠道无关；external ID 是字符串；username 可空且非身份依据。
