# 换汇通项目协作规则

## 项目与工作区

本项目名称为“换汇通”。当前项目根目录及其子目录是项目事实、规划和未来实现的唯一工作区。除已安装 Skill 自身文件和任务明确要求核验的官方公开资料外，不读取、搜索、导入或引用工作区外的其他项目。聊天内容只用于理解当前请求；只有写入本项目权威文档的内容才能成为后续会话的项目事实。

## 权威来源与冲突处理

用户当前明确指令优先于项目文档；适用的更深层 AGENTS.override.md 或 AGENTS.md 优先于上层规则。项目内主题权威归属由 [权威映射](docs/governance/authority-map.md) 确定，[文档索引](docs/00-index.md) 是唯一导航入口。Skill 提供过程方法，不是项目记忆。

发现冲突时不得静默选择。先按权威映射判断；仍无法判断时记录到 [开放决策](docs/product/open-decisions.md)。涉及资金、安全、身份、权限或范围的冲突必须停止对应实现，等待授权。

## 上下文恢复顺序

新会话依次读取：

1. AGENTS.md
2. [docs/00-index.md](docs/00-index.md)
3. [docs/status/current.md](docs/status/current.md)
4. [docs/status/next.md](docs/status/next.md)
5. [docs/status/active-work.md](docs/status/active-work.md)
6. [docs/product/open-decisions.md](docs/product/open-decisions.md)
7. [docs/plans/active-plan-index.md](docs/plans/active-plan-index.md)
8. 当前阶段实施计划
9. 相关领域、架构、安全和测试权威文档
10. Git 启用后的 git status 与 git diff

只读取与当前任务直接相关的领域、架构和计划文件，不把整个文档树无差别载入上下文。

## 状态体系

需求状态仅使用 APPROVED、DRAFT、LATER、REPLACED。交付状态仅使用 NOT_STARTED、DESIGNING、READY、BUILDING、BLOCKED、VERIFIED、RELEASED。两套状态含义及转换以 [状态模型](docs/governance/state-model.md) 为准；需求状态不得代替交付状态。

## Skill 最小路由

正式项目任务默认先使用 using-superpowers 发现真正适用的 Skill，再使用 project-governance 恢复规则、规范范围和验证事实。只按任务触发额外 Skill：设计用 brainstorming，已批准规格拆解用 writing-plans，代码变更用相应实现与验证 Skill。禁止为“保险”调用全部 Skill；完整规则见 [Skill 路由](docs/governance/skill-routing.md)。

默认不使用子代理。只有用户明确允许，或已批准计划明确要求且子任务独立、不改同一文件、不共享未完成状态时才可使用；主 Codex 必须重新核验结果。角色边界见 [代理路由](docs/governance/agent-routing.md)。

## 文档同步合同

任何功能、缺陷修复、迁移或架构修改不得只改代码。开始前更新 active-work 和对应计划；完成前按实际影响同步领域、架构、current、next、verification、progress-log、open-decisions、安全和测试文档。每个主题只保留一个完整权威来源，其他文档只作摘要并链接。完整合同见 [文档合同](docs/governance/documentation-contract.md)。

换汇通项目内部权威文档保存在项目根目录中。所有导出的 ZIP、审查报告、验证报告、交接包及其他项目外生成物，统一输出到 `C:\Users\Administrator\Desktop\Codex`。不得散落到桌面根目录、Documents 根目录或其他项目目录。

大型计划从创建时按职责拆分并提供 `00-index.md`；普通计划目标不超过 60KB/1,500 行，任何计划 Markdown 超过 100000 字节或 2,500 行即必须继续拆分。巨型代码正文只保留一份 canonical fragment，其他位置通过相对链接与 SHA-256 引用；完整规则见 [文档合同](docs/governance/documentation-contract.md#大型计划文档治理)。

## 资金与账本底线

PostgreSQL 是业务和资金事实来源；复式账本是所有资金变化的唯一写入入口。业务模块不得直接修改余额或账本表。资金命令必须原子、借贷平衡、幂等、可审计并防并发负余额；历史分录不可变，纠错使用冲正或补偿分录。JavaScript number 禁止承载金额；跨边界金额使用十进制字符串。

UNKNOWN、超时或网络异常不得被推断为失败后自动重付。任何释放、重试、补发或冲正必须先查询权威状态并对账。

## 身份、安全与敏感信息底线

内部 UID 是账户与资产主体；Telegram user.id 是可替换的绑定渠道，username 不是资产所有权证明。禁止自动合并两个有资金 UID，禁止客服直接改绑定、余额或账本。

权限服务端默认拒绝；管理后台使用独立管理员身份、RBAC、数据范围、字段权限、Maker-Checker、重新认证和追加式审计。发起人不得审批自己。

私钥、Bot Token、验证码和恢复凭证不得进入普通业务进程、明文数据库字段、日志、普通审计或文档。支付密码原文只允许在用户输入时短暂存在于 Telegram 客户端、以输入动作经过 Bot 通道，并在专用凭证处理组件的短期内存中组合和验证；随后立即清除。原文不得持久保存、写入数据库或缓存、日志、追踪、错误信息、普通审计、Outbox/Inbox 正文，也不得传给资金、账本、提现、换汇、代付、客服或管理后台。持久层只保存版本化安全哈希；资金领域只接收短期支付授权证明或引用，不接收密码原文或哈希。

Telegram Bot 不是端到端加密的独立安全设备。支付密码在 Telegram 内输入是知识因子，但不能单独覆盖高风险提现、敏感安全变更或账号恢复；增强认证规则由现有 P0 决策确定。任何凭证不得在消息中回显。

## 开发与外部写入门禁

当前业务代码开发授权和生产部署授权以 [当前状态](docs/status/current.md) 为准。授权为 0 时，不得创建业务代码、工程骨架、迁移、依赖、部署配置或外部服务连接。

Git 初始化、建分支、提交、推送、PR、发布、生产变更以及向外部系统写入均需要用户明确授权。只读检查不扩大写入授权。不得用规划完成推定实现获批。

## 验证与完成声明

完成声明必须基于最终文件或代码的最新真实检查。报告应区分已执行并通过、已执行并失败、未执行、静态检查和推断。缺少必要测试、安全检查、文档同步、索引验证、范围核对或真实目标路径验证时，不得标记 VERIFIED。不得省略失败结果、伪造命令或结果。
