export const EXCHANGE_REPLIES = Object.freeze({
  marketsEmpty: '暂无可用的换汇市场。',
  marketsHeader: '可用市场：',
  marketLineTemplate: '{0}：卖出限额 {1} - {2}。',
  rateQuotedTemplate: '报价 {0} 已生成：卖出 {1}，预计获得 {2}，有效期剩余约 {3} 秒。',
  rateMarketNotFound: '未找到该换汇市场。',
  rateAmountOutOfRange: '卖出金额超出该市场限额。',
  rateDeviationExceeded: '当前汇率异常，暂不接受报价。',
  rateSourceUnavailable: '暂时无法获取汇率，请稍后再试。',
  rateCommandInvalid: '命令无效，请检查格式。',
  exchangeConfirmed: '换汇已确认，资金已冻结，等待结算。',
  exchangeAlreadyConfirmed: '该报价已被确认，请勿重复操作。',
  exchangeQuoteNotFound: '未找到该报价。',
  exchangeQuoteNotConsumable: '该报价已过期或已被使用。',
  exchangeInsufficient: '可用余额不足。',
  exchangeCommandInvalid: '命令无效，请检查格式。',
  exchangeNotBound: '请先完成注册绑定后再使用换汇。',
  exchangeStatusUnknown: '未找到该换汇单。',
  exchangeStatusFundsReserved: '换汇单已冻结资金，等待结算。',
  exchangeStatusExecuting: '换汇单结算处理中。',
  exchangeStatusSettled: '换汇已完成。',
  exchangeStatusFailed: '换汇已失败，等待退款。',
  exchangeStatusExpired: '换汇已过期，等待退款。',
  exchangeStatusRefunded: '换汇已退款，资金已回到可用余额。',
  exchangeNotifyReserved: '您有一笔换汇已确认，资金已冻结。',
  exchangeNotifySettled: '您的换汇已完成，请查收。',
  exchangeNotifyFailed: '您的换汇已失败，将进入退款流程。',
  exchangeNotifyRefunded: '您的换汇已退款，资金已回到可用余额。',
  internalError: '暂时无法处理，请稍后再试。'
});

export type ExchangeReply = keyof typeof EXCHANGE_REPLIES;

export function exchangeReplyText(reply: ExchangeReply): string {
  return EXCHANGE_REPLIES[reply];
}

Object.freeze(exchangeReplyText.prototype);
