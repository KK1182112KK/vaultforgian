import { describe, expect, it } from "vitest";
import type { StudyRecipe } from "../model/types";
import {
  buildStudyRecipeChatPrompt,
  buildStudySkillDraft,
  evaluateStudyRecipePreflight,
} from "../util/studyRecipes";

const RECIPE: StudyRecipe = {
  id: "study-recipe-1",
  title: "Signals lecture loop",
  description: "Turn signals lecture material into a reusable study panel.",
  commandAlias: "/recipe-signals-lecture-loop",
  workflow: "lecture",
  promptTemplate: "Help me study this lecture and extract the main ideas.",
  linkedSkillNames: ["lecture-read"],
  contextContract: {
    summary: "Prefer lecture PDF or current lecture note.",
    requireTargetNote: false,
    recommendAttachments: true,
    requireSelection: false,
        minimumPinnedContextCount: 0,
  },
  outputContract: ["Main topics", "Key formulas"],
  sourceHints: ["attached lecture files", "current lecture note"],
  exampleSession: {
    sourceTabTitle: "Signals tab",
    targetNotePath: "courses/signals/week-03.md",
    prompt: "Help me study this lecture.",
    outcomePreview: "Discussed aliasing and reconstruction.",
    createdAt: 1,
  },
  promotionState: "captured",
  promotedSkillName: null,
  useCount: 0,
  lastUsedAt: null,
  createdAt: 1,
  updatedAt: 1,
};

describe("study recipe helpers", () => {
  it("builds a chat prompt that preserves the recipe contract", () => {
    const prompt = buildStudyRecipeChatPrompt(RECIPE, "en", "focus on the sampling theorem");
    expect(prompt).toContain("Saved study recipe: Signals lecture loop");
    expect(prompt).toContain("Prompt template");
    expect(prompt).toContain("Panel description");
    expect(prompt).toContain("focus on the sampling theorem");
    expect(prompt).toContain("Key formulas");
  });

  it("reports advisory context gaps without blocking execution when attachments are only recommended", () => {
    const preflight = evaluateStudyRecipePreflight(
      RECIPE,
      {
        currentFilePath: "courses/signals/week-03.md",
        hasAttachments: false,
      },
      "en",
    );
    expect(preflight.ready).toBe(true);
    expect(preflight.advisories[0]).toContain("Attach source material");
  });

  it("builds a skill draft from a saved recipe", () => {
    const draft = buildStudySkillDraft(RECIPE, "en");
    expect(draft.skillName).toBe("signals-lecture-loop");
    expect(draft.content).toContain("## Prompt template");
    expect(draft.content).toContain("Help me study this lecture");
  });
});
