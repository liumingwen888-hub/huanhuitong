# S10-3 备份策略与脚本 详细计划索引

计划版本：`v1.0`。风险级别：`L2`（备份脚本与配置，无业务逻辑变更）。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S10-3 代码状态：`NOT_STARTED`。

## 权威需求来源

[阶段 10 总体规划 v1.0](../2026-08-19-stage-10-production-master-plan.md)（决策 3：物理为主逻辑为辅双轨）、[platform-operations 领域](../../domains/platform-operations.md)（BackupSet、备份验证）。

## 目标

数据库备份的**双轨策略 + 可验证脚本**：pg_basebackup 物理全量（PITR 基础）+ pg_dump 逻辑（跨版本可移植）+ restore-check 自动验证（备份不可验证等于没有备份）。

## 备份策略

| 轨道 | 工具 | 频率（生产） | 保留 | 用途 |
|---|---|---|---|---|
| 物理 | pg_basebackup + WAL 归档 | 每日全量 + 连续 WAL | 7 天 | PITR（任意时间点恢复） |
| 逻辑 | pg_dump --format=custom | 每日 | 30 天 | 跨版本迁移、单表抽取、归档审计 |

- **RPO 目标**：物理轨 WAL 连续归档 → 接近零丢失（生产取决于归档延迟）；
- **RTO 目标**：物理恢复 < 30 分钟（合成环境验证流程，生产数字届时实测）；
- 备份文件命名：`hht-{kind}-{yyyyMMdd-HHmmss}`；校验和 `.sha256` 同目录。

## 脚本设计（deploy/backup/）

### `pg-backup.sh`——双轨备份入口
```
用法: pg-backup.sh <physical|logical|both> <target_dir> [connection_args...]
physical → pg_basebackup -D <dir>/hht-physical-{ts} --wal-method=stream --checkpoint=fast
logical  → pg_dump --format=custom --file <dir>/hht-logical-{ts}.dump
both     → 依序执行，任一失败即退出非零（fail-fast）
后处理   → sha256sum 生成校验和；写入 backup-manifest.json（kind/ts/size/sha256/db_version）
```
- 脚本带 `set -euo pipefail`；连接参数从环境变量（PGHOST/PGPORT/PGUSER/PGPASSWORD）——**不落脚本**。

### `pg-restore-check.sh`——备份验证（合成环境核心）
```
1. 拉起临时 PostgreSQL 容器（随机端口，testcontainers 模式或 docker run）
2. logical: pg_restore --list 确认可读 + pg_restore 全量到临时库
3. physical: 临时容器以备份目录为 data 目录启动 + recovery 完成确认
4. 验证查询：关键表行数 > 0（users/ledger_transactions/audit_events）
5. 销毁临时容器；全部通过输出 RESTORE_CHECK_PASSED，否则非零退出
```

### compose 集成
`docker-compose.yml` postgres 服务增 WAL 归档配置（`archive_command` + `archive_mode=on`——物理轨的前提）。

## 冻结未来工程矩阵

Create：`deploy/backup/pg-backup.sh`、`deploy/backup/pg-restore-check.sh`、`deploy/backup/README.md`（运维手册：策略/恢复步骤/RPO-RTO）、`apps/platform/test/unit/backup-scripts.spec.ts`（S10BK）。Modify：`deploy/docker-compose.yml`（WAL 归档）。

## 测试矩阵（S10BK，单元——脚本结构验证；实弹恢复属 S10-4）

- S10BK01 pg-backup.sh 结构：set -euo pipefail / 双轨分支 / sha256 后处理 / manifest 生成 / 无明文连接串
- S10BK02 pg-restore-check.sh 结构：临时容器 / 关键表验证 / 清理 trap / RESTORE_CHECK_PASSED 输出
- S10BK03 compose WAL 归档配置存在（archive_mode/archive_command）
- S10BK04 README 覆盖：RPO/RTO 数字 / 双轨说明 / 恢复步骤 / "备份必须验证"红线

## 边界与不做

- 不做定时调度（生产 cron/K8s CronJob 独立配置——README 说明）；不做异地复制（生产存储策略独立授权）；实弹恢复演练属 S10-4。

## 停止条件

脚本含明文凭据、备份无校验和、恢复检查跳过验证查询。
