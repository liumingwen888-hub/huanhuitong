# Telegram 体验领域

## 目标

以 Telegram Bot 提供安全、清晰、可恢复的第一阶段交互，同时保持领域规则与渠道解耦。

## 职责

Webhook 入口、Update 去重、命令/回调路由、主菜单、Language、会话协调、内联键盘、深链解析、收款候选展示、通知和客服入口。

## 不负责什么

不把 Telegram 会话当资金事实，不直接记账，不证明 username 所有权，不假设可联系未启动 Bot 的用户，不使用 Mini App。

## 用户流程

/start 自动解析或创建 UID 后展示主菜单；注册只建立身份、会员、绑定、最小资料和幂等记录。主菜单只展示已经批准并启用的资产能力，不能因交易对目录存在而创建余额账户。资金对话通过服务端短期会话推进并可取消/过期。支付密码输入使用内联数字键盘：callback_data 只携带一次性随机令牌，服务端映射为单个输入动作并交给专用凭证组件；不携带完整密码。领取 start 参数解析为不透明令牌。收款选择可使用已绑定搜索、平台 UID、原生用户选择或内联分享，但付款前必须二次确认平台身份。

## 核心实体

TelegramBindingRef、UpdateInbox、ConversationSession、MenuVersion、CallbackNonce、DeepLinkPayloadRef、NotificationOutbox、LocalePreference。

## 状态机

Session：OPEN、WAITING_INPUT、CONFIRMING、COMPLETED、CANCELLED、EXPIRED。阶段 1 计划的 Update Inbox：RECEIVED、CLAIMED、PROCESSED、CONFLICT、FAILED；同 ID 以原记录摘要 key version 比对完整 parsed Update 的 canonical HMAC，相同是 duplicate_same_payload，异 digest 是 conflict，缺少旧 key 是失败关闭而非处理。

## 输入

经 Webhook 传入的 Update、user.id、消息、callback_query、UsersShared、start 参数和异步通知事件。密码相关 callback_query 是不可信输入，只按字段白名单解析一次性动作令牌。

## 输出

领域用例命令、Bot 消息/键盘、用户安全提示、通知任务和交互审计摘要。支付密码只流向专用凭证组件；资金用例只获得授权证明或引用。

## 公开接口或事件

HandleTelegramUpdate、RenderMainMenu、StartConversation、SendNotification；TelegramUserSeen、ConversationExpired、NotificationFailed。

## 依赖方向

依赖 identity 及各领域公开应用接口、Outbox/Inbox；领域核心不依赖 grammY 类型或 Telegram 消息结构。

## 资金影响

不直接动资金。所有确认操作携带订单/会话 nonce，最终结果从领域状态读取，不以消息发送成功判断。

## 幂等要求

Update ID、callback nonce 和会话版本去重；重复消息/回调返回已有状态；多个密码会话互不覆盖。

## 安全要求

验证 Webhook secret token、限制请求大小、回调数据最小化、防重放、敏感内容不回显、消息编辑防陈旧按钮。密码按钮使用映射单个动作的一次性随机回调令牌；不记录原始 callback_query；密码 Update 使用字段白名单日志；会话完成、取消或过期立即清除专用组件内存状态。

## 审计要求

记录 Update ID、UID、路由、会话和结果摘要；密码相关 Update 只记录允许字段和结果类别，不记录原始 callback_query、动作令牌或密码。不存原始领取令牌、Bot Token 或完整敏感消息。

## 测试重点

重复 Webhook、乱序/重放密码回调、一次性令牌、会话内存清除、日志白名单、多语言、深链、原生用户选择限制、通知 429/失败与陈旧菜单。

## 需求状态

Bot 入口和非 Mini App 边界 APPROVED；具体菜单文案和候选优先级 DRAFT。

## 交付状态

NOT_STARTED。

## 开发门禁

阶段 1 前须批准 Webhook、安全会话与身份接口计划，并把 Inbox、Outbox、持久任务、结构化日志、OpenTelemetry 接口、配置校验和敏感字段过滤作为同阶段工程基础；通知与 Update 幂等不能等待阶段 10。当前开发授权为 0。

阶段 1 v1.2 计划使用 grammY webhook adapter 而不调用 `bot.start()`；测试注入 BotInfo 且禁止网络。照片、贴纸、服务消息、callback query、非 `/start` 及其他合法但未支持的 Update 必须 200 ignored 并无身份或资金效果；只有畸形最小 envelope 返回 400。

Task 5 v1.3 进一步规定：有效 `/start` 的完整 parsed Update 由 HTTP 适配器直接交给 `digestTelegramUpdate(update, keyring)`；Task 5 内部完成 canonicalization、HMAC 和临时 bytes 清零。任何字段（含 text、callback、from、chat、顶层类型和未来字段）变化均可检测，object key order 是唯一等价形态；根/嵌套 object/嵌套 array Proxy 在观察前拒绝。repository 的 Date 输入只接受精确普通 Date、own key 0并通过 intrinsic 读取，不执行调用方覆盖的 getter/method。mapper 只向应用层传递最小 start DTO 与摘要 candidates，不能传递 raw Update、canonical bytes 或摘要 key material；keyring 无法解析或旧 key 缺失时返回稳定 503，不创建身份或菜单任务。

## 待确认问题

Telegram Bot 不是端到端加密的独立安全设备；在 Telegram 内输入的支付密码不能视为独立于该渠道的强认证因素。高风险增强认证见 [P0 第 7、8 项](../product/open-decisions.md)，领取和查询密码门槛见第 10 项；Telegram 官方能力结论见 [研究记录](../research/telegram-feasibility.md)。
