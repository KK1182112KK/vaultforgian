import { describe, expect, it } from "vitest";
import { getRecoveredDraftValue } from "../util/draftRecovery";

describe("draftRecovery", () => {
  it("restores the previous draft when the current draft is still empty", () => {
    expect(getRecoveredDraftValue("Summarize this lecture", "")).toBe("Summarize this lecture");
  });

  it("does not restore blank backups", () => {
    expect(getRecoveredDraftValue("   ", "")).toBeNull();
  });

  it("does not overwrite a newer draft", () => {
    expect(getRecoveredDraftValue("Summarize this lecture", "retry with narrower scope")).toBeNull();
  });
});
