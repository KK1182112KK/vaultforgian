import type { ChatMessage } from "../model/types";

export const AUTO_COMPACT_MESSAGE_THRESHOLD = 40;
export const AUTO_COMPACT_VISIBLE_CHAR_THRESHOLD = 80_000;
export const TRANSCRIPT_SOFT_COLLAPSE_WINDOW = 20;

export function getVisibleConversationCharCount(messages: readonly ChatMessage[]): number {
  return messages.reduce((total, message) => {
    if (message.kind !== "user" && message.kind !== "assistant") {
      return total;
    }
    return total + message.text.trim().length;
  }, 0);
}

export function shouldAutoCompactConversation(params: {
  codexThreadId: string | null;
  pendingThreadReset: boolean;
  compactedAt?: number | null;
  messages: readonly ChatMessage[];
}): boolean {
  if (!params.codexThreadId?.trim() || params.pendingThreadReset) {
    return false;
  }
  const compactedAt = typeof params.compactedAt === "number" ? params.compactedAt : null;
  const recentMessages =
    compactedAt !== null
      ? params.messages.filter((message) => message.createdAt >= compactedAt)
      : params.messages;
  const visibleMessageCount = recentMessages.filter((message) => message.kind === "user" || message.kind === "assistant").length;
  if (visibleMessageCount >= AUTO_COMPACT_MESSAGE_THRESHOLD) {
    return true;
  }
  return getVisibleConversationCharCount(recentMessages) >= AUTO_COMPACT_VISIBLE_CHAR_THRESHOLD;
}
