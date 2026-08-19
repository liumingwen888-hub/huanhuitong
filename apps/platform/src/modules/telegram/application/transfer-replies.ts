export const TRANSFER_REPLIES = Object.freeze({
  transferPrompt: '请使用 /transfer <对方ID> <金额> 进行转账。',
  transferSuccess: '转账成功。',
  transferFailed: '转账失败，请检查余额和对方ID。',
  claimPrompt: '请使用 /claim <领取码> 领取。',
  claimSuccess: '领取成功。',
  claimAlreadyClaimed: '该领取码已被使用。',
  claimExpired: '该领取码已过期，金额已退回。',
  claimNotFound: '领取码不存在。',
  redPacketPrompt: '请使用 /redpacket <总金额> <个数> 创建红包。',
  redPacketCreated: '红包已创建。',
  redPacketFailed: '红包创建失败，请检查余额。',
  balanceNoAccount: '暂无资产账户。',
  internalError: '暂时无法处理，请稍后再试。'
});

export type TransferReply = keyof typeof TRANSFER_REPLIES;

export function transferReplyText(reply: TransferReply): string {
  return TRANSFER_REPLIES[reply];
}

Object.freeze(transferReplyText.prototype);
