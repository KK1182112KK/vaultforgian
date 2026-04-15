import { describe, expect, it } from "vitest";
import {
  EMPTY_COMPOSER_HISTORY_STATE,
  pushComposerHistoryEntry,
  stepComposerHistory,
} from "../util/composerHistory";

describe("composerHistory", () => {
  it("walks backward through sent prompts and restores the unsent draft", () => {
    const withEntries = pushComposerHistoryEntry(
      pushComposerHistoryEntry(EMPTY_COMPOSER_HISTORY_STATE, "first prompt"),
      "second prompt",
    );

    const older = stepComposerHistory(withEntries, "draft in progress", "older");
    expect(older.nextDraft).toBe("second prompt");

    const oldest = stepComposerHistory(older.nextState, "ignored", "older");
    expect(oldest.nextDraft).toBe("first prompt");

    const newer = stepComposerHistory(oldest.nextState, "ignored", "newer");
    expect(newer.nextDraft).toBe("second prompt");

    const restored = stepComposerHistory(newer.nextState, "ignored", "newer");
    expect(restored.nextDraft).toBe("draft in progress");
    expect(restored.nextState.index).toBeNull();
  });
});
