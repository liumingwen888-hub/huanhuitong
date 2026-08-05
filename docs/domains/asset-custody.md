# 资产托管领域

## 目标

明确平台支持的资产、网络、地址、托管能力与链上资金控制边界。

## 职责

维护版本化资产与网络目录、精度、充提能力、地址策略、确认策略、钱包分类、归集和链上交易意图。

## 不负责什么

不提供用户余额，不决定换汇市场，不执行法币代付，不把产品展示币种自动视为托管资产。

## 用户流程

用户选择资产与明确网络后取得已批准地址信息；提现时使用同一目录校验目标。运营可通过受控配置停用新充提，但不能改写在途资金事实。

## 核心实体

Asset、Network、CustodyCapability、Wallet、AddressAssignment、ConfirmationPolicy、CollectionIntent、ChainTransactionReference。

## 状态机

Capability：DRAFT、ENABLED、DEPOSIT_PAUSED、WITHDRAWAL_PAUSED、DISABLED。Wallet：ACTIVE、QUARANTINED、RETIRED。状态变更版本化且只影响定义后的新动作。

## 输入

已批准链与资产决定、节点观察、钱包策略、地址分配请求和运维止损指令。

## 输出

资产/网络能力快照、地址、确认要求、签名意图元数据和托管事件。

## 公开接口或事件

GetAssetCapability、AssignDepositAddress、ValidateWithdrawalAddress、CreateCollectionIntent；CapabilityChanged、AddressAssigned、WalletQuarantined。

## 依赖方向

依赖安全配置、隔离 signer 合同和平台任务；deposits、withdrawals、exchange 和 reconciliation 依赖其公开快照。

## 资金影响

定义链上托管资产和网络，但所有用户资金变化仍由账本过账。归集不得造成第二次用户入账。

## 幂等要求

地址分配按 UID、资产、网络和策略版本幂等；链上交易用网络级稳定标识去重；归集意图和签名请求不可重复消费。

## 安全要求

私钥永不进入普通业务进程、数据库明文或日志；钱包最小权限、地址校验、网络隔离、签名审批与密钥轮换为门禁。

## 审计要求

记录能力版本、地址归属、签名意图摘要、钱包状态和运维动作；敏感密钥材料不得审计。

## 测试重点

错误网络、精度、重复地址请求、节点分歧、重组、钱包隔离、签名重放和能力暂停竞态。

## 需求状态

托管边界原则 APPROVED；具体链、资产和网络 DRAFT。

## 交付状态

NOT_STARTED。

## 开发门禁

必须先解决托管、充值和提现资产范围并完成每条链的威胁模型；当前开发授权为 0。

## 待确认问题

见 [P0 第 1 至 4 项](../product/open-decisions.md)，未解决前不得创建真实钱包或链配置。

