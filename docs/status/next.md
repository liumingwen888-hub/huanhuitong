# 下一步

阶段 6 进行中（阶段 1–5 已 VERIFIED，S6-1～S6-5 已实施 VERIFIED，2026-08-19）。

下一步：**S6-6 提现完成/失败结算**详细计划——成功：CONFIRMED → withdrawalSucceeded 模板结算（DR 冻结/CR 托管 + 费用行）→ markConfirmed（结算过账关联）；失败/拒绝/过期：REFUNDED 释放路径（withdrawalFailed 模板）→ markRefunded；含过期扫描与费用可扣性处理。等待用户"继续下一步工作"启动。
