import { describe, expect, it } from "vitest";
import type { App, TFile } from "obsidian";
import { expandSlashCommand } from "../util/slashCommands";
import { getSlashCommandCatalog, matchSlashCommands } from "../util/slashCommandCatalog";

describe("slash command helpers", () => {
  it("exposes the supported slash commands", () => {
    expect(getSlashCommandCatalog().map((entry) => entry.command)).toEqual([
      "/note",
      "/selection",
      "/daily",
      "/backlinks",
      "/history",
      "/diff",
      "/unresolved",
      "/searchctx",
      "/fork",
      "/resume",
      "/compact",
      "/rename-plan",
      "/move-plan",
      "/property-plan",
      "/task-plan",
    ]);
  });

  it("localizes slash command labels without changing command tokens", () => {
    const japaneseCatalog = getSlashCommandCatalog("ja");
    expect(japaneseCatalog[0]?.command).toBe("/note");
    expect(japaneseCatalog[0]?.label).toBe("現在のノート");
    expect(japaneseCatalog[7]?.label).toBe("検索コンテキスト");
  });

  it("matches slash command prefixes for the composer menu", () => {
    expect(matchSlashCommands("/").map((entry) => entry.command)).toEqual([
      "/note",
      "/selection",
      "/daily",
      "/backlinks",
      "/history",
      "/diff",
      "/unresolved",
      "/searchctx",
      "/fork",
      "/resume",
      "/compact",
      "/rename-plan",
      "/move-plan",
      "/property-plan",
      "/task-plan",
    ]);
    expect(matchSlashCommands("/n").map((entry) => entry.command)).toEqual(["/note"]);
    expect(matchSlashCommands("/sel summarize").map((entry) => entry.command)).toEqual(["/selection"]);
    expect(matchSlashCommands("hello")).toEqual([]);
  });

  it("expands /backlinks using metadata cache context", async () => {
    const file = { path: "Notes/Test.md" } as TFile;
    const app = {
      vault: {
        cachedRead: async () => "",
        getMarkdownFiles: () => [],
        adapter: {
          stat: async () => null,
        },
      },
      metadataCache: {
        resolvedLinks: {
          "Notes/A.md": { "Notes/Test.md": 2 },
          "Notes/B.md": { "Notes/Test.md": 1 },
        },
        unresolvedLinks: {},
      },
    } as unknown as App;

    const expanded = await expandSlashCommand("/backlinks Explain the impact", {
      app,
      currentFile: file,
      editor: null,
    });

    expect(expanded.command).toBe("/backlinks");
    expect(expanded.prompt).toContain("Backlinks for Notes/Test.md");
    expect(expanded.prompt).toContain("Notes/A.md (2)");
    expect(expanded.prompt).toContain("Explain the impact");
  });

  it("treats installed skill slash aliases as explicit skill requests", async () => {
    const app = {
      vault: {
        cachedRead: async () => "",
        getMarkdownFiles: () => [],
        adapter: {
          stat: async () => null,
        },
      },
      metadataCache: {
        resolvedLinks: {},
        unresolvedLinks: {},
      },
    } as unknown as App;

    const expanded = await expandSlashCommand("/grill-me refine this plan", {
      app,
      currentFile: null,
      editor: null,
      commands: [
        {
          command: "/grill-me",
          label: "grill-me",
          description: "Interview the user",
          mode: "skill_alias",
          source: "skill_alias",
          skillName: "grill-me",
        },
      ],
    });

    expect(expanded.prompt).toBe("refine this plan");
    expect(expanded.skillPrompt).toBe("$grill-me refine this plan");
  });

  it("supports multiple leading skill aliases before the prompt body", async () => {
    const app = {
      vault: {
        cachedRead: async () => "",
        getMarkdownFiles: () => [],
        adapter: {
          stat: async () => null,
        },
      },
      metadataCache: {
        resolvedLinks: {},
        unresolvedLinks: {},
      },
    } as unknown as App;

    const expanded = await expandSlashCommand("/lecture-read\n/deep-read\n\nCompare these explanations", {
      app,
      currentFile: null,
      editor: null,
      commands: [
        {
          command: "/lecture-read",
          label: "lecture-read",
          description: "Lecture reader",
          mode: "skill_alias",
          source: "skill_alias",
          skillName: "lecture-read",
        },
        {
          command: "/deep-read",
          label: "deep-read",
          description: "Paper reader",
          mode: "skill_alias",
          source: "skill_alias",
          skillName: "deep-read",
        },
      ],
    });

    expect(expanded.command).toBe("/lecture-read");
    expect(expanded.prompt).toBe("Compare these explanations");
    expect(expanded.skillPrompt).toBe("$lecture-read\n$deep-read\nCompare these explanations");
  });

  it("expands study recipe slash aliases into recipe prompts", async () => {
    const app = {
      vault: {
        cachedRead: async () => "",
        getMarkdownFiles: () => [],
        adapter: {
          stat: async () => null,
        },
      },
      metadataCache: {
        resolvedLinks: {},
        unresolvedLinks: {},
      },
    } as unknown as App;

    const expanded = await expandSlashCommand("/recipe-signals focus on aliasing", {
      app,
      currentFile: null,
      editor: null,
      commands: [
        {
          command: "/recipe-signals",
          label: "Signals lecture loop",
          description: "Prefer lecture PDF or current lecture note.",
          mode: "study_recipe",
          source: "study_recipe",
          recipeId: "study-recipe-1",
          recipePrompt: "Saved study recipe: Signals lecture loop\n\nPrompt template\nTurn this lecture into a study guide.",
          studyWorkflow: "lecture",
        },
      ],
    });

    expect(expanded.command).toBe("/recipe-signals");
    expect(expanded.studyRecipeId).toBe("study-recipe-1");
    expect(expanded.prompt).toContain("Saved study recipe: Signals lecture loop");
    expect(expanded.prompt).toContain("focus on aliasing");
  });

  it("resolves conversation slash actions as local actions", async () => {
    const app = {
      vault: {
        cachedRead: async () => "",
        getMarkdownFiles: () => [],
        adapter: {
          stat: async () => null,
        },
      },
      metadataCache: {
        resolvedLinks: {},
        unresolvedLinks: {},
      },
    } as unknown as App;

    await expect(
      expandSlashCommand("/fork", {
        app,
        currentFile: null,
        editor: null,
      }),
    ).resolves.toMatchObject({
      command: "/fork",
      localAction: { type: "fork" },
    });

    await expect(
      expandSlashCommand("/resume", {
        app,
        currentFile: null,
        editor: null,
      }),
    ).resolves.toMatchObject({
      command: "/resume",
      localAction: { type: "resume" },
    });

    await expect(
      expandSlashCommand("/compact", {
        app,
        currentFile: null,
        editor: null,
      }),
    ).resolves.toMatchObject({
      command: "/compact",
      localAction: { type: "compact" },
    });
  });

  it("treats apply-followups as local patch actions", async () => {
    const app = {
      vault: {
        cachedRead: async () => "",
        getMarkdownFiles: () => [],
        adapter: {
          stat: async () => null,
        },
      },
      metadataCache: {
        resolvedLinks: {},
        unresolvedLinks: {},
      },
    } as unknown as App;

    const expanded = await expandSlashCommand("そのまま反映して", {
      app,
      currentFile: null,
      editor: null,
      patchBasket: [
        {
          id: "patch-1",
          threadId: null,
          sourceMessageId: "assistant-1",
          originTurnId: "turn-1",
          targetPath: "Notes/Test.md",
          kind: "update",
          baseSnapshot: "old",
          proposedText: "new",
          unifiedDiff: "@@",
          summary: "Update note",
          status: "pending",
          createdAt: 1,
        },
      ],
    });

    expect(expanded.localAction).toEqual({
      type: "apply_latest_patch",
    });
    expect(expanded.prompt).toBe("");
  });
});
