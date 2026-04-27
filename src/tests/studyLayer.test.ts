import { describe, expect, it } from "vitest";
import type { StudyTurnPlan } from "../agent/study/studyTurnPlanner";
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

const STUDY_TURN_PLAN: StudyTurnPlan = {
  objective: "Review frequency response from the learner's weak concept.",
  teachingMode: "coach",
  focusConcepts: ["frequency response"],
  likelyStuckPoint: "Phase interpretation is unclear.",
  sourceStrategy: "continue_from_memory",
  checkQuestion: "What changes when only phase shifts?",
  nextAction: "Try one Bode plot classification problem.",
  recommendedSkills: [{ name: "bode-drill", reason: "Matches the weak concept." }],
  panelSignals: [{ kind: "skill", label: "bode-drill", reason: "Repeated weak concept match." }],
  visibleReplyGuidance: "Keep the answer short and natural; include at most one check question and at most one next action.",
};

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
      studyTurnPlan: STUDY_TURN_PLAN,
    });

    expect(isStudyLayerActiveForTurn(context)).toBe(true);
    expect(overlay.statusLines).toContain("Active study workflow: review");
    expect(overlay.instructions.join("\n")).toContain("Learning mode is active for this tab.");
    expect(overlay.instructions.join("\n")).toContain("obsidian-study-contract");
    expect(overlay.instructions.join("\n")).toContain("Do not show the contract JSON");
    expect(overlay.instructions.join("\n")).toContain("Do not show the StudyTurnPlan");
    expect(overlay.instructions.join("\n")).toContain("at most one understanding-check question");
    expect(overlay.blocks.join("\n")).toContain("StudyTurnPlan");
    expect(overlay.blocks.join("\n")).toContain("frequency response");
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
      studyTurnPlan: {
        ...STUDY_TURN_PLAN,
        objective: "Read the paper from attached source text.",
        teachingMode: "source_check",
        sourceStrategy: "use_attachment",
      },
    });

    expect(overlay.instructions.join("\n")).toContain("A paper-study runtime overlay is attached for this turn.");
    expect(overlay.instructions.join("\n")).toContain("A paper-study guide is attached for this turn.");
    expect(overlay.blocks).toContain("Paper-study runtime overlay:\n- SOURCE INGESTION IS CLOSED.");
    expect(overlay.blocks).toContain("Paper study guide\n- Separate claims from interpretation.");
  });

  it("does not inject planner guidance for note edit turns even when study context exists", () => {
    const context = createContext({
      studyWorkflow: "review",
      workflowText: "Active study workflow: Review\nResponse contract:",
      studyCoachText: "Study coach carry-forward:\n- Weak point: convolution.",
    });

    const prompt = buildTurnPrompt("Improve this note.", context, "normal", [], "chat", true, "approval", {
      learningMode: true,
      studyTurnPlan: STUDY_TURN_PLAN,
      turnIntentKind: "note_edit",
    });

    expect(prompt).not.toContain("StudyTurnPlan");
    expect(prompt).not.toContain("at most one understanding-check question");
    expect(prompt).toContain("obsidian-patch");
  });
});
