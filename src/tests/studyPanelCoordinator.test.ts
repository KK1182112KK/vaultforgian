import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { AgentStore } from "../model/store";
import type { StudyRecipe, StudyWorkflowKind } from "../model/types";
import { getLocalizedCopy } from "../util/i18n";
import type { InstalledSkillDefinition } from "../util/skillCatalog";
import { StudyPanelCoordinator } from "../app/studyPanelCoordinator";

const tempRoots: string[] = [];

async function makeTempRoot(prefix = "codex-noteforge-study-panel-"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function createPanel(id: string, promptTemplate = "Turn this into a lecture review"): StudyRecipe {
  return {
    id,
    title: "Lecture",
    description: "Study lecture material.",
    commandAlias: "/recipe-lecture",
    workflow: "lecture",
    promptTemplate,
    linkedSkillNames: ["lecture-read", "deep-read"],
    contextContract: {
      summary: "Prefer lecture notes.",
      requireTargetNote: false,
      recommendAttachments: true,
      requireSelection: false,
            minimumPinnedContextCount: 0,
    },
    outputContract: ["Main ideas"],
    sourceHints: ["current note"],
    exampleSession: {
      sourceTabTitle: "Study chat",
      targetNotePath: null,
      prompt: promptTemplate,
      outcomePreview: null,
      createdAt: 1,
    },
    promotionState: "captured",
    promotedSkillName: null,
    useCount: 0,
    lastUsedAt: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function createCoordinator(
  store: AgentStore,
  options: {
    vaultRoot?: string;
    installedSkills?: InstalledSkillDefinition[];
  } = {},
) {
  const vaultRoot = options.vaultRoot ?? "/vault";
  const installedSkills = options.installedSkills ?? [];
  return new StudyPanelCoordinator({
    app: {} as never,
    store,
    getLocale: () => "en",
    getLocalizedCopy: () => getLocalizedCopy("en"),
    getActiveTab: () => store.getActiveTab(),
    findTab: (tabId) => store.getState().tabs.find((tab) => tab.id === tabId) ?? null,
    getStudyRecipes: () => store.getState().studyRecipes,
    getActiveStudyWorkflow: () => store.getActiveTab()?.studyWorkflow ?? null,
    getPreferredTargetFile: () => null,
    resolveTargetNotePath: (tabId) => store.getState().tabs.find((tab) => tab.id === tabId)?.targetNotePath ?? null,
    getTabSessionItems: (tabId) => store.getState().tabs.find((tab) => tab.id === tabId)?.sessionItems ?? [],
    buildWorkflowPromptContext: (_tabId: string, _workflow: StudyWorkflowKind | null, currentFilePath: string | null) => ({
      currentFilePath,
      targetNotePath: null,
      hasAttachments: false,
      hasSelection: false,
      pinnedContextCount: 0,
    }),
    refreshCodexCatalogs: async () => {},
    resolveVaultRoot: () => vaultRoot,
    getInstalledSkillCatalog: () => installedSkills,
  });
}

describe("StudyPanelCoordinator", () => {
  it("seeds a panel skill into the composer draft and marks the selected skill", () => {
    const store = new AgentStore(null, "/vault", true);
    const tabId = store.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }
    const panel = createPanel("panel-1");
    store.setStudyRecipes([panel]);

    const coordinator = createCoordinator(store);
    const draft = coordinator.seedHubPanelSkill(tabId, panel.id, "lecture-read");
    const tab = store.getState().tabs.find((entry) => entry.id === tabId);

    expect(draft).toBe("/lecture-read\n\nTurn this into a lecture review");
    expect(tab?.draft).toBe(draft);
    expect(tab?.activeStudyRecipeId).toBe(panel.id);
    expect(tab?.activeStudySkillNames).toEqual(["lecture-read"]);
  });

  it("merges additional panel skills into the existing draft without duplicating the prompt body", () => {
    const store = new AgentStore(null, "/vault", true);
    const tabId = store.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }
    const panel = createPanel("panel-1");
    store.setStudyRecipes([panel]);

    const coordinator = createCoordinator(store);
    coordinator.seedHubPanelSkill(tabId, panel.id, "lecture-read");
    const draft = coordinator.seedHubPanelSkills(tabId, panel.id, ["deep-read"]);
    const tab = store.getState().tabs.find((entry) => entry.id === tabId);

    expect(draft).toBe("/lecture-read\n/deep-read\n\nTurn this into a lecture review");
    expect(tab?.activeStudySkillNames).toEqual(["lecture-read", "deep-read"]);
  });

  it("links a newly selected available skill into the panel before seeding it", () => {
    const store = new AgentStore(null, "/vault", true);
    const tabId = store.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }
    const panel = { ...createPanel("panel-1"), linkedSkillNames: ["lecture-read"] };
    store.setStudyRecipes([panel]);

    const coordinator = createCoordinator(store);
    const draft = coordinator.seedHubPanelSkills(tabId, panel.id, ["grill-me"]);
    const updatedPanel = store.getState().studyRecipes.find((entry) => entry.id === panel.id);
    const tab = store.getState().tabs.find((entry) => entry.id === tabId);

    expect(updatedPanel?.linkedSkillNames).toEqual(["lecture-read", "grill-me"]);
    expect(tab?.activeStudySkillNames).toEqual(["grill-me"]);
    expect(draft).toBe("/grill-me\n\nTurn this into a lecture review");
  });

  it("creates a completion suggestion from a panel-originated session", () => {
    const store = new AgentStore(null, "/vault", true);
    const tabId = store.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }
    const panel = createPanel("panel-1", "Summarize this lecture");
    store.setStudyRecipes([panel]);
    store.setActiveStudyPanel(tabId, panel.id, []);
    store.setTabStudyWorkflow(tabId, "lecture");

    const coordinator = createCoordinator(store);
    coordinator.capturePanelSessionOrigin(tabId, "Rewrite this lecture into a drill sheet");
    store.addMessage(tabId, {
      id: "assistant-1",
      kind: "assistant",
      text: "Here is the revised drill sheet.",
      createdAt: 10,
    });
    coordinator.armPanelCompletionSignal(tabId);

    const handled = coordinator.maybeHandlePanelCompletionSignal(tabId, "done");
    const tab = store.getState().tabs.find((entry) => entry.id === tabId);

    expect(handled).toBe(true);
    expect(tab?.chatSuggestion?.status).toBe("pending");
    expect(tab?.chatSuggestion?.canUpdatePanel).toBe(true);
    expect(tab?.messages.at(-1)?.kind).toBe("assistant");
  });

  it("uses the untitled fallback in completion suggestions for blank panel titles", () => {
    const store = new AgentStore(null, "/vault", true);
    const tabId = store.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }
    const panel = { ...createPanel("panel-1", "Summarize this lecture"), title: "" };
    store.setStudyRecipes([panel]);
    store.setActiveStudyPanel(tabId, panel.id, []);
    store.setTabStudyWorkflow(tabId, "lecture");

    const coordinator = createCoordinator(store);
    coordinator.capturePanelSessionOrigin(tabId, "Rewrite this lecture into a drill sheet");
    store.addMessage(tabId, {
      id: "assistant-1",
      kind: "assistant",
      text: "Here is the revised drill sheet.",
      createdAt: 10,
    });
    coordinator.armPanelCompletionSignal(tabId);

    coordinator.maybeHandlePanelCompletionSignal(tabId, "done");

    const tab = store.getState().tabs.find((entry) => entry.id === tabId);
    expect(tab?.chatSuggestion?.panelTitle).toBe("Untitled panel");
    expect(tab?.messages.at(-1)?.text).toContain("Untitled panel");
  });

  it("updates the panel prompt when the chat suggestion is accepted", async () => {
    const store = new AgentStore(null, "/vault", true);
    const tabId = store.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }
    const panel = createPanel("panel-1", "Summarize this lecture");
    store.setStudyRecipes([panel]);
    store.setActiveStudyPanel(tabId, panel.id, []);
    store.setTabStudyWorkflow(tabId, "lecture");

    const coordinator = createCoordinator(store);
    coordinator.capturePanelSessionOrigin(tabId, "Rewrite this lecture into a drill sheet");
    store.addMessage(tabId, {
      id: "assistant-1",
      kind: "assistant",
      text: "Here is the revised drill sheet.",
      createdAt: 10,
    });
    coordinator.armPanelCompletionSignal(tabId);
    coordinator.maybeHandlePanelCompletionSignal(tabId, "done");

    await coordinator.respondToChatSuggestion(tabId, "update_panel");

    const updated = store.getState().studyRecipes.find((entry) => entry.id === panel.id);
    const tab = store.getState().tabs.find((entry) => entry.id === tabId);
    expect(updated?.promptTemplate).toBe("Rewrite this lecture into a drill sheet");
    expect(tab?.chatSuggestion).toBeNull();
  });

  it("redirects promoted skill drafts into the managed vault skill root instead of overwriting external installed skills", async () => {
    const store = new AgentStore(null, "/vault", true);
    const panel = createPanel("panel-1", "Summarize this lecture");
    store.setStudyRecipes([panel]);
    const vaultRoot = await makeTempRoot("codex-noteforge-vault-");
    const externalRoot = await makeTempRoot("codex-noteforge-external-skill-");
    const externalSkillPath = join(externalRoot, "lecture", "SKILL.md");
    await mkdir(join(externalRoot, "lecture"), { recursive: true });
    await writeFile(externalSkillPath, "# External lecture skill\n", "utf8");

    const coordinator = createCoordinator(store, {
      vaultRoot,
      installedSkills: [
        {
          name: "lecture",
          description: "External skill",
          path: externalSkillPath,
        },
      ],
    });

    const draft = coordinator.prepareStudyRecipeSkillDraft(panel.id);

    expect(draft.targetPath).toBe(join(vaultRoot, ".codex", "skills", "lecture", "SKILL.md"));
    expect(draft.mode).toBe("create");
  });

  it("writes promoted skills only into the managed vault skill root and leaves external skill files untouched", async () => {
    const store = new AgentStore(null, "/vault", true);
    const panel = createPanel("panel-1", "Summarize this lecture");
    store.setStudyRecipes([panel]);
    const vaultRoot = await makeTempRoot("codex-noteforge-vault-");
    const externalRoot = await makeTempRoot("codex-noteforge-external-skill-");
    const externalSkillPath = join(externalRoot, "lecture", "SKILL.md");
    await mkdir(join(externalRoot, "lecture"), { recursive: true });
    await writeFile(externalSkillPath, "# External lecture skill\n", "utf8");

    const coordinator = createCoordinator(store, {
      vaultRoot,
      installedSkills: [
        {
          name: "lecture",
          description: "External skill",
          path: externalSkillPath,
        },
      ],
    });

    await coordinator.saveStudyRecipeSkillDraft(panel.id, "# Local lecture skill\nUse this one.\n");

    expect(await readFile(externalSkillPath, "utf8")).toBe("# External lecture skill\n");
    expect(await readFile(join(vaultRoot, ".codex", "skills", "lecture", "SKILL.md"), "utf8")).toContain(
      "# Local lecture skill",
    );
  });

  it("creates new hub panels as blank custom panels", () => {
    const store = new AgentStore(null, "/vault", true);
    const tabId = store.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    const coordinator = createCoordinator(store);
    const panel = coordinator.createHubPanel();
    const tab = store.getState().tabs.find((entry) => entry.id === tabId);

    expect(panel.workflow).toBe("custom");
    expect(panel.title).toBe("");
    expect(panel.description).toBe("");
    expect(panel.promptTemplate).toBe("");
    expect(panel.linkedSkillNames).toEqual([]);
    expect(tab?.activeStudyRecipeId).toBeNull();
  });

  it("clears the tab workflow when applying a custom panel context", () => {
    const store = new AgentStore(null, "/vault", true);
    const tabId = store.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }
    const panel = { ...createPanel("panel-custom", ""), workflow: "custom" as const, title: "", description: "" };
    store.setStudyRecipes([panel]);
    store.setTabStudyWorkflow(tabId, "lecture");

    const coordinator = createCoordinator(store);
    coordinator.applyStudyRecipeContext(tabId, panel);

    const tab = store.getState().tabs.find((entry) => entry.id === tabId);
    expect(tab?.studyWorkflow).toBeNull();
  });
});
