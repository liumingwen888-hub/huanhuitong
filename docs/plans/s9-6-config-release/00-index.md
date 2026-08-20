# S9-6 配置发布流 详细计划索引

计划版本：`v1.0`。风险级别：`L3`（配置变更影响资金参数）。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S9-6 代码状态：`NOT_STARTED`。

## 权威需求来源

[阶段 9 总体规划 v1.0](../2026-08-19-stage-9-admin-master-plan.md)（S9-6 任务行）、[admin-and-audit 领域](../../domains/admin-and-audit.md)（Maker-Checker、配置版本、配置签名/版本）、[三张版本表](../../../database/migrations/)（market_configs V9 / provider_configs V12 / signer_policies V8）、[ConfigStore](../../../apps/platform/src/modules/crosscutting/application/crosscutting.services.ts)（config_versions，V5）。

## 目标

版本化配置的**草稿→复核→发布**编排端点：发起人起草新配置版本（不生效），独立复核人核对后发布（写入版本表即时生效）。不新增配置类型——编排四张既有版本表的写入路径。

## 关键设计

### 1. 草稿存储：复用 config_versions（新键 `draft.{domain}.{subject}`）
- **裁决**：不建新表。草稿 = config_versions 里 `draft.` 前缀键的行（payload 含完整目标行 + 目标表标识）；发布 = 从草稿 payload 提取字段写入目标版本表（version = 当前最高 +1）；删除草稿 = UPDATE config_versions 的 revoked 标记（config_versions 无 UPDATE 权限——**需 V15 增 revoked_at 列**或用 payload 内嵌状态）。
- 简化裁决：草稿生命周期用** payload 内嵌 `draftStatus: PENDING_REVIEW | PUBLISHED | REJECTED`** + 发布后原行保留（审计痕迹），不修改任何行——config_versions 保持只增不改。活跃草稿查询 = 最新版本的 `draft.` 键且 draftStatus=PENDING_REVIEW。

### 2. 端点设计（挂载 AdminApiRouter）

| 路由 | 角色 | 级别 | 说明 |
|---|---|---|---|
| POST /admin/config/drafts | FINANCE_OFFICER 或 RISK_OFFICER | ELEVATED | 发起人起草 `{targetTable, targetKey, payload}` |
| GET /admin/config/drafts | 已认证 | BASIC | 待复核清单（含发起人，供复核人查看） |
| POST /admin/config/drafts/:draftId/publish | 与发起人**不同**的 FINANCE/RISK | ELEVATED | 复核发布：提取 payload 写入目标表（version=max+1），标记草稿 PUBLISHED |
| POST /admin/config/drafts/:draftId/reject | 同上 | ELEVATED | 拒绝：标记 REJECTED（留审计） |

### 3. Maker-Checker 强制
- 发布/拒绝的管理员 ≠ 起草管理员（服务层校验 + 审计记录双方）；
- 发起人不能发布自己的草稿（自审拒绝红线）；
- 目标表写入经各域已有 insert 方法（版本互斥约束防并发双发）。

### 4. 支持的目标表（本任务范围）
- `market_configs`（exchange）——通过 PostgresMarketRepository.insert
- `provider_configs`（fiatpayout）——通过 PostgresProviderConfigRepository.insert
- `signer_policies`（withdrawal）——通过 PostgresSignerPolicyRepository.insert
- `config_versions` 业务键（withdrawal.approval / exchange.execution）——通过 ConfigStore.activate

**不在范围**：fee_schedules（S3-4 已有专有管理流）、.operation_limits（用户级）。

## 冻结未来工程矩阵

Create：`modules/admin/application/config-release.service.ts`、`modules/admin/http/admin-config.routes.ts`、`apps/platform/test/database/config-release.integration.spec.ts`（S9CR）。Modify：无（全部复用既有仓储的 insert 方法）。

## 测试矩阵（S9CR，集成）

- S9CR01 起草→发布全流程：market_configs 新版本生效（findActive 切换）
- S9CR02 自审拒绝：发起人发布自己的草稿 → 403 SEMANTIC（非角色级——角色对但人不对）
- S9CR03 拒绝路径：REJECTED 后目标表零写入、草稿保留审计
- S9CR04 双人发布恰一次：并发发布同草稿 → 恰一次目标表写入（幂等键防重）
- S9CR05 目标表白名单：非四表目标 → 400
- S9CR06 审计：起草/发布/拒绝各落审计（maker 与 checker 身份均可见）
- S9CR07 ConfigStore 业务键发布：withdrawal.approval v2 生效

## 边界与不做

- 不做前端 UI（S9-7）；不做定时发布/灰度（阶段 10）；不做配置回滚端点（回滚 = 发布旧参数为新版本——版本化模型的自然操作，文档说明）。

## 停止条件

自审约束可绕过、目标表越权写入、草稿可被未复核直接生效。
