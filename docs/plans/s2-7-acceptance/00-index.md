# S2-7 威胁模型与阶段 2 验收 详细计划索引

计划版本：`v1.0`。风险级别：`L2`。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S2-7 代码状态：`NOT_STARTED`。

## 权威需求来源

[阶段 2 总体规划 S2-7](../2026-08-17-stage-2-account-security-master-plan.md)（威胁模型更新、泄漏矩阵、暴力与重放测试、冷静期验收）、[领域测试重点](../../domains/account-security-and-recovery.md)、Task 14 验收模式复用。

## 目标

1. **阶段 2 具名验收 16 项**（编号 S2A01–S2A16，全真实断言）：
   - 泄漏矩阵（01–05）：凭证表/会话表/Inbox/Outbox/audit_events/log 全载荷零密码材料（哨兵扫描）；日志白名单扩展 security 事件后的零敏感；span attribute 零通道。
   - 暴力与重放（06–09）：5 次锁定 + 阶梯 ×2；锁定窗口短路；nonce 重放零效果；同 update_id 重放 duplicate。
   - 生命周期（10–11）：密码输入内存清零（缓冲复借为空）；重哈希升级链。
   - 恢复与冷静期（12–14）：四因子链 APPROVED + 凭证 COOLDOWN；冷静期 authorize 受限；越权/因子不足拒绝。
   - 集成（15）：Bot UX 全链（/setpassword → ACTIVE → /authorize → authorized）。
   - 架构（16）：depcruise 0 违规 + 安全模块零 grammY 依赖（静态）。
2. **威胁模型更新**：threat-model.md 增补阶段 2 资产/威胁/控制映射（凭证哈希、会话洪水、恢复社交工程、TOTP 窗口、冷静期绕过），每项控制链接到 S2A 编号证据。
3. **状态收敛**：阶段 2 代码 READY 等待用户验收（同 Task 14 模式）；S2 文档同步（领域/安全/测试/观测/current/next/verification/progress-log）。

## 冻结未来工程矩阵

Create：`apps/platform/test/integration/stage-two-acceptance.integration.spec.ts`（01–16 编号连续）、`apps/platform/test/security/stage-two-leakage.spec.ts`（若安全 glob 更合适则并入前者）。Modify：`docs/security/threat-model.md`、`docs/status/*`（终态收敛）。

## 实施步骤

红灯（验收 spec 骨架）→ 逐项绿灯（复用既有 fixture/harness 模式）→ test:all/docs:check 全链 → 威胁模型与文档同步 → 交付报告 → 用户验收。

## 停止条件

任何验收项无法以真实驱动满足（结构性）；需新依赖/迁移；三锁漂移。
