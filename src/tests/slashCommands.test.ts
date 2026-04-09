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
      "/campaign",
      "/set",
      "/set-run",
      "/set-drift",
      "/set-campaign",
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
      "/campaign",
      "/set",
      "/set-run",
      "/set-drift",
      "/set-campaign",
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

  it("expands /campaign into a refactor seed over a bounded search result set", async () => {
    const app = {
      vault: {
        cachedRead: async (file: { path: string }) => {
          if (file.path === "Notes/AI.md") {
            return "AI lecture note with control theory links";
          }
          return "AI project summary and lab note";
        },
        getMarkdownFiles: () => [{ path: "Notes/AI.md" }, { path: "Projects/AI.md" }],
        adapter: {
          stat: async () => null,
        },
      },
      metadataCache: {
        resolvedLinks: {},
        unresolvedLinks: {},
      },
    } as unknown as App;

    const expanded = await expandSlashCommand("/campaign ai", {
      app,
      currentFile: null,
      editor: null,
    });

    expect(expanded.command).toBe("/campaign");
    expect(expanded.prompt).toContain("Refactor campaign query: ai");
    expect(expanded.prompt).toContain("Target notes (2)");
    expect(expanded.campaignSeed?.targetPaths).toEqual(["Notes/AI.md", "Projects/AI.md"]);
  });

  it("resolves Smart Set local actions from the active set", async () => {
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

    const expanded = await expandSlashCommand("/set-drift", {
      app,
      currentFile: null,
      editor: null,
      smartSets: [
        {
          id: "smart-set-1",
          title: "Control Lectures",
          naturalQuery: "control lectures except archived",
          normalizedQuery: "{}",
          savedNotePath: null,
          liveResult: null,
          lastSnapshot: null,
          lastDrift: null,
          lastRunAt: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      activeSmartSetId: "smart-set-1",
    });

    expect(expanded.localAction).toEqual({
      type: "drift",
      smartSetId: "smart-set-1",
    });
  });
});
