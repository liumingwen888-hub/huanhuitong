# S9-8 威胁模型与验收 详细计划索引

计划版本：`v1.0`。风险级别：`L3`（阶段收官验收）。计划状态：`READY v1.0`（2026-08-19 用户"继续下一步工作"授权实施）。S9-8 代码状态：`VERIFIED`（2026-08-19：S9A01-12 全 PASS、威胁模型十一项增补落档、全量回归绿——见下）。

## 权威需求来源

[阶段 9 总体规划 v1.0](../2026-08-19-stage-9-admin-master-plan.md)、[威胁模型](../../security/threat-model.md)、S9-1～S9-7 各计划实施验证节。

## 验收矩阵（S9A，integration 项目——真库真服务）

- S9A01 认证全链路：登录→锁定→会话→提升→登出（bootstrap 管理员）
- S9A02 RBAC 默认拒绝矩阵：未注册路径 404 / 无角色决定 403 / 无提升 403 / 角色对但人不对（自审）403
- S9A03 审批全链路：待审清单 → 双审批（两管理员）→ APPROVED
- S9A04 拒绝链：REJECT 带 reason → REJECTED → 审批事实完整（withdrawal_approvals 双行）
- S9A05 代付查询裁决链：UNKNOWN → resolve 触发供应商查询 → SUCCEEDED_REPORTED → 审计落档
- S9A06 对账视图只读：三域零差异 + 观察清单 + 行数不变
- S9A07 审计查询：AUDITOR 专职（FINANCE 403）+ 过滤精确 + 元审计
- S9A08 配置发布 Maker-Checker：起草→不同人发布→版本生效→恰一次
- S9A09 审计不可删：平台角色 DELETE audit_events 被拒
- S9A10 会话令牌哈希：登录响应令牌 ≠ 库中存储值（sha256）；暴力 5 次锁定
- S9A11 配置发布自审拒绝：maker 发布自己 403 + 目标零写入
- S9A12 全链路审计完整性：每类操作至少一条 GRANTED 审计 + 拒绝路径至少一条 DENIED

## 冻结未来工程矩阵

Create：`apps/platform/test/integration/stage-nine-acceptance.integration.spec.ts`。Modify：`docs/security/threat-model.md`（阶段 9 增补节）。

## 实施验证（2026-08-19，macOS/arm64 本地）

- S9A01–S9A12 全 PASS（12/12）：认证全链路（登录→五次锁定→会话）、三层默认拒绝（404/403 角色/403 提升）、双审批全链路（两管理员→APPROVED）、拒绝链决策事实双行完整、代付查询裁决、对账视图只读（行数不变）、审计查询 AUDITOR 专职 + 元审计、配置发布恰一次（第二发布 404 + 单版本）、审计不可删（DELETE 被权限拒）、令牌 sha256 哈希验证、配置自审拒绝（403 + 目标零写入）、审计完整性（GRANTED 与 DENIED 并存）。
- 阶段 9 威胁模型增补十一项落档。
- 全量回归：unit 34 文件 264/264；database 56 文件 550/553（已知三件套）；integration 14 文件 132–133（registration-concurrency 已知负载抖动，隔离 14/14 通过）。

## 停止条件

任一验收项失败且根因在 S9-1～S9-7 交付物（回溯修复后重跑全矩阵）。
