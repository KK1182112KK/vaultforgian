import { describe, expect, it } from "vitest";
import { buildStudyLayerPromptOverlay, isStudyLayerActiveForTurn } from "../agent/study/studyLayer";
import { buildTurnPrompt } from "../app/turnPrompt";
import type { TurnContextSnapshot } from "../model/types";

function createContext(overrides: Partial<TurnContextSnapshot> = {}): TurnContextSnapshot {
  return {
    activeFilePath: "Notes/Active.md",
    targetNotePath: null,
    studyWorkflow: null,
    studyCoachText: null,
    userAdaptationText: null,
    conversationSummaryText: null,
    sourceAcquisitionMode: "workspace_generic",
    sourceAcquisitionContractText: null,
    workflowText: null,
    pluginFeatureText: null,
    paperStudyRuntimeOverlayText: null,
    skillGuideText: null,
    paperStudyGuideText: null,
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

describe("StudyLayer prompt overlays", () => {
  it("does not attach study coaching when no study layer signal is active", () => {
    const context = createContext();

    expect(isStudyLayerActiveForTurn(context)).toBe(false);
    expect(buildStudyLayerPromptOverlay({
      prompt: "Explain Fourier transforms.",
      context,
      composeMode: "chat",
      allowVaultWrite: false,
      learningMode: true,
      skillNames: [],
      mode: "normal",
    }).instructions).toEqual([]);

    const prompt = buildTurnPrompt("Explain Fourier transforms.", context, "normal", [], "chat", false, "manual", {
      learningMode: true,
    });
    expect(prompt).not.toContain("obsidian-study-checkpoint");
    expect(prompt).not.toContain("obsidian-study-contract");
    expect(prompt).not.toContain("Learning mode is active for this tab.");
  });

  it("keeps current study workflow, coach, and checkpoint guidance when study is active", () => {
    const context = createContext({
      studyWorkflow: "review",
      workflowText: "Active study workflow: Review\nResponse contract:",
      studyCoachText: "Study coach carry-forward:\n- Weak point: convolution.",
    });
    const overlay = buildStudyLayerPromptOverlay({
      prompt: "Continue helping me review.",
      context,
      composeMode: "chat",
      allowVaultWrite: false,
      learningMode: true,
      skillNames: [],
      mode: "normal",
    });

    expect(isStudyLayerActiveForTurn(context)).toBe(true);
    expect(overlay.statusLines).toContain("Active study workflow: review");
    expect(overlay.instructions.join("\n")).toContain("Learning mode is active for this tab.");
    expect(overlay.instructions.join("\n")).toContain("obsidian-study-contract");
    expect(overlay.instructions.join("\n")).toContain("Do not show the contract JSON");
    expect(overlay.blocks).toContain("Study coach carry-forward:\n- Weak point: convolution.");
  });

  it("adds contract guidance for explicit study workflow turns even when learning mode is off", () => {
    const context = createContext({
      studyWorkflow: "homework",
      workflowText: "Active study workflow: Homework\nResponse contract:",
    });
    const overlay = buildStudyLayerPromptOverlay({
      prompt: "Help me understand this homework formula.",
      context,
      composeMode: "chat",
      allowVaultWrite: false,
      learningMode: false,
      skillNames: [],
      mode: "normal",
    });

    expect(overlay.instructions.join("\n")).toContain("obsidian-study-contract");
    expect(overlay.learningModeActive).toBe(false);
  });

  it("keeps paper-study overlays in the study layer", () => {
    const context = createContext({
      studyWorkflow: "paper",
      paperStudyRuntimeOverlayText: "Paper-study runtime overlay:\n- SOURCE INGESTION IS CLOSED.",
      paperStudyGuideText: "Paper study guide\n- Separate claims from interpretation.",
    });
    const overlay = buildStudyLayerPromptOverlay({
      prompt: "Read this paper.",
      context,
      composeMode: "chat",
      allowVaultWrite: false,
      learningMode: false,
      skillNames: ["deep-read"],
      mode: "skill",
    });

    expect(overlay.instructions.join("\n")).toContain("A paper-study runtime overlay is attached for this turn.");
    expect(overlay.instructions.join("\n")).toContain("A paper-study guide is attached for this turn.");
    expect(overlay.blocks).toContain("Paper-study runtime overlay:\n- SOURCE INGESTION IS CLOSED.");
    expect(overlay.blocks).toContain("Paper study guide\n- Separate claims from interpretation.");
  });
});
