# AI 第一接手提示词设计

需求状态：APPROVED。设计方向与书面规格均已由用户复核通过。日期：2026-08-05。

## 1. 目标

在仓库根目录提供一份中文、可直接复制给任意 AI 的第一步提示词，使新电脑、新会话或不同 AI 在不依赖聊天历史的前提下，能够稳定恢复换汇通项目的权威上下文、确认当前断点，并在获得明确授权前停止在正确边界。

## 2. 选定方案

采用根目录独立入口方案，创建 `AI接手提示词.md`。根目录入口比只放入 README 或隐藏在治理目录更容易被 Codex、Claude、Cursor、GitHub Copilot 和其他仓库型 AI 发现；完整事实仍留在既有权威文档中，提示词只负责规定读取、核对和报告流程，避免复制后产生第二份项目事实。

## 3. 文件范围

### 新建

- `AI接手提示词.md`：中文一键接手提示词及使用说明。

### 修改

- `README.md`：在前部增加“其他 AI 一键接手”入口。
- `.github/copilot-instructions.md`：要求 GitHub AI 优先读取根目录入口，但不改变 `AGENTS.md` 的最高仓库规则地位。
- `docs/00-index.md`：在根规则中登记新入口。
- `docs/governance/ai-handoff.md`：将新入口定义为便捷启动器，将本文件继续定义为完整交接协议。
- `docs/status/active-work.md`：登记本轮交接增强的范围与状态。
- `docs/status/progress-log.md`：记录新增入口、索引同步和 GitHub 发布结果。
- `docs/status/verification.md`：记录最终静态检查、文件范围和远端回读证据。

不修改 TypeScript、测试、SQL、JSON、YAML、TOML、依赖、锁文件或当前 Task 5 技术计划。

## 4. 提示词合同

`AI接手提示词.md` 必须包含一个完整、连续、可复制的中文代码块。该提示词要求接手 AI：

1. 将仓库内权威文档视为项目事实，不以聊天记忆、模型常识或工作区外文件覆盖它们。
2. 按 GitHub `main` 已核验存在的以下精确路径顺序读取，不使用任何脱离目录的文件名简称：
   1. `AGENTS.md`
   2. `docs/00-index.md`
   3. `docs/status/current.md`
   4. `docs/status/next.md`
   5. `docs/status/active-work.md`
   6. `docs/product/open-decisions.md`
   7. `docs/plans/active-plan-index.md`
   8. 当前活动计划索引；本设计时的准确路径为 `docs/plans/task-5-inbox-dedup/00-index.md`
   9. `docs/governance/ai-handoff.md`
3. 只读取当前任务直接相关的架构、领域、安全和测试文档，不无差别载入整个文档树。
4. 检查 Git 当前分支、远端、工作区状态和最近提交；检查锁定 Node.js、pnpm 与锁文件事实，但不自动安装、修改或运行受限外部资源。
5. 输出固定格式的“接手确认报告”，至少包含项目目标、当前步骤、已完成 Tasks、活动 Task/版本/代码状态、唯一下一步、允许与禁止范围、阻断/P0 决策、验证基线和发现的冲突。
6. 发现权威状态冲突、Secret、未解释差异或资金/安全/权限冲突时停止对应动作并明确报告，不自行吸收或覆盖。
7. 在用户给出下一条明确授权前，不创建或修改工程文件，不进入下一步骤，不运行 Git 写入、外部服务、共享/生产数据库或部署。

提示词不硬编码第 9/48 步等易变事实；它要求从 `docs/status/current.md` 和 `docs/status/next.md` 读取实时状态。当前 Task 的快捷路径必须与 `docs/plans/active-plan-index.md` 同步更新；若两者冲突，以活动计划索引为准并停止执行，不能猜测。

## 5. 发现与导航

- GitHub 仓库首页从 README 可直接进入 `AI接手提示词.md`。
- 仓库级 AI 从 `.github/copilot-instructions.md` 被引导至该入口。
- 文档浏览者从 `docs/00-index.md` 和 `docs/governance/ai-handoff.md` 可定位该入口。
- `AI接手提示词.md` 反向链接到所有权威入口，形成双向导航。

## 6. 失败处理

- 任一链接断裂、围栏失衡、UTF-8 解码失败、强特征 Secret 命中或白名单外文件变化时停止发布。
- 源项目与独立上传目录不一致时停止提交，不以任一侧静默覆盖另一侧。
- 推送后本地与 `origin/main` SHA、文件树或差异不一致时，不声明上传完成。
- GitHub 插件对私有仓库的读取权限与 Git 远端上传权限分别报告；插件 404 不得被误写成 Git 推送失败。

## 7. 验证与完成条件

完成前必须证明：

1. 新提示词可从 README、总索引、Copilot 指令和 AI 交接协议定位。
2. 提示词包含完整读取顺序、固定接手报告、停止条件和授权边界。
3. 全部项目文件严格 UTF-8，Markdown fence 平衡，相对链接无断链和越界。
4. 强特征 Secret 与 TEMP 残留为 0。
5. package/lock/toolchain 文件未改变。
6. 源项目与独立上传目录的项目文件逐字节一致。
7. Git 提交范围只包含本设计规定的 Markdown 文档。
8. 推送后 `HEAD` 与 `origin/main` 相同、远端树与本地树相同、工作区干净。

## 8. 非目标

- 不实施或修订 Task 5 技术方案。
- 不创建未来业务代码、测试、迁移、依赖或部署配置。
- 不把所有未来 Tasks 提前展开为施工级计划。
- 不授权其他 AI 自动提交、推送、部署或连接外部服务。
