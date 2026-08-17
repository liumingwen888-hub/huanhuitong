import type {
  IgnoredTelegramUpdate,
  ParsedTelegramStartUpdate
} from '@xht/contracts';
import { parseTelegramUpdate } from './telegram-update.schema.js';

export type TelegramCommand =
  | ParsedTelegramStartUpdate
  | IgnoredTelegramUpdate;

export function mapTelegramBodyToCommand(
  body: unknown
): TelegramCommand {
  return parseTelegramUpdate(body);
}
