export const telegramExternalConnectionState = {
  enabled: false,
  disabledDisposition: 'WAITING_CONFIGURATION'
} as const;

export class TelegramConnectionDisabledError extends Error {
  public readonly workerFailureClassification = 'DISABLED' as const;
  constructor() {
    super('TELEGRAM_CONNECTION_DISABLED');
    this.name = 'TelegramConnectionDisabledError';
  }
}
