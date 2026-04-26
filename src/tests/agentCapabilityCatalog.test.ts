import { describe, expect, it } from "vitest";
import {
  agentCapabilitiesToSlashCommands,
  buildAgentCapabilityCatalog,
} from "../agent/core/agentCapabilityCatalog";
import type { StudyRecipe } from "../model/types";

function createRecipe(): StudyRecipe {
  return {
    id: "recipe-1",
    title: "Paper Review",
    description: "Review papers carefully.",
    commandAlias: "/paper-review",
    workflow: "paper",
    promptTemplate: "Read the paper deeply.",
    linkedSkillNames: ["deep-read"],
    contextContract: {
      summary: "",
      requireTargetNote: false,
      recommendAttachments: true,
      requireSelection: false,
      minimumPinnedContextCount: 0,
    },
    outputContract: [],
    sourceHints: [],
    exampleSession: {
      sourceTabTitle: "Chat",
      targetNotePath: null,
      prompt: "",
      outcomePreview: null,
      createdAt: 0,
    },
    promotionState: "captured",
    promotedSkillName: null,
    useCount: 0,
    lastUsedAt: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("AgentCapabilityCatalog", () => {
  it("combines builtin slash commands, custom prompts, skills, and study recipes without changing slash shape", () => {
    const capabilities = buildAgentCapabilityCatalog({
      locale: "en",
      customPrompts: [
        {
          command: "/commit",
          label: "Commit",
          description: "Write commit text.",
          aliases: ["/ci"],
          argumentHint: null,
          path: "/prompts/commit.md",
          body: "Commit",
        },
      ],
      installedSkills: [{ name: "deep-read", description: "Read deeply.", path: "/skills/deep-read/SKILL.md" }],
      studyRecipes: [createRecipe()],
    });

    expect(capabilities.map((entry) => entry.trigger)).toContain("/note");
    expect(capabilities.map((entry) => entry.trigger)).toContain("/commit");
    expect(capabilities.map((entry) => entry.trigger)).toContain("/ci");
    expect(capabilities.map((entry) => entry.trigger)).toContain("/deep-read");
    expect(capabilities.map((entry) => entry.trigger)).toContain("/paper-review");

    const slashCommands = agentCapabilitiesToSlashCommands(capabilities);
    expect(slashCommands.find((entry) => entry.command === "/deep-read")).toMatchObject({
      source: "skill_alias",
      mode: "skill_alias",
      skillName: "deep-read",
    });
    expect(slashCommands.find((entry) => entry.command === "/paper-review")).toMatchObject({
      source: "study_recipe",
      mode: "study_recipe",
      recipeId: "recipe-1",
      studyWorkflow: "paper",
    });
  });
});
