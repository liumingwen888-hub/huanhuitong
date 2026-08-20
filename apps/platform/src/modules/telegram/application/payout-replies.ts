export const PAYOUT_REPLIES = Object.freeze({
  payoutPrompt: '请输入支付密码以确认代付。',
  payoutCapaEmpty: '暂无可用的代付路线。',
  payoutCapaHeader: '可用路线：',
  payoutCapaLineTemplate: '{0}：费用 {1}，限额 {2} - {3}。',
  payoutQuoteTemplate: '路线 {0}：支付 {1}，费用 {2}，预估到账 {3}（以实际为准）。',
  payoutQuoteRouteNotFound: '未找到该代付路线。',
  payoutQuoteOutOfRange: '金额超出该路线限额。',
  payoutQuoteCommandInvalid: '命令无效，请检查格式。',
  payoutAccepted: '代付已受理，资金已冻结，等待提交供应商。',
  payoutAlreadyRequested: '该代付单已提交，请勿重复操作。',
  payoutDeniedConfig: '当前不支持该路线代付。',
  payoutDeniedRange: '金额超出该路线限额。',
  payoutDeniedInsufficient: '可用余额不足。',
  payoutDeniedRisk: '代付请求被风控拒绝。',
  payoutDeniedInvalid: '代付命令无效，请检查格式。',
  payoutNotBound: '请先完成注册绑定后再使用代付。',
  payoutStatusUnknown: '未找到该代付单。',
  payoutStatusFundsReserved: '代付单已冻结资金，等待提交。',
  payoutStatusSubmitting: '代付单提交供应商中。',
  payoutStatusAccepted: '代付单已被供应商受理，处理中。',
  payoutStatusSucceeded: '代付已完成。',
  payoutStatusFailed: '代付已失败，等待退款。',
  payoutStatusUnknownState: '代付结果待供应商确认，正在查询。',
  payoutStatusRefunded: '代付已退款，资金已回到可用余额。',
  payoutStatusReversed: '代付已被供应商回退，补偿处理中。',
  payoutNotifyRequested: '您有一笔代付申请已受理。',
  payoutNotifySubmitted: '您的代付已提交供应商。',
  payoutNotifySucceeded: '您的代付已完成，请查收。',
  payoutNotifyFailed: '您的代付失败，将进入退款流程。',
  payoutNotifyRefunded: '您的代付已退款，资金已回到可用余额。',
  payoutNotifyReversed: '您的代付已被供应商回退，将进行补偿。',
  internalError: '暂时无法处理，请稍后再试。'
});

export type PayoutReply = keyof typeof PAYOUT_REPLIES;

export function payoutReplyText(reply: PayoutReply): string {
  return PAYOUT_REPLIES[reply];
}

Object.freeze(payoutReplyText.prototype);
