# S10-8 威胁模型与验收 详细计划索引

计划版本：`v1.0`。风险级别：`L3`（阶段收官验收——整个项目的最后一个实施任务）。计划状态：`READY v1.0`（2026-08-19 用户"继续下一步工作"授权实施）。S10-8 代码状态：`VERIFIED`（2026-08-19：S10PR01-10 全 PASS + 威胁模型四项增补 + 全量回归绿——见下）。

## 权威需求来源

[阶段 10 总体规划 v1.0](../2026-08-19-stage-10-production-master-plan.md)、[威胁模型](../../security/threat-model.md)、S10-1～S10-7 各计划实施验证节。

## 验收矩阵（S10PR——production readiness，单元级汇总既有交付的结构验证）

- S10PR01 编排合同：五服务 compose + fail-fast 语法 + 健康门控链（复跑 S10CO 断言）
- S10PR02 观测合同：12 计数器封闭 + 六域插桩 + 告警规则六条（复跑 S10OB 断言）
- S10PR03 备份合同：双轨脚本 + restore-check + WAL 归档（复跑 S10BK 断言）
- S10PR04 演练合同：五状态机 + 无副作用断言（复跑 S10DR 断言）
- S10PR05 runbook 合同：四场景 × 五步 + 升级矩阵（复跑 S10DM 断言）
- S10PR06 门禁合同：八项 + fail-fast + 无 --force（复跑 S10RG 断言）
- S10PR07 基线合同：三模式 + 不预填 + 降级（复跑 S10CP 断言）
- S10PR08 全量回归绿：unit 全过 + build + arch + docs 四关卡
- S10PR09 ENVIRONMENT_BOUNDARY 清单汇总：compose 实弹 / 基准实弹 / PITR / 生产部署四项如实列出
- S10PR10 威胁模型阶段 10 增补：备份泄露 / 恢复重发 / 发布绕过 / 观测盲区四类威胁落档

## 冻结未来工程矩阵

Create：`apps/platform/test/unit/production-readiness.spec.ts`（S10PR，聚合复验各合同断言 + 全关卡冒烟）。Modify：`docs/security/threat-model.md`（阶段 10 增补节）。

## 实施验证（2026-08-19，macOS/arm64 本地）

- S10PR01–S10PR10 全 PASS（10/10）：编排合同（五服务/fail-fast/健康门控链/WAL 归档）、观测合同（12 计数器 + 告警规则 ≥6）、备份合同（双轨 + restore-check + 关键表）、演练合同（五状态机 + 无副作用双断言）、runbook 合同（四场景 × 五步 + 升级矩阵）、门禁合同（八项 + 无 --force）、基线合同（三模式 + 不预填）、门禁脚本结构 smoke、ENVIRONMENT_BOUNDARY 四项如实枚举、威胁模型阶段 10 增补四威胁。
- 阶段 10 威胁模型增补：备份文件泄露 / 恢复演练重发副作用 / 发布绕过 / 观测盲区。
- 全量回归：build exit 0；architecture 218 模块 0 违规；docs:check 235 文件；unit 42 文件 307/307；database 550/553（M06/M14/M16 已知环境边界项）；integration 132/133（registration-concurrency 已知负载敏感抖动）。

## 停止条件

任一合同断言失败（回溯修复后重跑全矩阵）。
