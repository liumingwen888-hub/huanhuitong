# S3-4 横切最小合同 详细计划索引

计划版本：`v1.0`。风险级别：`L3`。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S3-4 代码状态：`NOT_STARTED`。

## 权威需求来源

[runtime-topology 渐进建设](../../architecture/runtime-topology.md)（"第一个资金功能前"条款）、[domain-map](../../architecture/domain-map.md)（fees-and-risk/admin-audit/bills 各自边界）、[roadmap 阶段 3 进入条件](../roadmap.md)。

## 目标

1. **V5 增量迁移**：
   - `fee_schedules`（版本化：fee_version PK、asset_code、basis_point、fixed_amount BIGINT、生效时间；版本化生效——旧版本保留供历史重算）；
   - `risk_decisions`（追加式：decision_id PK、uid、operation_type、allowed boolean、reason_code、idempotency_key UNIQUE、decided_at——记录每次资金命令前的风险裁决）；
   - `operation_limits`（uid、operation_type、window_seconds、max_count、max_amount BIGINT、UNIQUE(uid, operation_type)）；
   - `config_versions`（config_key PK、version、payload jsonb、activated_at——配置版本化，历史可溯）；
   - `admin_principals`（admin_id uuid PK、status、created_at）+ `admin_role_grants`（admin_id、role、granted_at——独立管理员身份与 RBAC 骨架，无 UI）；
   - 审计复用既有 audit_events（追加式，已建）。
2. **最小接口层**（platform `modules/crosscutting/`）：
   - `FeeCalculator`（按资产+金额查生效 schedule 返回费用——纯读，不写账本）；
   - `RiskGate`（资金命令前查限额/黑名单→写 risk_decisions→返回 allow/deny——**拒绝路径稳定可测**）；
   - `ConfigStore`（读当前版本 + 激活新版本）；
   - `AdminAuthorizer`（服务端默认拒绝：查 principal+role→allow/deny；Maker-Checker 完整实现留待阶段 6 提现前）。
3. **红线**：全部只读账本/零写余额；RiskGate 决不因异常放行（fail-closed）；管理员身份独立于 Telegram 用户体系。

## 冻结未来工程矩阵

Create：`database/migrations/V5__stage_3_crosscutting.sql`、platform `modules/crosscutting/{domain,application,infrastructure}` 六文件、database spec。Modify：0。

## 测试矩阵（S3X）

- fee：版本生效切换（旧交易不受新版本影响重算语义）、未知资产拒绝；
- risk：限额窗口内拒绝/窗外放行、幂等键重放返回原裁决、异常 fail-closed；
- limits：并发窗口计数原子；
- config：版本激活、历史 payload 不可变；
- admin：无授权拒绝、角色授予权限、撤销后拒绝；
- 全部零账本写入断言。

## 停止条件

需要写账本/余额、需要真实管理员数据种子、V5 未获显式授权、三锁漂移。
