import { describe, expect, it } from "vitest";
import { CodexService } from "../app/codexService";
import { DEFAULT_SETTINGS, type TurnContextSnapshot } from "../model/types";

function createApp(basePath: string) {
  return {
    vault: {
      adapter: { basePath },
      getAbstractFileByPath: () => null,
    },
    workspace: {
      getActiveFile: () => null,
      getMostRecentLeaf: () => null,
    },
    metadataCache: {
      resolvedLinks: {},
      unresolvedLinks: {},
    },
  } as never;
}

function createContext(overrides: Partial<TurnContextSnapshot> = {}): TurnContextSnapshot {
  return {
    activeFilePath: "Notes/Test.md",
    targetNotePath: "Notes/Test.md",
    studyWorkflow: null,
    conversationSummaryText: null,
    sourceAcquisitionMode: "workspace_generic",
    sourceAcquisitionContractText: null,
    workflowText: null,
    pluginFeatureText: null,
    paperStudyRuntimeOverlayText: null,
    skillGuideText: null,
    paperStudyGuideText: null,
    instructionText: null,
    mentionContextText: null,
    selection: null,
    selectionSourcePath: null,
    vaultRoot: "/vault",
    dailyNotePath: null,
    contextPackText: null,
    attachmentManifestText: null,
    attachmentContentText: null,
    noteSourcePackText: null,
    attachmentMissingPdfTextNames: [],
    attachmentMissingSourceNames: [],
    ...overrides,
  };
}

describe("CodexService proposal repair", () => {
  it("repairs future-tense patch promises into an immediate obsidian-patch retry", () => {
    const service = new CodexService(createApp("/vault"), () => DEFAULT_SETTINGS, () => "en", null, async () => {}, async () => {});
    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing active tab");
    }

    service.store.addMessage(tabId, {
      id: "assistant-1",
      kind: "assistant",
      text: "I will return a patch in the next reply.",
      createdAt: 1,
    });

    const candidate = (
      service as unknown as {
        getProposalRepairCandidate: (
          targetTabId: string,
          newAssistantMessageIds: ReadonlySet<string>,
        ) => { message: { text: string }; parsed: { sanitizedDisplayText: string }; reason: string } | null;
      }
    ).getProposalRepairCandidate(tabId, new Set(["assistant-1"]));

    expect(candidate?.reason).toBe("promise_without_block");

    const prompt = (
      service as unknown as {
        buildProposalRepairPrompt: (
          context: TurnContextSnapshot,
          message: { text: string },
          parsed: { sanitizedDisplayText: string },
          reason: string,
        ) => string;
      }
    ).buildProposalRepairPrompt(createContext(), candidate!.message, candidate!.parsed, candidate!.reason);

    expect(prompt).toContain("announced a note patch");
    expect(prompt).toContain("Emit the patch NOW");
    expect(prompt).toContain("Output exactly one fenced ```obsidian-patch``` block");
  });
});
