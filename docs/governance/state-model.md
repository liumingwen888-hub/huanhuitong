# 状态模型

状态：APPROVED。交付状态：READY。

## 需求状态

- APPROVED：用户已明确确认，后续修改需要新的明确决定。
- DRAFT：安全、产品或工程建议，尚未获得确认，不得当作上线承诺。
- LATER：明确不属于当前阶段，只记录边界，不创建实现。
- REPLACED：被新决定替代，必须链接替代来源并停止继续引用旧规则。

需求状态描述“规则是否被确认”，不描述代码是否完成。

## 交付状态

- NOT_STARTED：尚无交付工作。
- DESIGNING：正在形成或等待确认设计。
- READY：前置决定与计划齐备，可在获得授权后开始。
- BUILDING：已获授权并正在制作。
- BLOCKED：存在无法安全绕过的阻塞。
- VERIFIED：范围内交付物已通过最新真实验证并同步文档。
- RELEASED：已通过发布门禁并完成授权发布。

推荐转换为 NOT_STARTED → DESIGNING → READY → BUILDING → VERIFIED → RELEASED。BLOCKED 可以从任意未完成状态进入，解除后回到原阶段。不得因为文档写完就把尚未实现的功能标记 VERIFIED。

## 当前解释

阶段 0 已由用户验收并整体 VERIFIED。第 8/48 步与 Task 4 实施结果已经 `COMPLETED / IMPLEMENTED / VERIFIED / EXTERNAL REVIEW PASS`；阶段 1 总计划 READY v1.2.6 与代码 BUILDING 是独立事实，Tasks 1–4 均 VERIFIED。历史第 5/6/7 步、Task 4 v1.0～v1.10 计划复审及第 8 步过滤器 BLOCKED 记录仍按当时事实保留。第 9/48 步当前为 WAITING_EXTERNAL_REVIEW；Task 5 v1.2 外部复审未通过并由 v1.3 candidate 取代；T5R-01/02/04/05/06/07 ACCEPT / CLOSED，T5R-03/08 RESOLVED_IN_PLAN / WAITING_EXTERNAL_REVIEW；详细计划 READY v1.3 / WAITING_EXTERNAL_REVIEW，而 Task 5 代码仍为 NOT_STARTED，说明“计划可实施”不等于“实现已开始”。第 10/48 步与 Tasks 6～14 NOT_STARTED。权威当前值见 [current.md](../status/current.md)。
