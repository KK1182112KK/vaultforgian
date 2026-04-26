import { describe, expect, it } from "vitest";
import type { StudyRecipe } from "../model/types";
import { getLocalizedCopy } from "../util/i18n";
import { buildPluginFeatureGuideText } from "../util/pluginFeatureGuides";

function createStudyRecipe(overrides: Partial<StudyRecipe> = {}): StudyRecipe {
  return {
    id: "study-recipe-1",
    title: "Signals Lecture",
    description: "Turn the lecture into a review loop.",
    commandAlias: "/recipe-signals-lecture",
    workflow: "lecture",
    promptTemplate: "Create a study guide from this lecture.",
    linkedSkillNames: ["lecture-read"],
    contextContract: {
      summary: "Prefer lecture PDF or current note.",
      requireTargetNote: false,
      recommendAttachments: true,
      requireSelection: false,
            minimumPinnedContextCount: 0,
    },
    outputContract: ["topics", "questions"],
    sourceHints: ["lecture PDF"],
    exampleSession: {
      sourceTabTitle: "Signals",
      targetNotePath: "Courses/Signals.md",
      prompt: "Summarize the lecture.",
      outcomePreview: "Topics and formulas",
      createdAt: 1,
    },
    promotionState: "captured",
    promotedSkillName: null,
    useCount: 0,
    lastUsedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("plugin feature guides", () => {
  it("returns null for unrelated prompts", () => {
    const guide = buildPluginFeatureGuideText({
      prompt: "Summarize this note",
      locale: "ja",
      copy: getLocalizedCopy("ja"),
      panels: [],
      activePanelId: null,
      isCollapsed: false,
      targetNotePath: null,
    });

    expect(guide).toBeNull();
  });

  it("builds a localized Panel Studio guide from live panel state", () => {
    const guide = buildPluginFeatureGuideText({
      prompt: "Panel Studio の使い方を教えて",
      locale: "ja",
      copy: getLocalizedCopy("ja"),
      panels: [createStudyRecipe()],
      activePanelId: "study-recipe-1",
      isCollapsed: false,
      targetNotePath: "Courses/Signals/Week1.md",
    });

    expect(guide).toContain("Plugin feature guide: Panel Studio");
    expect(guide).toContain("panel 数: 1/6");
    expect(guide).toContain("アクティブ panel: Signals Lecture");
    expect(guide).toContain("対象ノート: Week1.md");
    expect(guide).toContain("Prompt を入れる");
    expect(guide).toContain("Skills");
    expect(guide).toContain("floating popup");
    expect(guide).not.toContain("追加直後に編集状態で開きます");
    expect(guide).toContain("自動送信はされません");
    expect(guide).toContain("/recipe-signals-lecture");
  });

  it("uses the untitled fallback for blank panel titles", () => {
    const guide = buildPluginFeatureGuideText({
      prompt: "Panel Studio の panel を説明して",
      locale: "ja",
      copy: getLocalizedCopy("ja"),
      panels: [createStudyRecipe({ title: "", workflow: "custom" })],
      activePanelId: "study-recipe-1",
      isCollapsed: false,
      targetNotePath: null,
    });

    expect(guide).toContain("アクティブ panel: 無題の panel");
    expect(guide).toContain("- 無題の panel (カスタム)");
  });

  it("detects localized panel-studio aliases beyond the English title", () => {
    const guide = buildPluginFeatureGuideText({
      prompt: "ingest hub の使い方を教えて",
      locale: "en",
      copy: getLocalizedCopy("en"),
      panels: [createStudyRecipe()],
      activePanelId: "study-recipe-1",
      isCollapsed: false,
      targetNotePath: null,
    });

    expect(guide).toContain("Plugin feature guide: Panel Studio");
  });
});
