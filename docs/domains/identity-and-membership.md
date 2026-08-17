# 身份与会员领域

## 目标

以稳定内部 UID 表示用户与资产主体，并将 Telegram 和未来 App 作为可替换绑定渠道。

## 职责

创建 UID、会员关系、Telegram 绑定、最小用户资料和注册幂等记录；解析渠道绑定；维护展示资料快照；处理绑定生命周期和 UID 冲突人工案件；发布不带资金效果的 UidCreated。

## 不负责什么

不验证支付密码，不恢复账号，不合并余额，不持有账本分录，也不让 username 或手机号证明资产所有权。不得创建具体币种账本账户、链上地址、钱包、充值/提现网络或换汇市场。

## 用户流程

/start 或领取深链进入后按 Telegram user.id 查绑定；命中则进入原 UID，未命中则在幂等身份事务中创建 UID、会员、绑定、最小资料和注册记录。账号更换、丢失恢复、App 绑定与 UID 冲突分别进入独立受控流程。注册完成不等待任何资产账户存在。

## 核心实体

User、Membership、ChannelBinding、IdentityProfile、RegistrationIdempotencyRecord、BindingChangeCase、UidConflictCase。

## 状态机

User：ACTIVE、RESTRICTED、SUSPENDED、CLOSED。Binding：PENDING、ACTIVE、REVOKED、CONFLICTED。禁止 CONFLICTED 自动转为 ACTIVE。

## 输入

经过 Telegram 验真的 user.id、资料快照、start 上下文；未来 App 的已验证绑定授权；管理员受控案件决定。

## 输出

内部 UID、会员状态、绑定结果、身份受限原因和不带资金效果的 UidCreated 等领域事件。

## 公开接口或事件

ResolveOrCreateUid、ResolveBinding、RequestBindingChange、OpenUidConflictCase；UidCreated、BindingActivated、BindingRevoked、IdentityRestricted。UidCreated 只表示身份建立，不承诺资产账户存在。

## 依赖方向

可依赖平台事务、审计和唯一约束；被所有用户领域依赖。不依赖 Telegram UI 细节、资产目录或账本内部表；也不直接调用账本创建账户。

## 资金影响

不直接记账；UidCreated 事件本身不能改变资金。UID 可以成为未来账本账户所有者，但注册成功不要求任何具体资产账户已存在；任何绑定变更不得转移或合并资金。

## 幂等要求

以渠道类型和稳定外部 user.id 唯一；同一 Update、/start 和并发请求返回同一 UID。创建 UID、会员、最小资料、注册记录和绑定必须原子或可补偿。重复 UidCreated 不得被下游解释为重复资产账户或资金命令。

## 安全要求

服务端验证渠道身份；禁止手机号单因子接管；资料变更不提升权限；冲突默认冻结高风险绑定动作。

## 审计要求

记录绑定来源、操作者、原因、前后状态和关联案件；不记录 Token、验证码或完整敏感证据。

## 测试重点

并发首次注册、重复 Update、已有绑定、撤销绑定、冲突 UID、资料变更和跨渠道一致性。

## 需求状态

核心 UID 与自动注册规则 APPROVED；恢复因素 DRAFT。

## 交付状态

NOT_STARTED。

## 开发门禁

先确认唯一约束、身份事务边界、UidCreated 合同、恢复接口与阶段 1 书面计划；必须证明身份模块不创建资产账户。当前开发授权为 0。

阶段 1 v1.2 计划约束（未实现）：自动注册 key 只由服务端从已验证的 `telegram` 主体、固定 `start` 事件和版本命名空间派生；调用者不能指定任意 key。注册记录的 PROCESSING、COMPLETED、FAILED、CONFLICT 状态以明确 NULL/非 NULL 数据库约束失败关闭。绑定冲突不得自动合并 UID；UidCreated 继续没有资金效果。

## 待确认问题

账号恢复因素由 [P0 第 8 项](../product/open-decisions.md) 决定；不得用临时默认值实现资金账户接管。

## 阶段 1 实施事实（2026-08-17）

已实施：Uid 品牌 string、ChannelType、ResolveOrCreateUid 三分支编排（绑定命中/幂等 acquired/PROCESSING 零写入退出）、registrationKey 服务端 SHA-1 UUIDv5 派生（命令对象无注入面）、五件套同事务创建、双有效绑定被部分唯一索引拒绝（真并发验收恰一 UID）。username 仅快照；UidCreatedV1 无资金效果（23 项验收之 18 实证零资金对象）。
