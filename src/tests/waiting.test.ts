import { describe, expect, it } from "vitest";
import { pickWaitingCopy } from "../util/waiting";

function sampleWaitingCopies(
  phase: Parameters<typeof pickWaitingCopy>[0],
  locale: "en" | "ja",
  mode: Parameters<typeof pickWaitingCopy>[1] = "normal",
): Set<string> {
  return new Set(Array.from({ length: 96 }, (_, index) => pickWaitingCopy(phase, mode, index, { locale })));
}

describe("waiting copy", () => {
  it("uses the selected language for general waiting phrases", () => {
    expect(pickWaitingCopy("boot", "normal", 0, { locale: "en" })).not.toMatch(/[ぁ-んァ-ン一-龥]/u);
    expect(pickWaitingCopy("boot", "normal", 0, { locale: "en" }).length).toBeGreaterThan(0);
    expect(pickWaitingCopy("tools", "skill", 0, { locale: "en" })).toMatch(/^Calling skill/u);
    expect(pickWaitingCopy("boot", "normal", 0, { locale: "ja" })).toMatch(/[ぁ-んァ-ン一-龥]/u);
  });

  it("offers a richer set of playful waiting variants in each language", () => {
    for (const phase of ["boot", "reasoning", "tools", "finalizing"] as const) {
      expect(sampleWaitingCopies(phase, "en").size).toBeGreaterThanOrEqual(8);
      expect(sampleWaitingCopies(phase, "ja").size).toBeGreaterThanOrEqual(8);
    }
  });

  it("uses context-aware safety and readability copy when provided", () => {
    expect(pickWaitingCopy("tools", "normal", 0, { focus: "patch_safety", locale: "en" })).toBe("Checking note safety");
    expect(pickWaitingCopy("tools", "normal", 0, { focus: "readability", locale: "en" })).toBe("Checking Markdown readability");
    expect(pickWaitingCopy("tools", "normal", 0, { focus: "patch_safety", locale: "ja" })).toBe("ノート変更の安全性を確認しています");
  });
});
