import type { ChatMessage } from "../model/types";

export function shouldSuppressImmediateDuplicateUserPrompt(
  messages: readonly ChatMessage[],
  prompt: string,
  createdAt: number,
  windowMs = 1500,
): boolean {
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) {
    return false;
  }
  const substantiveEntries = messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message.kind === "user" && message.meta?.selectionContext !== true && message.meta?.attachmentSummary !== true);
  const last = substantiveEntries.at(-1);
  if (!last) {
    return false;
  }
  if (last.message.text.trim() !== trimmedPrompt) {
    return false;
  }
  if (createdAt - last.message.createdAt > windowMs) {
    return false;
  }
  const laterMessages = messages.slice(last.index + 1);
  return laterMessages.every(
    (message) =>
      message.kind === "user" &&
      (message.meta?.selectionContext === true || message.meta?.attachmentSummary === true),
  );
}
