# 范围、测试矩阵与门禁

[返回索引](00-index.md)

## 目标

1. 机器化四规则（见 00-index），fixture 故意违规证明门禁真实失败（非零 exit + 规则名可定位）。
2. 真实 `apps packages` 图 exit 0；无循环、无反向依赖。
3. 补齐后 `pnpm test:all` 全链（build → typecheck → architecture:check → unit → database → integration）恢复可用。

## 明确排除

- 运行时代码、database、领域文档、Task 1–11 任何文件修改。
- 新依赖（depcruise 已在锁内）；路径别名等绕过通道。

## 测试矩阵

| ID | 合同 |
|---|---|
| T12C01 | fixture（identity.ts 显式 import ../telegram/telegram.js）在 fixture 根扫描下非零退出且 stderr 含 no-domain-to-telegram |
| T12C02 | 真实图 `pnpm architecture:check` exit 0 |
| T12C03 | 规则正则与批准边界一一对应；无 `notToReachable` 之外的放宽项/忽略路径（配置静态断言） |
| T12C04 | Telegram → identity 方向合法（真实图中存在该方向且不触发规则） |

## 实施步骤（第 24/48 步获授权后）

- [ ] Step 1：基线核对（4 Create 不存在、package.json 现状、三锁）。
- [ ] Step 2：写 architecture spec 红灯。
- [ ] Step 3：创建 fixture 双文件与 .dependency-cruiser.cjs。
- [ ] Step 4：fixture 红灯转 PASS（预期非零）+ 真实图绿灯；必要时最小化 package.json Modify。
- [ ] Step 5：`pnpm test:all` 全链验证（database 部分受 M14/M06 环境边界约束，如实登记）。
- [ ] Step 6：重构检查（无放宽、无别名绕过、规则名可定位）。
- [ ] Step 7：文档同步（domain-map 门禁命令、security-gates、status、verification、progress-log）。
- [ ] Step 8：交付与验收报告；等待用户外部复审。

## 停止条件

- 真实图存在既成违规（说明前序 Task 有架构债）：停止登记，不放宽规则迁就。
- 需要 `pnpm-workspace.yaml`/tsconfig path 修改：停止。
