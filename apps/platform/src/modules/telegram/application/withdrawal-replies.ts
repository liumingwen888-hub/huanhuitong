export const WITHDRAWAL_REPLIES = Object.freeze({
  withdrawPrompt: '请输入支付密码以确认提现。',
  withdrawAcceptedAuto: '提现已受理并自动批准，正在处理。',
  withdrawAcceptedPendingApproval: '提现已受理，等待人工审批。',
  withdrawDuplicate: '该提现单已提交，请勿重复操作。',
  withdrawDeniedUnavailable: '当前不支持该资产提现。',
  withdrawDeniedTooLarge: '提现金额超过上限。',
  withdrawDeniedInsufficient: '可用余额不足。',
  withdrawDeniedRisk: '提现请求被风控拒绝。',
  withdrawDeniedInvalid: '提现命令无效，请检查格式。',
  withdrawNotBound: '请先完成注册绑定后再使用提现。',
  withdrawStatusUnknown: '未找到该提现单。',
  withdrawStatusFrozen: '提现单已冻结资金，等待路由。',
  withdrawStatusPendingApproval: '提现单等待人工审批。',
  withdrawStatusApproved: '提现单已批准，等待签名。',
  withdrawStatusSigning: '提现单签名处理中。',
  withdrawStatusBroadcast: '提现单已广播，等待链上确认。',
  withdrawStatusConfirmed: '提现已完成。',
  withdrawStatusRejected: '提现已被拒绝，等待退款。',
  withdrawStatusFailed: '提现失败，等待退款。',
  withdrawStatusExpired: '提现已过期，等待退款。',
  withdrawStatusRefunded: '提现已退款，资金已回到可用余额。',
  withdrawNotifyRequested: '您有一笔新的提现申请已受理。',
  withdrawNotifyApproved: '您的提现已批准。',
  withdrawNotifyRejected: '您的提现已被拒绝。',
  withdrawNotifyBroadcast: '您的提现已提交到链上网络。',
  withdrawNotifySucceeded: '您的提现已完成，请查收。',
  withdrawNotifyFailed: '您的提现失败，将进入退款流程。',
  withdrawNotifyRefunded: '您的提现已退款，资金已回到可用余额。',
  internalError: '暂时无法处理，请稍后再试。'
});

export type WithdrawalReply = keyof typeof WITHDRAWAL_REPLIES;

export function withdrawalReplyText(reply: WithdrawalReply): string {
  return WITHDRAWAL_REPLIES[reply];
}

Object.freeze(withdrawalReplyText.prototype);
