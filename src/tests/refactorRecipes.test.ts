import { describe, expect, it } from "vitest";
import { buildRecipeCampaignPrompt, buildRefactorRecipeFromCampaign } from "../util/refactorRecipes";

describe("refactor recipe helpers", () => {
  it("builds a reusable recipe from a campaign", () => {
    const recipe = buildRefactorRecipeFromCampaign(
      {
        id: "campaign-1",
        sourceMessageId: "assistant-1",
        title: "Refactor Campaign",
        query: "Smart Set: Control lectures",
        targetPaths: ["courses/control/L01.md", "courses/control/L02.md"],
        items: [
          {
            id: "campaign-item-1",
            refId: "approval-1",
            kind: "vault_op",
            title: "Rename lecture note",
            summary: "Rename for consistency",
            targetPath: "courses/control/L01.md",
            destinationPath: "courses/control/lecture-01.md",
            operationKind: "rename",
            enabled: true,
            status: "pending",
            sourceMessageId: "assistant-1",
          },
          {
            id: "campaign-item-2",
            refId: "approval-2",
            kind: "vault_op",
            title: "Move lecture note",
            summary: "Move to lectures folder",
            targetPath: "courses/control/L02.md",
            destinationPath: "courses/control/lectures/L02.md",
            operationKind: "move",
            enabled: true,
            status: "pending",
            sourceMessageId: "assistant-1",
          },
        ],
        heatmap: [],
        snapshotCapsule: null,
        executionLog: [],
        status: "ready",
        createdAt: 1,
      },
      "recipe-1",
      10,
    );

    expect(recipe).toEqual(
      expect.objectContaining({
        id: "recipe-1",
        preferredScopeKind: "smart_set",
        operationKinds: ["rename", "move"],
      }),
    );
    expect(recipe.examples).toHaveLength(2);
  });

  it("builds a campaign prompt from a recipe and target paths", () => {
    const prompt = buildRecipeCampaignPrompt(
      {
        id: "recipe-1",
        title: "Lecture cleanup",
        description: "Backlink-safe rename and move surgery for a bounded note set.",
        sourceCampaignId: "campaign-1",
        sourceCampaignTitle: "Refactor Campaign",
        sourceQuery: "control lectures",
        preferredScopeKind: "search_query",
        operationKinds: ["rename", "move"],
        examples: [
          {
            kind: "vault_op",
            operationKind: "rename",
            title: "Rename lecture note",
            summary: "Rename for consistency",
            targetPath: "courses/control/L01.md",
            destinationPath: "courses/control/lecture-01.md",
          },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
      "Search query: control lectures",
      ["courses/control/L03.md"],
    );

    expect(prompt).toContain("Vault surgery recipe: Lecture cleanup");
    expect(prompt).toContain("Requested scope: Search query: control lectures");
    expect(prompt).toContain("- courses/control/L03.md");
    expect(prompt).toContain("Bias toward these operation kinds: rename, move.");
    expect(prompt).toContain("- rename: courses/control/L01.md -> courses/control/lecture-01.md");
  });

  it("rejects campaigns with no enabled items", () => {
    expect(() =>
      buildRefactorRecipeFromCampaign(
        {
          id: "campaign-2",
          sourceMessageId: "assistant-2",
          title: "Disabled campaign",
          query: "current note",
          targetPaths: ["notes/a.md"],
          items: [
            {
              id: "campaign-item-1",
              refId: "approval-1",
              kind: "vault_op",
              title: "Rename note",
              summary: "Rename",
              targetPath: "notes/a.md",
              destinationPath: "notes/b.md",
              operationKind: "rename",
              enabled: false,
              status: "pending",
              sourceMessageId: "assistant-2",
            },
          ],
          heatmap: [],
          snapshotCapsule: null,
          executionLog: [],
          status: "ready",
          createdAt: 1,
        },
        "recipe-2",
        10,
      ),
    ).toThrow("no enabled items");
  });

  it("keeps Smart Set scope when a recipe-generated campaign prefixes the query", () => {
    const recipe = buildRefactorRecipeFromCampaign(
      {
        id: "campaign-3",
        sourceMessageId: "assistant-3",
        title: "Recipe rerun",
        query: "Lecture cleanup · Smart Set: Control lectures",
        targetPaths: ["courses/control/L01.md", "courses/control/L02.md"],
        items: [
          {
            id: "campaign-item-1",
            refId: "approval-1",
            kind: "vault_op",
            title: "Rename lecture note",
            summary: "Rename for consistency",
            targetPath: "courses/control/L01.md",
            destinationPath: "courses/control/lecture-01.md",
            operationKind: "rename",
            enabled: true,
            status: "pending",
            sourceMessageId: "assistant-3",
          },
        ],
        heatmap: [],
        snapshotCapsule: null,
        executionLog: [],
        status: "ready",
        createdAt: 1,
      },
      "recipe-3",
      10,
    );

    expect(recipe.preferredScopeKind).toBe("smart_set");
  });
});
