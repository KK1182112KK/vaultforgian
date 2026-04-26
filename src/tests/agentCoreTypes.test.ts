import { describe, expect, it, vi } from "vitest";
import type { TurnContextSnapshot } from "../model/types";
import {
  agentContextBundleFromTurnContext,
  createAgentArtifacts,
  type AgentArtifact,
  type AgentRuntime,
  type AgentTurnRequest,
} from "../agent/core/types";
import { AgentTurnRunner } from "../agent/core/agentTurnRunner";

function createContext(overrides: Partial<TurnContextSnapshot> = {}): TurnContextSnapshot {
  return {
    activeFilePath: "Notes/Active.md",
    targetNotePath: "Notes/Target.md",
    studyWorkflow: null,
    studyCoachText: null,
    userAdaptationText: null,
    conversationSummaryText: null,
    sourceAcquisitionMode: "vault_note",
    sourceAcquisitionContractText: "Source acquisition contract",
    workflowText: null,
    pluginFeatureText: null,
    paperStudyRuntimeOverlayText: null,
    skillGuideText: null,
    paperStudyGuideText: null,
    mentionContextText: "Mentioned note: Notes/Target.md",
    selection: "Selected text",
    selectionSourcePath: "Notes/Active.md",
    vaultRoot: "/vault",
    dailyNotePath: "daily/2026-04-26.md",
    contextPackText: "Pinned context notes",
    attachmentManifestText: "Attached files and images",
    attachmentContentText: null,
    noteSourcePackText: "Vault note source pack",
    attachmentMissingPdfTextNames: [],
    attachmentMissingSourceNames: [],
    ...overrides,
  };
}

function createTurnRequest(overrides: Partial<AgentTurnRequest> = {}): AgentTurnRequest {
  return {
    tabId: "tab-1",
    visiblePrompt: "Explain this.",
    executionPrompt: "Explain this.",
    prompt: "Prompt sent to runtime",
    mode: "normal",
    composeMode: "chat",
    threadId: null,
    workingDirectory: "/vault",
    runtime: "native",
    executablePath: "codex",
    launcherOverrideParts: undefined,
    model: "gpt-5.5",
    reasoningEffort: "xhigh",
    permissionProfile: {
      sandboxMode: "read-only",
      approvalPolicy: "untrusted",
    },
    images: [],
    contextBundle: agentContextBundleFromTurnContext(createContext()),
    capabilities: [],
    fastMode: false,
    signal: new AbortController().signal,
    watchdogRecoveryAttempted: false,
    ...overrides,
  };
}

describe("agent core boundaries", () => {
  it("maps the legacy turn context into a generic context bundle", () => {
    const bundle = agentContextBundleFromTurnContext(createContext());

    expect(bundle.activeNote?.path).toBe("Notes/Active.md");
    expect(bundle.targetNote?.path).toBe("Notes/Target.md");
    expect(bundle.selection?.text).toBe("Selected text");
    expect(bundle.pinnedContext.text).toContain("Pinned context notes");
    expect(bundle.mentions.text).toContain("Mentioned note");
    expect(bundle.sourceAcquisition.mode).toBe("vault_note");
    expect(bundle.legacy.studyWorkflow).toBeNull();
  });

  it("normalizes parsed assistant proposals into agent artifacts", () => {
    const artifacts = createAgentArtifacts({
      displayText: "",
      sanitizedDisplayText: "",
      patches: [{ sourceIndex: 0, targetPath: "Notes/A.md", kind: "update", summary: "Update", proposedText: "A" }],
      ops: [{ sourceIndex: 1, kind: "rename", targetPath: "Notes/A.md", destinationPath: "Notes/B.md", summary: "Rename" }],
      plan: { status: "ready_to_implement", summary: "Plan" },
      suggestion: { kind: "rewrite_followup", summary: "Rewrite", question: "Apply?" },
      diagrams: [
        {
          sourceIndex: 2,
          title: "Diagram",
          alt: "A diagram",
          insertMode: "auto",
          svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"></svg>',
        },
      ],
      studyCheckpoint: {
        workflow: "lecture",
        mastered: ["A"],
        unclear: [],
        nextStep: "B",
        confidenceNote: "C",
      },
      hasProposalMarkers: true,
      hasMalformedProposal: false,
    });

    expect(artifacts.map((artifact: AgentArtifact) => artifact.kind)).toEqual([
      "obsidian-patch",
      "obsidian-ops",
      "obsidian-diagram",
      "obsidian-plan",
      "obsidian-suggest",
      "obsidian-study-checkpoint",
    ]);
  });

  it("runs turns through the generic runtime boundary", async () => {
    const runtime: AgentRuntime = {
      run: vi.fn(async (request) => {
        request.onSessionId("thread-1");
        request.onJsonEvent({ type: "thread.started", thread_id: "thread-1" });
        request.onMeaningfulProgress(10);
        return { threadId: "thread-1" };
      }),
    };
    const runner = new AgentTurnRunner({ runtime });
    const onSessionId = vi.fn();
    const onJsonEvent = vi.fn();
    const onMeaningfulProgress = vi.fn();

    const result = await runner.run(createTurnRequest(), {
      onSessionId,
      onJsonEvent,
      onLiveness: vi.fn(),
      onMeaningfulProgress,
      onWatchdogStageChange: vi.fn(),
    });

    expect(result.threadId).toBe("thread-1");
    expect(runtime.run).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-5.5",
      permissionProfile: { sandboxMode: "read-only", approvalPolicy: "untrusted" },
      contextBundle: expect.objectContaining({ vaultRoot: "/vault" }),
    }));
    expect(onSessionId).toHaveBeenCalledWith("thread-1");
    expect(onJsonEvent).toHaveBeenCalledWith({ type: "thread.started", thread_id: "thread-1" });
    expect(onMeaningfulProgress).toHaveBeenCalledWith(10);
  });
});
