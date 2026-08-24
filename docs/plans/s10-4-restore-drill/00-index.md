# S10-4 恢复演练 详细计划索引

计划版本：`v1.0`。风险级别：`L2`（演练脚本与文档，无业务逻辑变更）。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S10-4 代码状态：`NOT_STARTED`。

## 权威需求来源

[阶段 10 总体规划 v1.0](../2026-08-19-stage-10-production-master-plan.md)（决策 4）、[platform-operations 领域](../../domains/platform-operations.md)（RestoreRun 状态机、"恢复后先冻结外部副作用，核对……再逐步恢复"）、[S10-3 备份脚本](../s10-3-backup/00-index.md)（已 VERIFIED）。

## 目标

**自动化恢复演练闭环**：对一份真数据执行 逻辑备份 → 模拟灾难（销毁原库）→ 恢复到新容器 → 三域对账断言 → **无重复副作用断言**（恢复后 Outbox/任务不自动重发）→ 清理——全程脚本化、可重复、产出演练证据。

## RestoreRun 状态机（领域对齐）

```
PLANNED → RESTORING → VALIDATING → RECONCILING → SAFE_TO_RESUME
                                    ↘ FAILED（任何阶段失败，保留现场供调查）
```
演练脚本按此顺序输出阶段标记；每个阶段有明确的通过/失败判据（失败即停在当前阶段并保留容器）。

## 演练脚本设计（deploy/backup/pg-restore-drill.sh）

```
前置：Docker 可用；S10-3 的 pg-backup.sh / pg-restore-check.sh 就绪
1. [PLANNED]   参数解析（源库连接/目标端口）；生成演练 ID（drill-{ts}）
2. [RESTORING] 对源库跑 pg_dump（逻辑轨）；销毁演练用旧容器（如存在）；
               新容器启动 → pg_restore 全量导入
3. [VALIDATING] 关键表行数对比（源 vs 恢复库：users/ledger_transactions/
               audit_events/withdrawal_orders —— 各表源计数 == 恢复计数）
4. [RECONCILING] 三域一致性断言（在恢复库上执行）：
               a. 账本借贷平衡：SUM(DEBIT) == SUM(CREDIT)
               b. 投影零漂移：account_balances == entries 重算
               c. Outbox 未投递消息数记录（不自动重投——见下）
5. [SAFE_TO_RESUME] 断言恢复库的 durable_jobs 无 LEASED 态（租约未漂移）、
               Outbox 未投递消息保留（恢复不吞消息也不重发）；
               输出 RESTORE_DRILL_PASSED + 证据摘要（各表计数/对账结果）
6. [清理]      docker rm 演练容器（--keep 参数可保留现场）
```

## 无重复副作用的断言设计（本任务核心）

恢复后的库**不能**因为恢复动作本身产生新的外部副作用：
- **Outbox 未投递消息原样保留**（数量与源一致）——恢复不是重发器；
- **durable_jobs 无新 LEASED**（租约代次不漂移——旧租约在恢复后已过期，但不会有新租约被创建，因为没有 worker 连恢复库）；
- 脚本显式断言这两点并输出计数对比。

## 冻结未来工程矩阵

Create：`deploy/backup/pg-restore-drill.sh`、`apps/platform/test/unit/restore-drill.spec.ts`（S10DR）。Modify：`deploy/backup/README.md`（演练章节）。

## 测试矩阵（S10DR，单元——脚本结构验证；实弹需 Docker + 源库）

- S10DR01 状态机五阶段标记齐全且顺序正确（PLANNED→…→SAFE_TO_RESUME）+ FAILED 分支
- S10DR02 表计数对比断言（源 == 恢复，四表）
- S10DR03 三域对账断言存在（借贷平衡/投影零漂移）
- S10DR04 无重复副作用断言（Outbox 保留 + 无新 LEASED）
- S10DR05 清理语义（默认销毁 + --keep 保留现场 + 失败保留）

## 边界与不做

- 不做 PITR 时间点恢复实弹（物理轨 WAL 重放需生产归档环境——S10-3 README 已说明）；不做自动故障切换（生产高可用独立授权）。

## 停止条件

演练脚本在失败时静默清理现场（应保留）、恢复后自动触发任何外部副作用。
