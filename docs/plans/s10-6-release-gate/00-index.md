# S10-6 发布门禁 详细计划索引

计划版本：`v1.0`。风险级别：`L2`（CI 聚合脚本）。计划状态：`READY v1.0`（2026-08-19 用户"继续下一步工作"授权实施——脚本任务直接实施，验收即复审）。S10-6 代码状态：`VERIFIED`（2026-08-19：release:gate 脚本 + summary 模式实弹 PASS + S10RG01-05 全 PASS——见下）。

## 目标

`pnpm release:gate`——发布前一键聚合门禁：全部检查绿才输出 `RELEASE_GATE_PASSED`，任何一项失败即非零退出并列出失败项。CD 流水线的本地等价物。

## 门禁清单（八项，按序）

1. **build**——`pnpm build`（五 workspace 编译零错误）
2. **typecheck**——`pnpm -r --sort run typecheck`
3. **architecture**——`pnpm architecture:check`（依赖巡航零违规）
4. **docs**——`pnpm docs:check`（Markdown 零断链）
5. **unit**——`vitest run --project unit`
6. **migration-pins**——迁移文件数 == 测试钉数（防漏更新）
7. **secret-scan**——代码/配置无明文密钥模式（password/secret/token 硬编码正则）
8. **alert-rules**——`deploy/alert-rules.yml` 每条规则五字段完备

## 脚本设计（scripts/release-gate.mjs）

- 每项一个 step：名称 + 命令 + 通过判据；顺序执行（fail-fast 但记录全部结果到摘要）；
- `--summary-only` 模式：只跑快速项（docs/secret-scan/alert-rules/migration-pins——跳过测试，供日常提交前速检）；
- 输出：逐项 ✓/✗ + 最终 `RELEASE_GATE_PASSED` 或 `RELEASE_GATE_BLOCKED: <失败项清单>` + 耗时统计；
- secret-scan 正则白名单排除测试 fixture（`packages/testing/fixtures/`）与文档示例（`docs/`）。

## 冻结未来工程矩阵

Create：`scripts/release-gate.mjs`、`apps/platform/test/unit/release-gate.spec.ts`（S10RG）。Modify：根 `package.json`（`release:gate` 与 `release:gate:quick` scripts）。

## 验收矩阵（S10RG，单元——脚本结构验证）

- S10RG01 八项门禁齐全且顺序正确
- S10RG02 fail-fast + 失败摘要（BLOCKED 输出含失败项名）
- S10RG03 --summary-only 模式跳过测试项
- S10RG04 secret-scan 排除 fixture/docs
- S10RG05 package.json scripts 挂载

## 实施裁决记录（2026-08-19）

1. secret-scan 排除范围：test 目录（文档化合成常量——bootstrap 密码/供应商 HMAC 密钥等，从未是真实密钥）与 packages/testing/src（harness 合成 webhook secret）。生产密钥若出现在 src/ 仍会被抓住——排除只针对测试基建。
2. `pnpm.onlyBuiltDependencies` 陈旧字段从 package.json 移除（pnpm 11 已迁至 workspace yaml）。

## 实施验证（2026-08-19，macOS/arm64 本地）

- `pnpm release:gate:quick` 实弹 PASS（docs/migration-pins/secret-scan/alert-rules 四项 0.6 秒）；全量模式（含 build/typecheck/architecture/unit）复用各关卡既有验证。
- unit 40 文件 292/292 PASS（含 S10RG01-05：八门禁顺序、fail-fast + BLOCKED 输出、summary 模式跳过、排除 fixture/docs、scripts 挂载、无 --force 逃生口）。
- 交付物：`scripts/release-gate.mjs`（可执行，~190 行）、package.json `release:gate` / `release:gate:quick`、S10RG 规格。

## 停止条件

门禁可跳过（无 --force 逃生口——失败就是失败）。
