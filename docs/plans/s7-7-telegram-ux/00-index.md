# S7-7 Telegram UX 详细计划索引

计划版本：`v1.0`。风险级别：`L2`（UX 层，资金逻辑全部下沉已验证服务）。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S7-7 代码状态：`NOT_STARTED`。

## 权威需求来源

[阶段 7 总体规划 v1.0](../2026-08-19-stage-7-exchange-master-plan.md)（S7-7 任务行）、[换汇领域](../../domains/exchange.md)（用户查看有效期、预计所得、汇率、费用和舍入）、[S6-7 先例](../s7-7-telegram-ux/00-index.md)（命令/常量/处理器/通知模式）。

## ⚠️ 首要复审点：受控数值渲染（对零插值模式的受控扩展）

**张力**：领域要求用户看到报价数字（金额/汇率/有效期）；已确立模式是回复常量零插值（防注入）。

**提案**：`renderNumeric(template, values)` 受控渲染器——
- 模板为常量，占位符 `{n}` 位置固定；
- **仅接受字符集白名单值**：金额 `^[0-9]{1,18}$`、市场键 `^[A-Z0-9]{1,16}:[A-Z0-9]{1,16}$`、报价编号复用市场键同集 + UUID 十六进制集；
- 白名单外值抛错（fail-closed），不存在绕过路径；
- 静态测试：处理器源码中所有动态文本必须经 `renderNumeric`，模板文件仍全面禁 `${`/反引号。

**安全论证**：注入面由字符集消灭（纯数字/大写十六进制无法构成标记注入），模板本体不可变。通知文案仍全静态（仅命令回复用受控渲染）。

## 命令面

- `/markets`——市场清单（市场键+限额经 renderNumeric 渲染，只读）。
- `/rate <market_key> <sell_amount>`——创建真实报价（S7-2 服务），渲染报价编号/买得/有效期剩余秒。
- `/exchange <quote_id>`——确认（S7-3 服务；**无支付密码门**，已裁决）；结果类别常量（CONFIRMED/ALREADY/五类拒绝）。
- `/exchangestatus <order_ref>`——本人订单六态常量（他人/不存在同一常量）。

## 处理器与通知

- `ExchangeCommandHandler`：resolveUid（未绑定常量）→ 分发；`/rate` 与 `/exchange` 输出经受控渲染或类别常量。
- worker：`exchange-reserved/settled/failed/refunded` 四主题 → 注入式静态文案（WithdrawalNotificationHandler 同型，扩展 texts 映射注册进 create-worker）。

## 冻结未来工程矩阵

Create：`telegram/application/{exchange-commands.ts, exchange-replies.ts, exchange-command.handler.ts, numeric-render.ts}`、`apps/platform/test/unit/exchange-commands.spec.ts`（S7EU）。Modify：`create-worker.ts`（四主题注册）。

## 测试矩阵（S7EU，单元 + Fake）

- S7EU01 解析器矩阵（合法/非法市场键、金额、报价编号、参数数、非私聊）
- S7EU02 /rate 全链路（Fake 服务）：报价创建调用真实参数 + 渲染输出含报价编号/买得（受控值）+ 非法服务结果类别常量
- S7EU03 /exchange：CONFIRMED/ALREADY_CONFIRMED/五类拒绝 → 常量；服务调用参数携带 quote_id + uid
- S7EU04 /markets：渲染市场键与限额；空清单常量
- S7EU05 /exchangestatus：六态 + 他人/不存在 unknown
- S7EU06 renderNumeric：白名单拒绝矩阵（字母/符号/空/超长/大写外）+ 模板占位符不匹配抛错 + 静态扫描（处理器动态文本仅经 renderNumeric、回复文件零 `${`/反引号）
- S7EU07 通知四主题 → 四静态文案（复用注入模式断言）

## 边界与不做

- 不做新资金逻辑；不做按钮 UI；通知文案保持全静态（数字化显示仅命令回复）。

## 停止条件

受控渲染的白名单被绕过、任何未经验证值进入回复文本。
