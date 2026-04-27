import { describe, expect, it } from "vitest";
import type { StudyRecipe } from "../model/types";
import {
  buildStudyRecipeChatPrompt,
  buildStudySkillDraft,
  evaluatePanelRuntimePreflight,
  evaluateStudyRecipePreflight,
  rankPanelSkillsForRecipe,
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

  it("uses panel memory for dynamic review preflight hints without blocking", () => {
    const preflight = evaluatePanelRuntimePreflight(
      {
        panel: { ...RECIPE, workflow: "review" },
        panelMemory: {
          weakConcepts: [
            {
              conceptLabel: "frequency response",
              evidence: "Still mixes magnitude and phase.",
              lastStuckPoint: "Phase interpretation is unclear.",
              nextQuestion: "What changes when only phase shifts?",
              workflow: "review",
              updatedAt: 10,
            },
          ],
          understoodConcepts: [],
          nextProblems: [
            {
              prompt: "Classify whether a Bode plot change is magnitude or phase.",
              workflow: "review",
              source: "Signals lecture loop",
              createdAt: 11,
            },
          ],
          recentStuckPoints: [],
          sourcePreferences: [],
          lastContract: null,
          improvementSignals: [],
        },
        tab: null,
        attachments: [],
        selection: null,
        targetNote: null,
        pinnedContext: null,
        prompt: "Continue review",
      },
      "en",
    );

    expect(preflight.ready).toBe(true);
    expect(preflight.sourceStrategy).toBe("continue_from_memory");
    expect(preflight.autoContextAdditions).toEqual([
      expect.objectContaining({ kind: "weak_concept", text: expect.stringContaining("frequency response") }),
      expect.objectContaining({ kind: "next_problem", text: expect.stringContaining("Bode plot") }),
    ]);
  });

  it("asks for the problem source in homework preflight without blocking when no problem text is present", () => {
    const preflight = evaluatePanelRuntimePreflight(
      {
        panel: {
          ...RECIPE,
          workflow: "homework",
          contextContract: {
            ...RECIPE.contextContract,
            requireSelection: false,
            requireTargetNote: false,
            recommendAttachments: false,
          },
        },
        panelMemory: null,
        tab: null,
        attachments: [],
        selection: null,
        targetNote: null,
        pinnedContext: null,
        prompt: "help me with homework",
      },
      "en",
    );

    expect(preflight.ready).toBe(true);
    expect(preflight.sourceStrategy).toBe("ask_for_source");
    expect(preflight.advisories.join("\n")).toContain("problem statement");
  });

  it("ranks panel skills from selected skills, panel memory, weak concepts, and prompt similarity", () => {
    const ranked = rankPanelSkillsForRecipe({
      panel: {
        ...RECIPE,
        workflow: "paper",
        linkedSkillNames: ["lecture-read"],
      },
      panelMemory: {
        weakConcepts: [
          {
            conceptLabel: "claim interpretation",
            evidence: "Needs paper-reading support.",
            lastStuckPoint: "Claims and interpretations are mixed.",
            nextQuestion: "Which sentence is the author claim?",
            workflow: "paper",
            updatedAt: 10,
          },
        ],
        understoodConcepts: [],
        nextProblems: [],
        recentStuckPoints: [],
        sourcePreferences: [],
        lastContract: null,
        improvementSignals: [],
      },
      skills: [
        { name: "generic-note", description: "General note cleanup.", path: "/vault/.codex/skills/generic-note/SKILL.md" },
        {
          name: "paper-claims",
          description: "Analyze paper claims, interpretation, and evidence.",
          path: "/vault/.codex/skills/paper-claims/SKILL.md",
        },
        { name: "lecture-read", description: "Read lectures.", path: "/vault/.codex/skills/lecture-read/SKILL.md" },
      ],
      selectedSkillNames: ["lecture-read"],
      explicitSkillNames: [],
      prompt: "Separate the paper claims from interpretation.",
    });

    expect(ranked.map((skill) => skill.name)).toEqual(["lecture-read", "paper-claims", "generic-note"]);
  });

  it("builds a skill draft from a saved recipe", () => {
    const draft = buildStudySkillDraft(RECIPE, "en");
    expect(draft.skillName).toBe("signals-lecture-loop");
    expect(draft.content).toContain("## Prompt template");
    expect(draft.content).toContain("Help me study this lecture");
  });
});
