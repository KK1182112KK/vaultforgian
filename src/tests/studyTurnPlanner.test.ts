import { describe, expect, it } from "vitest";
import { buildStudyTurnPlan } from "../agent/study/studyTurnPlanner";
import type { PanelStudyMemory, StudyRecipe, UserStudyMemory } from "../model/types";

const REVIEW_PANEL: StudyRecipe = {
  id: "panel-review",
  title: "Review",
  description: "Review weak concepts and assign follow-up drills.",
  commandAlias: "/recipe-review",
  workflow: "review",
  promptTemplate: "Continue review from weak points.",
  linkedSkillNames: ["review-coach"],
  contextContract: {
    summary: "Use memory before asking for more sources.",
    requireTargetNote: false,
    recommendAttachments: false,
    requireSelection: false,
    minimumPinnedContextCount: 0,
  },
  outputContract: ["Explain", "Check understanding"],
  sourceHints: ["current note"],
  exampleSession: {
    sourceTabTitle: "Study chat",
    targetNotePath: null,
    prompt: "Review this",
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

const REVIEW_MEMORY: PanelStudyMemory = {
  weakConcepts: [
    {
      conceptLabel: "frequency response",
      evidence: "Still mixes magnitude and phase.",
      lastStuckPoint: "Phase interpretation is unclear.",
      nextQuestion: "What changes when only phase shifts?",
      workflow: "review",
      updatedAt: 10,
    },
  ],
  understoodConcepts: [],
  nextProblems: [
    {
      prompt: "Classify whether a Bode plot change is magnitude or phase.",
      workflow: "review",
      source: "Signals lecture",
      createdAt: 11,
    },
  ],
  recentStuckPoints: [],
  sourcePreferences: [],
  lastContract: null,
  improvementSignals: [],
};

describe("StudyTurnPlanner", () => {
  it("coaches review turns from panel weak concepts before generic explanation", () => {
    const plan = buildStudyTurnPlan({
      prompt: "Continue review",
      activePanel: REVIEW_PANEL,
      panelMemory: REVIEW_MEMORY,
      globalStudyMemory: null,
      studyCoachState: null,
      turnIntent: { kind: "answer_only" },
      preflight: {
        ready: true,
        summary: "Ready",
        missing: [],
        advisories: [],
        sourceStrategy: "continue_from_memory",
        autoContextAdditions: [{ kind: "weak_concept", text: "Weak concept: frequency response" }],
        suggestedSkills: [],
      },
      selectedSkillNames: ["review-coach"],
      availableSkills: [
        { name: "generic", description: "Generic study help.", path: "/skills/generic/SKILL.md" },
        { name: "bode-drill", description: "Practice Bode plot phase and magnitude drills.", path: "/skills/bode-drill/SKILL.md" },
      ],
      sourceState: {
        hasAttachmentContent: false,
        hasNoteSourcePack: false,
        hasSelection: false,
      },
      learningMode: true,
    });

    expect(plan.teachingMode).toBe("coach");
    expect(plan.sourceStrategy).toBe("continue_from_memory");
    expect(plan.focusConcepts).toEqual(["frequency response"]);
    expect(plan.likelyStuckPoint).toBe("Phase interpretation is unclear.");
    expect(plan.checkQuestion).toBe("What changes when only phase shifts?");
    expect(plan.nextAction).toContain("Bode plot");
    expect(plan.recommendedSkills.map((skill) => skill.name)).toEqual(["bode-drill", "generic"]);
    expect(plan.learningCoachPlan?.mode).toBe("hint_first");
    expect(plan.learningCoachPlan?.hintLevel).toBe("nudge");
    expect(plan.learningCoachPlan?.focusConcept).toBe("frequency response");
  });

  it("uses hint-first coaching as the default learning mode shape", () => {
    const plan = buildStudyTurnPlan({
      prompt: "Help me study this theorem.",
      activePanel: REVIEW_PANEL,
      panelMemory: null,
      globalStudyMemory: null,
      studyCoachState: null,
      turnIntent: { kind: "answer_only" },
      preflight: {
        ready: true,
        summary: "Ready",
        missing: [],
        advisories: [],
        sourceStrategy: "use_note",
        autoContextAdditions: [],
        suggestedSkills: [],
      },
      selectedSkillNames: [],
      availableSkills: [],
      sourceState: {
        hasAttachmentContent: false,
        hasNoteSourcePack: true,
        hasSelection: false,
      },
      learningMode: true,
    });

    expect(plan.learningCoachPlan).toEqual(
      expect.objectContaining({
        mode: "hint_first",
        hintLevel: "nudge",
        answerPolicy: "hint_first",
      }),
    );
    expect(plan.learningCoachPlan?.scaffoldSteps).toHaveLength(1);
  });

  it("escalates unknown learner responses to guided or worked-step support", () => {
    const plan = buildStudyTurnPlan({
      prompt: "I don't know",
      activePanel: REVIEW_PANEL,
      panelMemory: REVIEW_MEMORY,
      globalStudyMemory: null,
      studyCoachState: {
        latestRecap: null,
        weakPointLedger: [],
        lastCheckpointAt: null,
        consecutiveStuckCount: 1,
        lastHintLevel: "guided",
      },
      turnIntent: { kind: "answer_only" },
      preflight: {
        ready: true,
        summary: "Ready",
        missing: [],
        advisories: [],
        sourceStrategy: "continue_from_memory",
        autoContextAdditions: [],
        suggestedSkills: [],
      },
      selectedSkillNames: [],
      availableSkills: [],
      sourceState: {
        hasAttachmentContent: false,
        hasNoteSourcePack: true,
        hasSelection: false,
      },
      learningMode: true,
    });

    expect(plan.learningCoachPlan?.mode).toBe("scaffold");
    expect(plan.learningCoachPlan?.hintLevel).toBe("worked_step");
    expect(plan.learningCoachPlan?.focusConcept).toBe("frequency response");
    expect(plan.learningCoachPlan?.stuckPoint).toBe("Phase interpretation is unclear.");
  });

  it("uses direct-answer coach mode only when the user asks for it", () => {
    const plan = buildStudyTurnPlan({
      prompt: "Just give me the answer: what is the hypotenuse?",
      activePanel: REVIEW_PANEL,
      panelMemory: null,
      globalStudyMemory: null,
      studyCoachState: null,
      turnIntent: { kind: "answer_only" },
      preflight: {
        ready: true,
        summary: "Ready",
        missing: [],
        advisories: [],
        sourceStrategy: "use_note",
        autoContextAdditions: [],
        suggestedSkills: [],
      },
      selectedSkillNames: [],
      availableSkills: [],
      sourceState: {
        hasAttachmentContent: false,
        hasNoteSourcePack: true,
        hasSelection: false,
      },
      learningMode: true,
    });

    expect(plan.learningCoachPlan?.mode).toBe("direct_answer");
    expect(plan.learningCoachPlan?.answerPolicy).toBe("answer_first");
    expect(plan.learningCoachPlan?.hintLevel).toBe("worked_step");
  });

  it("asks for the problem source instead of solving when homework lacks problem text", () => {
    const plan = buildStudyTurnPlan({
      prompt: "help me with homework",
      activePanel: { ...REVIEW_PANEL, id: "panel-homework", workflow: "homework", linkedSkillNames: [] },
      panelMemory: null,
      globalStudyMemory: null,
      studyCoachState: null,
      turnIntent: { kind: "answer_only" },
      preflight: {
        ready: true,
        summary: "Ask for the problem statement before solving if it is missing",
        missing: [],
        advisories: ["Ask for the problem statement before solving if it is missing"],
        sourceStrategy: "ask_for_source",
        autoContextAdditions: [],
        suggestedSkills: [],
      },
      selectedSkillNames: [],
      availableSkills: [],
      sourceState: {
        hasAttachmentContent: false,
        hasNoteSourcePack: false,
        hasSelection: false,
      },
      learningMode: true,
    });

    expect(plan.teachingMode).toBe("ask_for_source");
    expect(plan.sourceStrategy).toBe("ask_for_source");
    expect(plan.visibleReplyGuidance).toContain("ask one short source question");
    expect(plan.nextAction).toContain("problem statement");
  });

  it("uses attachments as the source strategy for paper panels with PDFs", () => {
    const plan = buildStudyTurnPlan({
      prompt: "Read this paper",
      activePanel: { ...REVIEW_PANEL, id: "panel-paper", workflow: "paper", linkedSkillNames: ["deep-read"] },
      panelMemory: null,
      globalStudyMemory: null,
      studyCoachState: null,
      turnIntent: { kind: "answer_only" },
      preflight: {
        ready: true,
        summary: "Ready",
        missing: [],
        advisories: [],
        sourceStrategy: "use_attachment",
        autoContextAdditions: [],
        suggestedSkills: [],
      },
      selectedSkillNames: ["deep-read"],
      availableSkills: [],
      sourceState: {
        hasAttachmentContent: true,
        hasNoteSourcePack: false,
        hasSelection: false,
      },
      learningMode: false,
    });

    expect(plan.teachingMode).toBe("source_check");
    expect(plan.sourceStrategy).toBe("use_attachment");
    expect(plan.objective).toContain("paper");
  });

  it("falls back to global study memory when no panel is active", () => {
    const globalStudyMemory: UserStudyMemory = {
      weakConcepts: [
        {
          conceptLabel: "Laplace transform setup",
          evidence: "Needs another setup pass.",
          lastStuckPoint: "Initial condition placement is unclear.",
          nextQuestion: "Where does the initial condition enter?",
          workflow: "lecture",
          updatedAt: 12,
        },
      ],
      understoodConcepts: [],
      nextProblems: [],
      recentStuckPoints: [],
    };

    const plan = buildStudyTurnPlan({
      prompt: "Continue",
      activePanel: null,
      panelMemory: null,
      globalStudyMemory,
      studyCoachState: null,
      turnIntent: { kind: "answer_only" },
      preflight: null,
      selectedSkillNames: [],
      availableSkills: [],
      sourceState: {
        hasAttachmentContent: false,
        hasNoteSourcePack: false,
        hasSelection: false,
      },
      learningMode: true,
    });

    expect(plan.teachingMode).toBe("coach");
    expect(plan.focusConcepts).toEqual(["Laplace transform setup"]);
    expect(plan.checkQuestion).toBe("Where does the initial condition enter?");
  });

  it("keeps an active quiz session in quiz mode even after an unknown answer", () => {
    const plan = buildStudyTurnPlan({
      prompt: "I don't know",
      activePanel: REVIEW_PANEL,
      panelMemory: null,
      globalStudyMemory: null,
      studyCoachState: {
        latestRecap: null,
        weakPointLedger: [],
        lastCheckpointAt: null,
        quizSession: {
          id: "quiz-1",
          total: 5,
          currentIndex: 1,
          answeredCount: 0,
          status: "active",
          questions: [],
          startedAt: 1,
          updatedAt: 2,
          lastUserResponseKind: "unknown",
        },
      },
      turnIntent: { kind: "answer_only" },
      preflight: {
        ready: true,
        summary: "Ready",
        missing: [],
        advisories: [],
        sourceStrategy: "use_note",
        autoContextAdditions: [],
        suggestedSkills: [],
      },
      selectedSkillNames: [],
      availableSkills: [],
      sourceState: {
        hasAttachmentContent: false,
        hasNoteSourcePack: true,
        hasSelection: false,
      },
      learningMode: true,
    });

    expect(plan.teachingMode).toBe("quiz");
    expect(plan.learningCoachPlan?.mode).toBe("quiz");
    expect(plan.learningCoachPlan?.hintLevel).toBe("guided");
    expect(plan.learningCoachPlan?.answerPolicy).toBe("hint_first");
  });

  it("uses question-first policy for fresh active quiz prompts", () => {
    const plan = buildStudyTurnPlan({
      prompt: "quiz me on this note",
      activePanel: REVIEW_PANEL,
      panelMemory: null,
      globalStudyMemory: null,
      studyCoachState: {
        latestRecap: null,
        weakPointLedger: [],
        lastCheckpointAt: null,
        quizSession: {
          id: "quiz-1",
          total: 5,
          currentIndex: 1,
          answeredCount: 0,
          status: "active",
          questions: [],
          startedAt: 1,
          updatedAt: 2,
          lastUserResponseKind: "start",
        },
      },
      turnIntent: { kind: "answer_only" },
      preflight: {
        ready: true,
        summary: "Ready",
        missing: [],
        advisories: [],
        sourceStrategy: "use_note",
        autoContextAdditions: [],
        suggestedSkills: [],
      },
      selectedSkillNames: [],
      availableSkills: [],
      sourceState: {
        hasAttachmentContent: false,
        hasNoteSourcePack: true,
        hasSelection: false,
      },
      learningMode: true,
    });

    expect(plan.teachingMode).toBe("quiz");
    expect(plan.learningCoachPlan?.mode).toBe("quiz");
    expect(plan.learningCoachPlan?.answerPolicy).toBe("question_first");
    expect(plan.visibleReplyGuidance).toContain("question first");
  });
});
