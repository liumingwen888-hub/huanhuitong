# 账本与余额领域

## 目标

以不可变复式账本提供所有资金变化的唯一写入口和可重建权威余额。

## 职责

管理经批准资产的账本账户开通、交易、分录、资金命令幂等、余额投影、冻结/在途用途、冲正、并发扣减与业务关联。

## 不负责什么

不决定用户身份、支付密码、风险政策、外部交易最终性或业务产品状态。

## 用户流程

资产目录批准后，应用编排可以调用账本公开接口为 UID 幂等开通该资产账户，或在用户首次使用资产时懒创建；策略由实施设计决定。用户看见已启用资产的余额和资金动作结果；业务领域提交已授权资金命令，账本在一个事务内验证资产、账户、余额、幂等和借贷平衡后过账，账单异步投影。

## 核心实体

LedgerAccount、LedgerTransaction、Posting、MoneyCommand、BalanceProjection、ReversalLink、BusinessReference。

## 状态机

MoneyCommand：RECEIVED、POSTED、REJECTED。LedgerTransaction：POSTED、REVERSED（通过新交易表达）。已 POSTED 分录不可修改。

## 输入

业务订单 ID、命令幂等键、账户腿、资产、最小单位金额、理由、授权和费用/成本快照。

## 输出

账本交易 ID、过账或拒绝结果、余额版本和 LedgerPosted/TransactionReversed 事件。

## 公开接口或事件

EnsureAssetAccount、PostBalancedTransaction、ReserveFunds、ReleaseFunds、ReverseTransaction、GetBalance；AssetAccountOpened、LedgerPosted、BalanceChanged、ReversalPosted。

## 依赖方向

依赖 identity 的主体和已批准的 asset-custody 资产定义；所有资金领域依赖它。账本不得依赖具体 Telegram、提现或供应商适配器。UidCreated 不能直接触发资金变化；账户开通由应用编排显式调用。

## 资金影响

这是唯一直接资金写入领域。任一交易必须资产内借贷平衡、防负余额、关联业务订单并分离用户负债、平台资产、收入和成本。

## 幂等要求

资产账户开通以 UID、资产和账户用途形成唯一键；重复 UidCreated、应用重试或并发懒创建返回同一账户。业务类型、订单、操作与代次构成唯一资金命令键；重复命令返回原结果。并发扣减使用数据库原子事务和可证明的锁/版本策略。

## 安全要求

拒绝未批准/未启用资产的账户开通、未授权账户、跨资产错配、精度溢出、零/负非法金额、直接表写入和全局 BigInt JSON 修改。交易对目录本身不能授权账户创建。

## 审计要求

不可变保存交易、分录、命令、调用领域、理由与冲正引用；敏感凭证不进入分录说明。

## 测试重点

批准/禁用资产账户开通、重复 UidCreated、并发懒创建、借贷平衡、并发扣减、防负余额、重复命令、冲正链、投影重建、金额边界、舍入和事务回滚。

## 需求状态

账本不变量与模板 APPROVED；账户科目细表在实施设计中 DRAFT。

## 交付状态

NOT_STARTED。

## 开发门禁

阶段 3 前必须批准账户开通策略（目录批准后编排或首次使用懒创建）、科目、记账模板、并发策略、迁移与属性测试计划；当前开发授权为 0。

## 待确认问题

资产目录受 [P0 第 1 至 4 项](../product/open-decisions.md) 约束；账本原则本身没有新增 P0。
