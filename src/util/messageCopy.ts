import type { ChatMessage } from "../model/types";

export function isCopyableTranscriptMessage(message: Pick<ChatMessage, "kind" | "pending">): boolean {
  return message.kind !== "user" && !message.pending;
}
