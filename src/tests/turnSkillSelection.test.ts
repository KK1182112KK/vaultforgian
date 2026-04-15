import { describe, expect, it } from "vitest";
import type { ConversationTabState } from "../model/types";
import { collectTurnRequestedSkillRefs } from "../util/turnSkillSelection";

function createTabState(
  overrides: Partial<Pick<ConversationTabState, "activeStudyRecipeId" | "activeStudySkillNames" | "panelSessionOrigin">>,
): ConversationTabState {
  return {
    activeStudyRecipeId: overrides.activeStudyRecipeId ?? null,
    activeStudySkillNames: overrides.activeStudySkillNames ?? [],
    panelSessionOrigin: overrides.panelSessionOrigin ?? null,
  } as ConversationTabState;
}

describe("turnSkillSelection", () => {
  it("unions explicit, mention, panel, and workflow skills in priority order", () => {
    const refs = collectTurnRequestedSkillRefs({
      explicitSkillRefs: ["$deep-read\n$study-material-builder\nRead this paper"],
      mentionSkillRefs: ["$deep-research"],
      workflowSkillRefs: ["$deep-read", "$paper-review"],
      tab: createTabState({
        activeStudyRecipeId: "panel-1",
        activeStudySkillNames: ["study-material-builder", "grill-me"],
        panelSessionOrigin: {
          panelId: "panel-1",
          selectedSkillNames: ["grill-me", "deep-read"],
          promptSnapshot: "Read this paper",
          awaitingCompletionSignal: false,
          lastAssistantMessageId: null,
          startedAt: 1,
        },
      }),
    });

    expect(refs).toEqual([
      "$deep-read",
      "$study-material-builder",
      "$deep-research",
      "$grill-me",
      "$paper-review",
    ]);
  });

  it("drops panel-origin skills when no active panel is selected", () => {
    const refs = collectTurnRequestedSkillRefs({
      explicitSkillRefs: [],
      mentionSkillRefs: [],
      workflowSkillRefs: ["$lecture-read"],
      tab: createTabState({
        activeStudyRecipeId: null,
        activeStudySkillNames: ["deep-read"],
        panelSessionOrigin: {
          panelId: "panel-1",
          selectedSkillNames: ["study-material-builder"],
          promptSnapshot: "Read this paper",
          awaitingCompletionSignal: false,
          lastAssistantMessageId: null,
          startedAt: 1,
        },
      }),
    });

    expect(refs).toEqual(["$lecture-read"]);
  });

  it("ignores panelSessionOrigin skills for a different panel id", () => {
    const refs = collectTurnRequestedSkillRefs({
      explicitSkillRefs: [],
      mentionSkillRefs: [],
      workflowSkillRefs: [],
      tab: createTabState({
        activeStudyRecipeId: "panel-1",
        activeStudySkillNames: ["deep-read"],
        panelSessionOrigin: {
          panelId: "panel-2",
          selectedSkillNames: ["study-material-builder"],
          promptSnapshot: "Read this paper",
          awaitingCompletionSignal: false,
          lastAssistantMessageId: null,
          startedAt: 1,
        },
      }),
    });

    expect(refs).toEqual(["$deep-read"]);
  });
});
