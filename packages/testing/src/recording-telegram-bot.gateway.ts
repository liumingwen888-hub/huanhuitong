export interface RecordedMainMenuDelivery {
  readonly externalUserId: string;
  readonly text: string;
  readonly buttons: readonly {
    readonly id: string;
    readonly label: string;
  }[];
  readonly idempotencyKey: string;
}

export interface RecordedEffect {
  readonly key: string;
  readonly externalUserId: string;
  readonly text: string;
}

export interface DuplicateRiskAudit {
  readonly key: string;
  readonly reason: 'duplicate-delivery';
}

export interface RecordingTelegramBotGateway {
  readonly deliveries: readonly RecordedMainMenuDelivery[];
  readonly effects: ReadonlyMap<string, RecordedEffect>;
  readonly duplicateRisks: readonly DuplicateRiskAudit[];
  sendMainMenu(input: RecordedMainMenuDelivery): Promise<void>;
}

export class RecordingTelegramBotGatewayImpl
  implements RecordingTelegramBotGateway
{
  readonly deliveries: RecordedMainMenuDelivery[] = [];
  readonly effects = new Map<string, RecordedEffect>();
  readonly duplicateRisks: DuplicateRiskAudit[] = [];
  failure: Error | undefined;

  public async sendMainMenu(
    input: RecordedMainMenuDelivery
  ): Promise<void> {
    if (this.failure !== undefined) throw this.failure;
    this.deliveries.push(input);
    const existing = this.effects.get(input.idempotencyKey);
    if (existing !== undefined) {
      this.duplicateRisks.push({
        key: input.idempotencyKey,
        reason: 'duplicate-delivery'
      });
      return;
    }
    this.effects.set(input.idempotencyKey, {
      key: input.idempotencyKey,
      externalUserId: input.externalUserId,
      text: input.text
    });
  }
}
