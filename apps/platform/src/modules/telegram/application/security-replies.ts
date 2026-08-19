export const SECURITY_REPLIES = Object.freeze({
  setupStarted:
    '请输入新的支付密码数字，逐条发送。输入完成后发送 /done。',
  confirmPhase: '请再次输入一遍以确认。',
  setupSuccess: '支付密码已设置。',
  entriesMismatch: '两次输入不一致，请重新发送 /setpassword。',
  outOfRange: '密码位数不符合要求，请重新发送 /setpassword。',
  cancelled: '已取消当前操作。',
  locked: '支付凭证已锁定，请稍后再试或发起恢复流程。',
  cooldown: '恢复冷静期中，高风险操作受限。',
  sessionAlreadyOpen: '已有进行中的操作，请先发送 /cancel。',
  rateLimited: '操作过于频繁，请稍后再试。',
  authorizePrompt: '请输入支付密码以确认该操作。',
  authorized: '支付授权已确认。',
  rejected: '密码错误，请重试。',
  notInSession: '当前没有进行中的密码输入。',
  internalError: '暂时无法处理，请稍后再试。'
});

export type SecurityReply = keyof typeof SECURITY_REPLIES;

export function securityReplyText(reply: SecurityReply): string {
  return SECURITY_REPLIES[reply];
}

Object.freeze(securityReplyText.prototype);
