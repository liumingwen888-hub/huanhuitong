export interface MainMenuButton {
  readonly id: string;
  readonly label: string;
}

export interface SendMainMenuInput {
  readonly externalUserId: string;
  readonly text: string;
  readonly buttons: readonly MainMenuButton[];
  readonly idempotencyKey: string;
}

export interface TelegramBotGateway {
  sendMainMenu(input: SendMainMenuInput): Promise<void>;
}
