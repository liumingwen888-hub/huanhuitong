# S5-5 Telegram UX 接线 详细计划索引

计划版本：`v1.0`。风险级别：`L2`。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S5-5 代码状态：`NOT_STARTED`。

## 权威需求来源

[阶段 5 总体规划](../2026-08-17-stage-5-transfers-redpackets-master-plan.md)、[telegram-experience 领域](../../domains/telegram-experience.md)、S2-6 security-commands 模式、S5-2/3/4 服务。

## 目标

**`TransferCommandService`**——转账/领取/红包的 Telegram 命令路由与编排：

1. **命令解析**：
   - `/transfer <recipient> <amount>` → 转账
   - `/claim <claim_code>` → 领取链接
   - `/redpacket <total_amount> <count>` → 创建红包
   - `/balance` → 查询余额
2. **路由**：复用 S2-6 security-commands 模式（controller ignored → classify → handler）
3. **编排**：调用 S5-2/3/4 服务 + 回复常量（零动态插值）
4. **余额查询**：BalanceQueryService → 按资产展示

## 冻结未来工程矩阵

Create：`apps/platform/src/modules/telegram/application/transfer-commands.ts`、`application/transfer-replies.ts`、`application/transfer-command.handler.ts`、`test/unit/transfer-commands.spec.ts`、`test/database/transfer-ux.integration.spec.ts`。Modify：`http/telegram-webhook.controller.ts`（扩展 security 命令集）。

## 测试矩阵（S5UX）

unit：命令解析矩阵（合法/非法/缺参）；回复常量零动态插值。
database：/transfer 全链（余额变化+通知）；/claim 全链；/redpacket 创建+领取；/balance 返回正确金额。

## 停止条件

需要绕过 S5-2/3/4 服务、需要新迁移、三锁漂移。
