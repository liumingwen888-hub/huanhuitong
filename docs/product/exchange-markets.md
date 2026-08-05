# 换汇交易对目录

需求状态：交易对目录 APPROVED；报价、执行与结算参数 DRAFT。交付状态：DESIGNING。

交易对是产品期望，不等于平台已经托管全部资产、支持全部链上充提、自供流动性或确定真实上游。界面展示币种、账本币种、托管资产、充值网络、提现网络、报价来源、成交执行方和法币付款方必须分别配置与审查。

| 交易对 | 基础资产 | 报价资产 |
|---|---|---|
| USD/USDT | USD | USDT |
| ETH/USDT | ETH | USDT |
| ETH/TRX | ETH | TRX |
| CNY/USDT | CNY | USDT |
| VND/USDT | VND | USDT |
| THB/USDT | THB | USDT |
| TRX/USDT | TRX | USDT |
| TRX/ETH | TRX | ETH |
| USDT/CNY | USDT | CNY |
| USDT/USD | USDT | USD |
| USDT/VND | USDT | VND |
| USDT/THB | USDT | THB |
| USDT/TRX | USDT | TRX |
| USDT/ETH | USDT | ETH |

每个交易对在进入实现前必须形成版本化市场配置：允许方向、用户输入资产、预计所得资产、报价来源、报价有效期、手续费、汇率与费率精度、舍入规则、最小与最大金额、资金预留、成交与结算方、失败与超时、UNKNOWN、冲正和对账。金额不使用 JavaScript number。

界面 DRAFT 建议使用三列交易对按钮和一个返回按钮；不得复制其他品牌 Logo、美术资产或文案。具体模式由 [P0 开放决策](open-decisions.md) 第 4、5 项解除后确定，资金状态与记账边界见 [exchange 领域](../domains/exchange.md)。

