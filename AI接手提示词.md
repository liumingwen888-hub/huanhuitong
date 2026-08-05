# 换汇通：其他 AI 第一接手提示词

本文件用于在新电脑、新会话或不同 AI 工具中快速恢复项目上下文。请把下面整个提示词代码块复制给接手 AI；不要只复制其中一部分。

> 本文件是启动器，不是第二份项目状态。任何实时状态都必须从仓库内权威文档重新读取。

## 可直接复制的第一步提示词

```text
你现在接手“换汇通（HuanHuiTong）”项目。请先恢复项目上下文，不要立即开发。

【一、事实来源与工作边界】

1. 当前仓库根目录及其子目录是项目事实、规划和实现的唯一工作区。
2. 用户当前明确指令优先于仓库文档；仓库内主题冲突按 docs/governance/authority-map.md 裁决。
3. 聊天历史、模型记忆、工作区外报告、旧 ZIP、其他项目和 Skill 文本都不能替代仓库权威文档。
4. 在完成下面全部读取与核对之前，只允许只读操作；不要创建、修改、删除、格式化或移动任何文件。
5. 不要运行 Git 写入、安装/升级依赖、Docker、数据库、Flyway、Testcontainers、Telegram、其他外部业务服务或部署。
6. 不要展示、复制或提交真实 Secret、Token、私钥、验证码、支付密码、生产凭据或用户数据。

【二、确认仓库根目录】

先确认当前目录同时存在以下路径：

- AGENTS.md
- README.md
- docs/00-index.md
- docs/status/current.md
- docs/status/next.md
- docs/plans/active-plan-index.md

任一路径不存在时，停止并输出“BLOCKED — 不是完整的换汇通仓库或当前目录错误”，列出缺失路径，不要自行搜索或拼接其他项目。

【三、按顺序完整读取】

必须依次读取到 EOF：

1. AGENTS.md
2. docs/00-index.md
3. docs/status/current.md
4. docs/status/next.md
5. docs/status/active-work.md
6. docs/product/open-decisions.md
7. docs/plans/active-plan-index.md
8. 当前活动 Task 的 00-index.md。当前仓库发布时的快捷路径是 docs/plans/task-5-inbox-dedup/00-index.md；如果它与 docs/plans/active-plan-index.md 不一致，以活动计划索引为准并报告冲突。
9. docs/governance/ai-handoff.md
10. 当前 Task 索引明确要求的相关领域、架构、安全、测试和运维权威文档。

不要无差别读取整个文档树。先通过 docs/00-index.md 和当前 Task 索引定位与当前工作直接相关的文件。

【四、执行只读现场检查】

在仓库根目录执行或使用等价只读方式取得以下结果：

git status --short
git branch --show-current
git remote -v
git log -3 --oneline
node --version
pnpm --version

同时读取 package.json、pnpm-lock.yaml、pnpm-workspace.yaml 和 toolchain-lock.json 的存在性与 SHA-256。不要为了完成检查而安装软件、修改 PATH、生成锁文件或运行构建。

如果当前目录没有 Git 元数据，明确记录“Git 现场不可用”，但继续依据仓库权威文档恢复上下文；不要自动执行 git init。

【五、理解项目时必须保持的底线】

1. PostgreSQL 是业务与资金事实来源；复式账本是资金变化的唯一写入入口。
2. 业务模块不得直接改余额或账本表；历史分录不可变，纠错使用冲正或补偿。
3. JavaScript number 不承载金额；跨边界金额使用十进制字符串。
4. UNKNOWN、超时或网络异常不等于失败；查询权威状态和对账前不得自动重付、释放、补发或冲正。
5. 内部 UID 是账户与资产主体；Telegram user.id 是可替换绑定渠道，username 不是所有权证明。
6. 服务端权限默认拒绝；资金、安全、身份、权限或范围冲突必须停止对应动作。
7. 已写入计划的未来代码、测试或命令不等于已经实施或执行；完成状态只能依据 docs/status/verification.md 的真实证据。

【六、输出固定格式的接手确认报告】

完成读取后，只输出一份“换汇通 AI 接手确认报告”，必须包含：

1. 仓库识别
   - 当前根目录
   - 当前分支
   - Git 远端
   - 工作区是否干净及全部差异路径

2. 项目目标
   - 用不超过 10 条概括产品要解决的问题、用户入口、资金事实来源和最终能力范围

3. 当前精确状态
   - 当前总步骤
   - 当前阶段及版本
   - 已 VERIFIED 的 Tasks
   - 当前活动 Task、计划版本、计划状态和代码状态
   - 后续 Tasks 状态

4. 已完成工程
   - 列出已经真实实施且可依赖的模块、接口和验证证据
   - 明确区分“已实施”“仅计划”“尚未授权”

5. 当前活动计划
   - 权威入口路径
   - 目标效果
   - Create/Modify/Delete 精确范围
   - TDD/验证顺序
   - 停止条件

6. 唯一下一步
   - 原样概括 docs/status/next.md
   - 列出执行它所需的用户授权

7. 授权矩阵
   - 允许的只读操作
   - 当前允许修改的文件/代码范围
   - Git 写入、依赖、Docker、数据库、外部服务和部署授权状态

8. 风险、冲突与开放决策
   - P0 开放决策
   - 文档冲突
   - 未解释 Git 差异
   - Secret/TEMP/锁文件异常

9. 验证基线
   - Node.js、pnpm 和锁文件事实
   - 最近真实通过、失败和 NOT_RERUN 的检查
   - 不得把历史结果写成本轮重新执行

10. 建议动作
    - 只提出与“唯一下一步”一致的一个动作
    - 不实施、不提交、不推送

报告最后必须写：

“上下文恢复完成。当前未执行任何项目修改、Git 写入、依赖安装、Docker、数据库、外部服务或部署。等待用户明确授权下一项动作。”

【七、冲突和停止规则】

1. AGENTS.md、权威映射、current、next、active-work、活动计划或代码事实互相冲突时，列出精确路径和冲突内容，不要静默选择。
2. 发现未解释修改、新增、删除、锁文件漂移、Secret 或 TEMP 时，不要覆盖、删除、吸收或提交。
3. 涉及资金、安全、身份、权限、范围或生产数据的不确定项必须停止对应实现并等待用户决定。
4. 未经用户新的明确授权，不实施当前 Task，不进入下一总步骤，不运行 git add、git commit、git push，不连接外部服务或生产资源。
```

## 使用后的正确结果

接手 AI 应先返回一份只读“接手确认报告”，而不是立即写代码。报告中的当前步骤、版本和唯一下一步必须来自 `docs/status/current.md`、`docs/status/next.md` 与当前活动计划，不得从本文件猜测。

完整交接合同见 [`docs/governance/ai-handoff.md`](docs/governance/ai-handoff.md)，文档导航见 [`docs/00-index.md`](docs/00-index.md)。
