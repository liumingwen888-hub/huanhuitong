# S2-6 Telegram 安全 UX 接线 详细计划索引

计划版本：`v1.0`。风险级别：`L3`。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S2-6 代码状态：`NOT_STARTED`。

## 权威需求来源

[领域文档](../../domains/account-security-and-recovery.md)（用户流程：首次受保护操作暂停进入两次输入；审计要求：密码相关 Update 字段白名单、不记录原始 callback_query）、[AGENTS 红线](../../../AGENTS.md)（回显禁止）、Task 9 Webhook 边界、S2-3 会话服务。

## 目标

1. **安全命令路由** `security-commands.ts`：解析 `/setpassword`、`/cancel`、恢复入口命令；映射到会话服务（begin/append/confirm/cancel）与恢复服务；经 Task 9 既有五道门禁与 Inbox 幂等边界（安全命令同样入 Inbox 认领，eventKey 独立前缀）。
2. **密码输入处理**：私聊数字消息（会话 OPEN 期间）→ 一次性 nonce 派生（update_id）→ `appendDigit`；输入完成以 `/done`（或满位数自动）切换 primary→confirmation→confirmSetup。消息文本**永不**进入日志/Outbox/审计（仅 update_id 维度）。
3. **回复编排** `security-replies.ts`：设置开始/输入中（仅星号计数，**不回显数字**）/两段切换/成功/不一致/位数越界/已锁定/冷静期中/取消确认——全部静态文案常量，零动态值注入；回复经 Outbox `telegram.security-prompt.v1` topic 由 worker 网关发送（复用 at-least-once + 幂等键）。
4. **授权流入口**：未来资金命令（阶段 3+）将调用 `beginAuthorization`——本任务提供 `/authorize <order>` 演示命令打通 proof 签发全链（proof 不回显，仅确认语）。
5. **防滥用**：非私聊/无会话数字消息 200 ignored；会话过期自动提示重开；单 OPEN 约束冲突提示先取消。

## 冻结未来工程矩阵

Create：`apps/platform/src/modules/telegram/application/security-commands.ts`、`application/security-replies.ts`、`test/unit/security-commands.spec.ts`、`test/database/security-ux.integration.spec.ts`（经 HTTP + 真实会话服务）。Modify：`http/telegram-webhook.controller.ts`（安全命令分支接线——挂 Task 9 startHandler 旁路）。

## 测试矩阵（S6Cx）

unit：命令解析矩阵（合法/非法/非私聊/无会话数字）；回复常量零动态插值（静态断言）。
database（HTTP 全链）：/setpassword → 数字两段 → 成功 ACTIVE + 会话 CONFIRMED + 提示 Outbox topic 恰 N 条；不一致流程 FAILED + 提示；锁定用户 /setpassword 提示冷静期/锁定；数字消息在无会话时零副作用；Inbox 幂等（同 update_id 重放零新副作用）；审计零密码材料（哨兵扫描 audit_events/outbox/log 输出）。

## 红线复述

数字消息正文、已输内容、任何派生片段不进 Inbox payload/Outbox payload/日志/审计；提示消息不含任何用户输入回显；删除原消息属 Bot API 调用——经网关接口留给部署阶段启用（登记：本阶段仅发提示，不调用 deleteMessage）。

## 停止条件

需要 deleteMessage 真实调用（外部连接授权 0）、需要 V3、需要把 digit 写入任何持久载荷、三锁漂移。
