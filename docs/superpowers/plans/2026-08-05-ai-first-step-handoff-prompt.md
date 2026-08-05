# AI 第一接手提示词实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. 项目 `AGENTS.md` 默认禁止子代理，因此本计划只允许当前会话内顺序执行。步骤使用 checkbox（`- [ ]`）跟踪。

**Goal:** 在仓库根目录建立中文、可复制、可验证的一键 AI 接手提示词，并通过所有权威入口导航到它后发布到私有 GitHub `main`。

**Architecture:** `AI接手提示词.md` 只保存启动协议，不复制易变项目状态；它强制接手 AI 从现有权威文档读取实时事实并输出标准接手报告。README、Copilot 指令、文档总索引和完整 AI 交接协议提供四个发现入口，状态文档记录本轮真实变更与验证。

**Tech Stack:** Markdown、Git、PowerShell、Python 3、GitHub HTTPS remote。

## Global Constraints

- 只创建或修改本计划列出的 Markdown，不修改 TypeScript、测试、SQL、JSON、YAML、TOML、依赖或锁文件。
- `AI接手提示词.md` 使用中文，包含一个可直接复制的连续提示词代码块。
- 所有现有路径必须在 GitHub `origin/main` 实际存在；`AI接手提示词.md` 是唯一计划新增的根入口。
- 提示词不硬编码易变步骤状态；实时事实来自 `docs/status/current.md` 和 `docs/status/next.md`。
- GitHub 仓库保持 `PRIVATE`，分支保持 `main`。
- 完成前证明 UTF-8、BOM、Markdown fence、相对链接、Secret、TEMP、锁文件、源/镜像一致性和远端一致性。

---

### Task 1: 创建根目录一键接手提示词

**Files:**
- Create: `AI接手提示词.md`
- Modify: `docs/superpowers/specs/2026-08-05-ai-first-step-handoff-prompt-design.md`

**Interfaces:**
- Consumes: `AGENTS.md` 的读取顺序与授权规则、`docs/governance/ai-handoff.md` 的完整交接合同。
- Produces: 任意 AI 可复制的第一步提示词，以及固定格式“接手确认报告”。

- [x] **Step 1: 将设计规格状态改为 APPROVED**

将规格首部更新为用户已复核通过，不改变其技术范围。

- [x] **Step 2: 创建 `AI接手提示词.md`**

文件必须包含：用途、使用方法、连续中文提示词、精确读取路径、Git 只读核对、标准报告格式、冲突停止条件和未授权禁止项。

- [x] **Step 3: 静态检查提示词合同**

运行 PowerShell/Python 检查以下字面要求全部存在：九个读取入口、“接手确认报告”、“唯一下一步”、“未经用户明确授权”、`git status --short`、`git remote -v`。

### Task 2: 建立四个发现入口

**Files:**
- Modify: `README.md`
- Modify: `.github/copilot-instructions.md`
- Modify: `docs/00-index.md`
- Modify: `docs/governance/ai-handoff.md`

**Interfaces:**
- Consumes: Task 1 的 `AI接手提示词.md`。
- Produces: GitHub 首页、GitHub AI、文档导航和完整交接协议到根提示词的可点击链接。

- [x] **Step 1: 更新 README**

在项目介绍后增加醒目的“其他 AI 一键接手”段落，链接到 `AI接手提示词.md`，不复制完整提示词。

- [x] **Step 2: 更新 Copilot 指令**

要求仓库型 AI 首先读取 `AI接手提示词.md`，随后仍以 `AGENTS.md` 和权威文档为事实来源。

- [x] **Step 3: 更新文档总索引和完整交接协议**

在 `docs/00-index.md` 根规则中登记根提示词，并登记本设计与实施计划；在 `docs/governance/ai-handoff.md` 前部增加便捷启动入口。

### Task 3: 同步治理状态和验证记录

**Files:**
- Modify: `docs/status/active-work.md`
- Modify: `docs/status/progress-log.md`
- Modify: `docs/status/verification.md`

**Interfaces:**
- Consumes: Tasks 1–2 的精确文件范围。
- Produces: 可审计的本轮范围、结果、未运行项和发布证据。

- [x] **Step 1: 登记活动工作和进展**

记录用户批准方案 A、GitHub 路径复核、创建/修改数量、未触碰工程文件和项目状态不变。

- [x] **Step 2: 登记验证**

记录最终静态检查、锁文件哈希、源/镜像一致性、Git 提交和远端回读；在执行前未知的提交 SHA 只在真实产生后写入，不预填占位符。

### Task 4: 验证并同步独立上传目录

**Files:**
- Verify: all project files under `C:\Users\Administrator\Documents\换汇通`
- Synchronize: planned Markdown files to `C:\Users\Administrator\Desktop\Codex\huanhuitong`

**Interfaces:**
- Consumes: Tasks 1–3 的最终文件。
- Produces: 源项目与独立 Git 仓库逐字节一致的项目树。

- [x] **Step 1: 执行静态门禁**

验证严格 UTF-8、BOM 0、fence 失衡 0、相对链接断链/越界 0、强特征 Secret 0、TEMP 0、提示词合同字段齐全。

- [x] **Step 2: 验证锁文件未变**

核对 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`toolchain-lock.json` 的 SHA-256 与发布基线一致。

- [x] **Step 3: 精确同步并比较**

只复制本计划 Create/Modify 文件到独立目录；排除 `.git` 后比较相对路径、字节数和 SHA-256，要求 missing/extra/changed 均为 0。

### Task 5: 提交、推送和远端回读

**Files:**
- Commit: only the Markdown files listed by Tasks 1–3 plus this implementation plan and its approved design spec.

**Interfaces:**
- Consumes: Task 4 的通过证据。
- Produces: 私有 GitHub `main` 上可见的一键接手入口。

- [x] **Step 1: 核对并暂存精确范围**

运行 `git status --short`、`git diff --name-only` 和 staged path 白名单检查；白名单外路径为 0。

- [ ] **Step 2: 提交并推送**

使用提交信息 `docs: add one-step AI handoff prompt`，推送 `origin main`。

- [ ] **Step 3: 从远端回读**

运行 `git fetch --prune origin main`，证明本地 SHA 等于 `origin/main`、远端树文件数等于本地树、diff 0、worktree clean，并从 `origin/main:AI接手提示词.md` 回读关键标题和提示词字段。

- [ ] **Step 4: 停止**

报告 GitHub URL、最终 SHA、文件数量、提示词路径和验证结果；不实施 Task 5，不进入第 10/48 步。
