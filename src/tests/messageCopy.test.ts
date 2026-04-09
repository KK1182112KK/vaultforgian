import { describe, expect, it } from "vitest";
import { isCopyableTranscriptMessage } from "../util/messageCopy";

describe("message copy helpers", () => {
  it("allows copying completed non-user transcript messages", () => {
    expect(isCopyableTranscriptMessage({ kind: "assistant" })).toBe(true);
    expect(isCopyableTranscriptMessage({ kind: "reasoning" })).toBe(true);
    expect(isCopyableTranscriptMessage({ kind: "tool" })).toBe(true);
  });

  it("hides copy affordances for user and pending messages", () => {
    expect(isCopyableTranscriptMessage({ kind: "user" })).toBe(false);
    expect(isCopyableTranscriptMessage({ kind: "assistant", pending: true })).toBe(false);
  });
});
