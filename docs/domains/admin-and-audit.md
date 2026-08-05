# 管理后台与审计领域

## 目标

让运营角色以最小权限、双人控制和追加审计处理配置、审批、案件与止损。

## 职责

独立管理员身份、RBAC、数据范围、字段权限、Maker-Checker、高风险重新认证、临时授权、Break-Glass、配置版本和审计查询。

## 不负责什么

不直接改余额或账本表，不访问私钥，不让发起人审批自己，不允许客服绕过恢复，不保存密码或完整敏感信息。

## 用户流程

管理员登录并获得最小角色；高风险操作重新认证后发起，独立审批人检查证据并批准/拒绝。Break-Glass 只做限时止损，事后强制复核。审计员只读检索授权范围内记录。

## 核心实体

Administrator、Role、Permission、DataScope、FieldPolicy、ApprovalRequest、TemporaryGrant、BreakGlassSession、ConfigVersion、AuditRecord。

## 状态机

Approval：DRAFT、SUBMITTED、APPROVED、REJECTED、EXPIRED、EXECUTED、FAILED。Grant：PENDING、ACTIVE、EXPIRED、REVOKED。发起人与审批人必须不同。

## 输入

管理员身份、会话、操作命令、原因、证据引用、审批决定和配置差异。

## 输出

授权决定、受控领域命令、审批结果、版本化配置和追加审计事件。

## 公开接口或事件

AuthorizeAdminAction、SubmitApproval、DecideApproval、ActivateBreakGlass、PublishConfig；ApprovalGranted、ConfigPublished、BreakGlassActivated。

## 依赖方向

依赖独立管理员身份、安全、审计存储和领域公开管理命令；admin-web 依赖本领域 API。本领域不得直接访问账本内部。

## 资金影响

审批可授权后续资金命令，但自身不记账。任何纠正通过原领域或账本补偿接口并关联审批。

## 幂等要求

审批执行键唯一；重复批准不重复执行；临时授权和 Break-Glass 有明确到期与撤销。

## 安全要求

默认拒绝、MFA/重新认证、职责分离、字段脱敏、会话固定防护、最小权限、配置签名/版本和不可删除审计。

## 审计要求

记录谁、何时、为何、授权依据、前后摘要、审批链和执行结果；密码、验证码、密钥和完整敏感数据禁止进入。

## 测试重点

越权、跨数据范围、自审、重复执行、授权过期、Break-Glass、字段脱敏和审计不可变。

## 需求状态

控制模型 APPROVED；具体角色矩阵 DRAFT。

## 交付状态

NOT_STARTED。

## 开发门禁

第一个资金功能开始前，必须具备管理操作服务端默认拒绝、最小授权合同、追加式审计和配置版本。提现开始前，必须具备独立管理员身份、Maker-Checker、高风险重新认证、Signer 策略审批和可核验审计证据。阶段 9 再补齐完整角色矩阵、管理 UI、配置发布、Break-Glass 和审计查询/保留策略。当前开发授权为 0。

## 待确认问题

法律主体和运营国家会影响数据范围，见 [P0 第 9 项](../product/open-decisions.md)；没有新增 P0。
