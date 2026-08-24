# S10-7 容量与性能基线 详细计划索引

计划版本：`v1.0`。风险级别：`L2`（基准脚本与文档）。计划状态：`READY v1.0`（2026-08-19 用户"继续下一步工作"授权实施）。S10-7 代码状态：`VERIFIED`（2026-08-19：基准脚本 + 基线文档 + S10CP01-05 全 PASS——见下）。

## 权威需求来源

[阶段 10 总体规划 v1.0](../2026-08-19-stage-10-production-master-plan.md)、[platform-operations 领域](../../domains/platform-operations.md)（健康与容量）。

## 目标

三项核心操作的**容器内基准** + 基线文档 + 降级预案——生产容量规划的种子数据与已知边界。

## ENVIRONMENT_BOUNDARY 前置声明

真实容量数字（生产硬件/网络/并发用户）**必须**在生产环境实测后替换本任务产出的合成基线。本任务的价值：基准方法可重复、相对量级有参照、降级预案就位。

## 基准脚本（scripts/benchmark-kernel.mjs）

对临时 PostgreSQL 容器（复用 testcontainers 基建）执行三项基准，输出 JSON 结果：

1. **内核过账 TPS**——N 笔余额充足的转账过账（顺序），测 kernel 路径（锁/校验/投影）
2. **并发注册**——M 路并发首注册（每路独立 telegram id），测注册幂等路径
3. **查询延迟**——对账三域报告 × K 次调用，测读路径 p50/p99

参数：`--posting N --registrations M --queries K`；结果含环境元数据（容器镜像 digest / Node 版本 / 时间戳）。

## 基线文档（docs/operations/capacity-baseline.md）

- 三项基准的**方法**（可重复步骤）+ 首次运行结果 + 历史趋势表（追加式）；
- 明确标注：合成环境数字，生产实测后替换；
- 容量触发点建议（何指标超何阈值时扩容）。

## 降级预案（文档内嵌）

- 过账延迟 p99 > 2s：暂停新单（max_amount=1 配置发布）→ 诊断 → 恢复；
- 注册 TPS 下降 >50%：检查数据库连接池 → 索引 → 审计表膨胀；
- 对账超时：只读副本方案（生产）。

## 冻结未来工程矩阵

Create：`scripts/benchmark-kernel.mjs`、`docs/operations/capacity-baseline.md`、`apps/platform/test/unit/capacity-baseline.spec.ts`（S10CP）。Modify：无。

## 验收矩阵（S10CP，单元——脚本与文档结构验证；实弹基准属可选 ENVIRONMENT_BOUNDARY）

- S10CP01 基准脚本三模式齐全（posting/registrations/queries）+ 参数解析 + JSON 输出
- S10CP02 环境元数据（镜像 digest/Node 版本/时间戳）入结果
- S10CP03 基线文档含方法/首次结果/趋势表/ENVIRONMENT_BOUNDARY 声明
- S10CP04 降级预案三触发点齐全
- S10CP05 基线文档已入 docs:check 索引

## 实施裁决记录（2026-08-19）

1. 基线文档**不预填合成数字**——避免合成环境数字被误读为生产参照；趋势表首行留待首次实测（无论合成还是生产）。
2. 基准脚本三模式标记 ENVIRONMENT_BOUNDARY（需 Docker 实弹填充结果）；结构/参数/元数据 schema 由单元测试锁定。

## 实施验证（2026-08-19，macOS/arm64 本地）

- `pnpm build` exit 0；`pnpm architecture:check` 0 违规（218 模块）；`pnpm docs:check` 234 文件 PASS。
- unit 41 文件 297/297 PASS（含 S10CP01-05：三模式 + 参数解析 + JSON 输出、环境元数据、方法/边界/趋势表、三触发点降级、文档无"生产承诺"表述）。
- 交付物：`scripts/benchmark-kernel.mjs`（可执行）、`docs/operations/capacity-baseline.md`、S10CP 规格。

## 停止条件

合成数字被表述为生产承诺。
