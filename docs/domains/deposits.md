# 充值领域

## 目标

把可证明的链上入金安全、幂等地转换为用户账本资金，并处理确认、重组、归集与异常。

## 职责

地址分配编排、链上观察、交易去重、确认水位、入账、重组补偿、归集意图、错误网络/资产案件和通知。

## 不负责什么

不保存私钥，不自行定义资产网络，不直接改余额，不把未确认观察当最终资金。

## 用户流程

用户选择受支持资产与网络获取地址；平台观察交易并显示确认进度，达到策略后过账并通知。错误网络或资产进入人工案件，不能自动映射。

## 核心实体

DepositIntent、DepositAddressRef、ChainObservation、DepositCredit、ReorgCase、CollectionRequest、DepositExceptionCase。

## 状态机

DETECTED、CONFIRMING、CREDITED、REORG_PENDING、REVERSED、EXCEPTION。重复观察不重复入账；REORG_PENDING 只由链策略与对账推进。

## 输入

UID、资产/网络能力、地址引用、链上交易稳定标识、区块高度、确认数和重组事件。

## 输出

充值状态、账本资金命令、归集任务、账单与通知事件。

## 公开接口或事件

RequestDepositAddress、IngestChainObservation、EvaluateConfirmations、HandleReorg；DepositDetected、DepositCredited、DepositReorged。

## 依赖方向

依赖 identity、asset-custody、ledger、platform-operations；被账单、对账和 Telegram 展示依赖。

## 资金影响

确认后通过账本模板入账；重组使用补偿/冲正，不能删除原分录。归集只移动平台托管资产，不重复用户负债。

## 幂等要求

链、网络、交易哈希、输出索引/日志索引唯一；入账命令与观察唯一关联；扫描重跑和节点重复返回安全。

## 安全要求

地址与网络强绑定；节点输入不可信；异常大额、错误资产、重组和来源风险进入策略；私钥隔离。

## 审计要求

保存观察来源、区块、确认策略版本、入账命令、重组与人工案件决策，不保存密钥。

## 测试重点

重复扫描、乱序区块、确认边界、重组、错误网络、并发入账、归集失败和通知重试。

## 需求状态

流程 APPROVED；真实链、资产、确认水位 DRAFT。

## 交付状态

NOT_STARTED。

## 开发门禁

解决支持链/资产/网络并完成节点、重组、地址和对账设计后才能进入阶段 4；当前授权为 0。

## 待确认问题

见 [P0 第 1、2、4、10 项](../product/open-decisions.md)。

