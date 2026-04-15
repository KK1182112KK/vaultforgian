import { describe, expect, it } from "vitest";
import { shouldSuppressImmediateDuplicateUserPrompt } from "../util/messageDedup";

describe("messageDedup", () => {
  it("suppresses an immediate duplicate substantive user prompt", () => {
    expect(
      shouldSuppressImmediateDuplicateUserPrompt(
        [
          {
            id: "user-1",
            kind: "user",
            text: "Summarize this lecture",
            createdAt: 100,
          },
        ],
        "Summarize this lecture",
        300,
      ),
    ).toBe(true);
  });

  it("does not suppress duplicates after assistant output appears", () => {
    expect(
      shouldSuppressImmediateDuplicateUserPrompt(
        [
          {
            id: "user-1",
            kind: "user",
            text: "Summarize this lecture",
            createdAt: 100,
          },
          {
            id: "assistant-1",
            kind: "assistant",
            text: "Here is the summary.",
            createdAt: 200,
          },
        ],
        "Summarize this lecture",
        300,
      ),
    ).toBe(false);
  });
});
