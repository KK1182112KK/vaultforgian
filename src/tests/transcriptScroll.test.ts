import { describe, expect, it } from "vitest";
import { clampTranscriptScrollTop, shouldStickTranscriptToBottom } from "../util/transcriptScroll";

describe("transcriptScroll", () => {
  it("sticks to bottom when the active tab changes", () => {
    expect(
      shouldStickTranscriptToBottom({
        activeTabId: "tab-2",
        previousTabId: "tab-1",
        scrollTop: 0,
        scrollHeight: 1000,
        clientHeight: 400,
      }),
    ).toBe(true);
  });

  it("preserves user scroll when they are far from the bottom", () => {
    expect(
      shouldStickTranscriptToBottom({
        activeTabId: "tab-1",
        previousTabId: "tab-1",
        scrollTop: 120,
        scrollHeight: 1000,
        clientHeight: 400,
      }),
    ).toBe(false);
  });

  it("does not auto-follow when the user is slightly above the bottom", () => {
    expect(
      shouldStickTranscriptToBottom({
        activeTabId: "tab-1",
        previousTabId: "tab-1",
        scrollTop: 572,
        scrollHeight: 1000,
        clientHeight: 400,
      }),
    ).toBe(false);
  });

  it("treats a small manual offset from the bottom as non-sticky", () => {
    expect(
      shouldStickTranscriptToBottom({
        activeTabId: "tab-1",
        previousTabId: "tab-1",
        scrollTop: 380,
        scrollHeight: 640,
        clientHeight: 240,
      }),
    ).toBe(false);
  });

  it("clamps preserved scroll positions into the renderable range", () => {
    expect(clampTranscriptScrollTop(999, 600, 300)).toBe(300);
    expect(clampTranscriptScrollTop(-50, 600, 300)).toBe(0);
  });
});
