import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../model/types";
import {
  AUTO_COMPACT_MESSAGE_THRESHOLD,
  AUTO_COMPACT_VISIBLE_CHAR_THRESHOLD,
  getVisibleConversationCharCount,
  shouldAutoCompactConversation,
} from "../util/conversationCompaction";

function createMessage(id: string, kind: ChatMessage["kind"], text: string): ChatMessage {
  return {
    id,
    kind,
    text,
    createdAt: 1,
  };
}

describe("conversation compaction helpers", () => {
  it("counts only visible user and assistant message text", () => {
    expect(
      getVisibleConversationCharCount([
        createMessage("u1", "user", "hello"),
        createMessage("a1", "assistant", "world"),
        createMessage("s1", "system", "ignored"),
      ]),
    ).toBe("helloworld".length);
  });

  it("auto-compacts long threaded conversations by message count", () => {
    expect(
      shouldAutoCompactConversation({
        codexThreadId: "thread-1",
        pendingThreadReset: false,
        messages: Array.from({ length: AUTO_COMPACT_MESSAGE_THRESHOLD }, (_, index) =>
          createMessage(`m${index}`, index % 2 === 0 ? "user" : "assistant", "short"),
        ),
      }),
    ).toBe(true);
  });

  it("auto-compacts long threaded conversations by visible character count", () => {
    expect(
      shouldAutoCompactConversation({
        codexThreadId: "thread-1",
        pendingThreadReset: false,
        messages: [createMessage("u1", "user", "x".repeat(AUTO_COMPACT_VISIBLE_CHAR_THRESHOLD))],
      }),
    ).toBe(true);
  });

  it("does not auto-compact tabs without a thread or with a pending reset", () => {
    expect(
      shouldAutoCompactConversation({
        codexThreadId: null,
        pendingThreadReset: false,
        messages: [createMessage("u1", "user", "x".repeat(AUTO_COMPACT_VISIBLE_CHAR_THRESHOLD))],
      }),
    ).toBe(false);
    expect(
      shouldAutoCompactConversation({
        codexThreadId: "thread-1",
        pendingThreadReset: true,
        messages: [createMessage("u1", "user", "x".repeat(AUTO_COMPACT_VISIBLE_CHAR_THRESHOLD))],
      }),
    ).toBe(false);
  });
});
