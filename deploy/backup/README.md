# 备份策略与运维手册

## 红线

**备份必须验证。** 每次备份后必须跑 `pg-restore-check.sh`；未通过验证的备份视为不存在。

## 双轨策略

| 轨道 | 工具 | 频率（生产） | 保留 | 用途 |
|---|---|---|---|---|
| 物理 | pg_basebackup + WAL 连续归档 | 每日全量 + 连续 WAL | 7 天 | PITR（任意时间点恢复） |
| 逻辑 | pg_dump --format=custom | 每日 | 30 天 | 跨版本迁移、单表抽取、归档审计 |

- **RPO**：物理轨 WAL 连续归档 → 接近零丢失（生产实际值取决于归档传输延迟）。
- **RTO**：物理恢复目标 < 30 分钟（合成环境验证流程可用；生产数字首灾实测后修正）。
- 备份产物命名 `hht-{kind}-{yyyyMMdd-HHmmss}`；每份带 SHA-256 校验和；追加写入 `backup-manifest.txt`。

## 使用

### 备份（连接参数走 PG* 环境变量，脚本零明文凭据）

```bash
export PGHOST=... PGPORT=5432 PGUSER=... PGPASSWORD=...
./pg-backup.sh both /backup/target
```

### 验证（必跑）

```bash
./pg-restore-check.sh /backup/target/hht-logical-<ts>.dump
./pg-restore-check.sh /backup/target/hht-physical-<ts>
```

通过输出 `RESTORE_CHECK_PASSED`；任何表缺失或查询失败即非零退出。

### 恢复步骤（灾难时）

1. 停止写入（platform/worker 下线）。
2. 物理恢复：新 PostgreSQL 以备份目录为数据目录启动（或 pg_basebackup 的恢复流程 + WAL 重放至目标时间点）。
3. 逻辑恢复：`pg_restore -d <newdb> --no-owner <dump>`。
4. 跑三域对账（ledger/exchange/payout reconciliation）确认资金一致。
5. 确认 `SAFE_TO_RESUME` 后逐步恢复服务（详见 S10-4 恢复演练 runbook）。

## 恢复演练（S10-4）

定期对真数据跑闭环演练——备份→恢复→对账→无副作用断言，全程脚本化：

```bash
export PGHOST=... PGPORT=5432 PGUSER=... PGPASSWORD=...
./pg-restore-drill.sh            # 成功后自动清理
./pg-restore-drill.sh --keep    # 保留现场供调查
```

通过输出 `RESTORE_DRILL_PASSED` + 证据摘要（四表计数/借贷平衡/投影零漂移/Outbox 保留数/零新租约）。任何断言失败停在当前阶段并**保留容器**（FAILED 分支不静默清理）。

**无重复副作用红线**：恢复后的 Outbox 未投递消息原样保留（恢复不是重发器——留给正常投递循环）；恢复库无 worker 连接，durable_jobs 不出现新 LEASED。

## 生产部署清单（独立授权后）

- [ ] cron 或 K8s CronJob 调度 `pg-backup.sh both`（每日）
- [ ] 备份后自动 `pg-restore-check.sh`
- [ ] 异地复制（对象存储 / 跨可用区）
- [ ] WAL 归档目标（本地卷 → 对象存储）确认 `archive_command` 成功率
- [ ] 保留策略落地（7/30 天清理）
- [ ] 首灾演练记录 RTO 实测数字
