import { describe, expect, it } from "vitest";
import { TFile } from "obsidian";
import { AgentContextAssembler } from "../agent/core/agentContextAssembler";
import { getLocalizedCopy } from "../util/i18n";

function createFile(path: string): TFile {
  return Object.assign(new TFile(), { path }) as TFile;
}

describe("AgentContextAssembler", () => {
  it("assembles a legacy-compatible turn context and generic context bundle", async () => {
    const activeFile = createFile("Notes/Active.md");
    const assembler = new AgentContextAssembler({
      getLocale: () => "en",
      getLocalizedCopy: () => getLocalizedCopy("en"),
      findDailyNotePath: async () => "daily/2026-04-26.md",
      findTab: () => ({
        selectionContext: { text: "Selected text", sourcePath: "Notes/Active.md", createdAt: 1 },
        studyWorkflow: "review",
        activeStudyRecipeId: null,
        studyCoachState: null,
        activeStudySkillNames: [],
        summary: null,
        lineage: {
          parentTabId: null,
          forkedFromThreadId: null,
          resumedFromThreadId: null,
          compactedAt: null,
          pendingThreadReset: false,
        },
      }),
      resolveTargetNotePath: () => "Notes/Target.md",
      getActivePanelId: () => null,
      getHubPanels: () => [],
      getStudyHubState: () => ({ isCollapsed: false }),
      buildWorkflowPromptContext: () => ({
        currentFilePath: "Notes/Active.md",
        targetNotePath: "Notes/Target.md",
        hasAttachments: false,
        hasSelection: true,
        pinnedContextCount: 0,
      }),
      captureContextPackText: async () => "Pinned context notes",
      captureVaultNoteSourcePackText: async () => "Vault note source pack",
      resolveVaultRoot: () => "/vault",
      buildStudyCoachCarryForwardText: () => "Study coach carry-forward",
      getUserAdaptationMemory: () => null,
    });

    const result = await assembler.assembleTurnContext({
      tabId: "tab-1",
      file: activeFile,
      prompt: "Help me review.",
      slashCommand: null,
      attachments: [],
      mentionContextText: "Mentioned note: Notes/Target.md",
      explicitTargetNotePath: "Notes/Target.md",
      mentionSkillNames: ["deep-read"],
      mentionSourcePathHints: ["/sources"],
      workingDirectoryHint: "/sources",
      skillNames: [],
      resolvedSkillDefinitions: [],
    });

    expect(result.context.targetNotePath).toBe("Notes/Target.md");
    expect(result.context.studyWorkflow).toBe("review");
    expect(result.context.contextPackText).toBe("Pinned context notes");
    expect(result.context.noteSourcePackText).toBe("Vault note source pack");
    expect(result.bundle.targetNote?.path).toBe("Notes/Target.md");
    expect(result.bundle.mentions.skillNames).toEqual(["deep-read"]);
    expect(result.bundle.sourceAcquisition.mode).toBe("vault_note");
  });
});
