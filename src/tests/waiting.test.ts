import { describe, expect, it } from "vitest";
import { formatWaitingSkillUsageTitle, pickWaitingCopy, resolveWaitingStateText } from "../util/waiting";

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

  it("falls back to English unless Japanese is explicitly selected", () => {
    expect(pickWaitingCopy("boot", "normal", 0)).not.toMatch(/[ぁ-んァ-ン一-龥]/u);
    expect(pickWaitingCopy("tools", "normal", 0, { focus: "patch_safety" })).toBe("Checking note safety");
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

  it("shows active skill usage in waiting copy", () => {
    const skillUsage = {
      requiredSkillNames: ["brainstorming", "lecture-read"],
      autoSelectedSkillNames: ["paper-visualizer", "homework"],
      orderedSkillNames: ["brainstorming", "lecture-read", "paper-visualizer", "homework"],
      primarySkillName: "brainstorming",
      skillCount: 4,
    };

    expect(pickWaitingCopy("boot", "skill", 0, { locale: "en", skillUsage })).toMatch(
      /^Using skills: \/brainstorming, \/lecture-read \+2 · /u,
    );
    expect(pickWaitingCopy("boot", "skill", 0, { locale: "ja", skillUsage })).toMatch(
      /^Skill使用中: \/brainstorming, \/lecture-read \+2 · /u,
    );
  });

  it("distinguishes auto-selected-only skill usage", () => {
    const skillUsage = {
      requiredSkillNames: [],
      autoSelectedSkillNames: ["paper-visualizer"],
      orderedSkillNames: ["paper-visualizer"],
      primarySkillName: "paper-visualizer",
      skillCount: 1,
    };

    expect(pickWaitingCopy("reasoning", "skill", 0, { locale: "en", skillUsage })).toMatch(/^Using suggested skills: \/paper-visualizer · /u);
    expect(pickWaitingCopy("reasoning", "skill", 0, { locale: "ja", skillUsage })).toMatch(/^提案Skill使用中: \/paper-visualizer · /u);
  });

  it("can suppress skill prefixes for continuation waiting copy", () => {
    const skillUsage = {
      requiredSkillNames: ["brainstorming", "lecture-read"],
      autoSelectedSkillNames: ["paper-visualizer"],
      orderedSkillNames: ["brainstorming", "lecture-read", "paper-visualizer"],
      primarySkillName: "brainstorming",
      skillCount: 3,
    };

    expect(pickWaitingCopy("boot", "skill", 0, { locale: "en", skillUsage, suppressSkillPrefix: true })).not.toMatch(
      /^Using skills:/u,
    );
    expect(pickWaitingCopy("tools", "skill", 0, { locale: "en", skillUsage, suppressSkillPrefix: true })).not.toMatch(
      /^(Using skills:|Calling skill)/u,
    );
  });

  it("preserves skill usage when resolving stale waiting copy into another locale", () => {
    const waitingState = {
      phase: "boot" as const,
      text: "Skill使用中: /brainstorming +3 · 手がかりを集めています",
      locale: "ja" as const,
      mode: "skill" as const,
      requiredSkillNames: ["brainstorming", "lecture-read"],
      autoSelectedSkillNames: ["paper-visualizer", "homework"],
      orderedSkillNames: ["brainstorming", "lecture-read", "paper-visualizer", "homework"],
      primarySkillName: "brainstorming",
      skillCount: 4,
    };

    expect(resolveWaitingStateText(waitingState, "skill", "en")).toMatch(/^Using skills: \/brainstorming, \/lecture-read \+2 · /u);
  });

  it("formats skill usage tooltip text", () => {
    expect(
      formatWaitingSkillUsageTitle(
        {
          phase: "boot",
          text: "Thinking",
          requiredSkillNames: ["brainstorming", "lecture-read"],
          autoSelectedSkillNames: ["paper-visualizer"],
        },
        "en",
      ),
    ).toBe("Required: /brainstorming, /lecture-read. Auto: /paper-visualizer");
  });
});
