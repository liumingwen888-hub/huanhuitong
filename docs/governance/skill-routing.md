# Skill 路由

状态：APPROVED。交付状态：READY。

## 默认入口

每个正式项目任务先调用 using-superpowers，仅用于发现真正适用的 Skill；随后调用 project-governance，读取本项目规则、规范请求、评估风险、限定范围和建立真实验证。Skill 是过程工具，不是项目事实来源。

## 额外触发

| 任务信号 | 额外 Skill | 约束 |
|---|---|---|
| 新功能、行为变化、产品或架构设计 | brainstorming | 先确认设计；用户已明确批准的事实不得降级 |
| 已批准规格需要拆成代码任务 | writing-plans | 只写可执行计划，不直接实现 |
| 执行已批准书面计划 | executing-plans 或 subagent-driven-development | 按执行方式二选一；后者还需用户许可 |
| 新功能或缺陷修复需要改生产代码 | test-driven-development | 先建立失败证据，再作最小实现 |
| 已观察到缺陷、测试或构建失败、异常 | systematic-debugging | 先找根因，之后进入 TDD 修复 |
| 功能完成或准备合并 | requesting-code-review | 基于真实差异 |
| 收到真实审查意见 | receiving-code-review | 先核验证据，不盲从 |
| 声称完成、修复、通过或可发布 | verification-before-completion | 对最终状态执行最新验证 |
| 仓库或指定目录标准安全审计 | security-scan | 必须已有可审计代码 |
| PR、提交、分支或工作区差异安全审计 | security-diff-scan | 必须有明确 Git 差异 |
| 创建或更新持久威胁模型 | threat-model | 输出同步到 security |
| 修复已验证安全问题 | fix-finding | 同时遵循调试与 TDD 流程 |
| 功能完成且测试通过，要合并或清理分支 | finishing-a-development-branch | 需要 Git 与用户授权 |
| 创建或修改 Skill 本身 | skill-creator 与 writing-skills | 不用于项目专属规则 |
| 真实浏览器交互或本地 Web 端到端验证 | control-browser | 静态检查和官方资料查询不触发 |

## 禁止路由

不得为一个任务调用所有 Skill；规划阶段不得调用 TDD；没有缺陷不得调用系统调试；没有已批准书面计划不得执行计划；无代码不得安全扫描代码；无差异不得差异扫描；未经授权不得调用 implementer 或子代理。路由只从“任务 → 必要过程”单向选择，Skill 之间不互相递归触发，因此不存在循环。

