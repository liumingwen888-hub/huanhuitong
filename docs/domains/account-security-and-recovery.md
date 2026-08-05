# 账户安全与恢复领域

## 目标

为资金操作提供独立于登录渠道的支付授权、风控锁定、凭证生命周期与安全恢复。

## 职责

在专用凭证处理组件中短暂组合和验证支付密码；维护版本化哈希、失败计数与锁定；管理短期输入会话、可选 TOTP、凭证重置和恢复案件；向资金领域签发最小化短期授权证明或引用。

## 不负责什么

不创建 UID，不直接扣款，不让客服读取凭证，不自动改 Telegram 绑定，不决定业务订单成功。

## 用户流程

首次受保护操作暂停并进入两次密码输入；一致、风险允许且哈希保存成功后回到安全续接点。验证失败累计锁定。重置和账号恢复使用独立流程，重置后可进入资金安全期。

## 核心实体

PaymentCredential、CredentialPolicyVersion、CredentialSession、AttemptCounter、SecurityLock、TotpEnrollment、RecoveryCase、RecoveryEvidence。

## 状态机

Credential：NOT_SET、ACTIVE、LOCKED、RESET_PENDING、COOLDOWN、REVOKED。Session：OPEN、CONFIRMED、CANCELLED、EXPIRED、FAILED。失败或过期不能继续原资金动作。

## 输入

UID、受保护操作上下文、由一次性回调令牌映射的单个数字/控制动作、验证请求、恢复证据和已审批安全策略。专用组件可在短期内存中组合原文；资金领域不能作为输入方。

## 输出

绑定 UID、订单、操作类型、金额/资产摘要和短期限的支付授权证明或引用，以及拒绝原因、锁定状态、重置/恢复案件结果和安全事件。输出不包含密码原文或哈希。

## 公开接口或事件

BeginCredentialSetup、AppendDigit、ConfirmCredential、AuthorizePayment、BeginRecovery、ApproveRecovery；CredentialSet、CredentialLocked、CredentialReset、RecoveryCompleted。

## 依赖方向

依赖 identity 的 UID、配置版本、风险与审计；接收 Telegram 适配器解析后的一次性输入动作。资金领域只依赖短期授权结果，不得依赖或访问密码原文、哈希或凭证会话。不得依赖 Telegram 会话存储作为唯一状态。

## 资金影响

不记账，但决定资金命令是否可继续。授权证明必须绑定 UID、操作类型、订单、金额/资产摘要和短期限。

## 幂等要求

会话 ID 和动作 nonce 唯一；重复按键或回调不重复追加；同一授权只能按策略消费；并发会话互不覆盖。

## 安全要求

安全密码哈希、版本化参数、常量时间验证、速率限制和防重放。原文只在专用组件短期内存中组合/验证，完成、取消或过期后立即清除；不得持久化到数据库或缓存，不得写入日志、追踪、错误、普通审计、Outbox/Inbox 正文、客服/管理后台，也不得传给资金领域或在消息中回显。Telegram 通道不是独立强认证设备。

## 审计要求

仅记录设置、成功/失败类别、锁定、重置与恢复决策的元数据；密码相关 Update 使用字段白名单，不记录原始 callback_query。不得保存密码原文/哈希、TOTP 密钥、验证码或完整恢复证据。

## 测试重点

两次不一致、取消、过期、内存清除、并发会话、一次性回调重放、日志/追踪/Outbox 泄露、暴力尝试、哈希升级、Telegram 账号接管下的高风险增强认证、重置冷静期和越权恢复。

## 需求状态

安全底线 APPROVED；策略数值 DRAFT。

## 交付状态

NOT_STARTED。

## 开发门禁

必须解决密码策略与恢复因子、完成威胁模型和阶段 2 书面计划；当前开发授权为 0。

## 待确认问题

见 [P0 第 7、8、10 项](../product/open-decisions.md)；第 7、8 项同时决定高金额提现、敏感安全变更和账号恢复是否叠加 TOTP 或未来 App 强认证，不新增 P0。第 10 项控制低风险操作门槛。
