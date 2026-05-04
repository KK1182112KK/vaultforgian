import { describe, expect, it } from "vitest";
import {
  buildSkillOrchestrationPlan,
  classifySkillOrchestrationPhase,
  formatSkillOrchestrationPlanForPrompt,
} from "../util/skillOrchestration";

describe("skillOrchestration", () => {
  it("classifies common workflow skill phases", () => {
    expect(classifySkillOrchestrationPhase({ name: "brainstorming", description: "Generate creative options." })).toBe("brainstorm");
    expect(classifySkillOrchestrationPhase({ name: "writing-plans", description: "Create implementation plans." })).toBe("plan");
    expect(classifySkillOrchestrationPhase({ name: "deep-read", description: "Read source material deeply." })).toBe("source_read");
    expect(classifySkillOrchestrationPhase({ name: "academic-paper", description: "Academic paper writing skill." })).toBe("execute");
    expect(classifySkillOrchestrationPhase({ name: "verification-before-completion", description: "Verify work before completion." })).toBe("verify");
  });

  it("orders selected skills by planning, source, execution, verification, and support phases", () => {
    const plan = buildSkillOrchestrationPlan(
      ["academic-paper", "unknown-helper", "deep-read", "brainstorming", "verification-before-completion", "writing-plans"],
      {
        definitions: [
          { name: "academic-paper", description: "Academic paper writing skill." },
          { name: "unknown-helper", description: "Personal helper." },
          { name: "deep-read", description: "Read source material deeply." },
          { name: "brainstorming", description: "Generate creative options." },
          { name: "verification-before-completion", description: "Verify work before completion." },
          { name: "writing-plans", description: "Create implementation plans." },
        ],
      },
    );

    expect(plan?.selectedSkills).toEqual([
      "academic-paper",
      "unknown-helper",
      "deep-read",
      "brainstorming",
      "verification-before-completion",
      "writing-plans",
    ]);
    expect(plan?.orderedSteps.map((step) => `${step.skillName}:${step.phase}`)).toEqual([
      "brainstorming:brainstorm",
      "writing-plans:plan",
      "deep-read:source_read",
      "academic-paper:execute",
      "verification-before-completion:verify",
      "unknown-helper:support",
    ]);
    expect(plan?.supportingSkillNames).toEqual(["unknown-helper"]);
  });

  it("treats visualizer skills as output skills after source reading", () => {
    expect(classifySkillOrchestrationPhase({ name: "paper-visualizer", description: "Visualize paper concepts." })).toBe("execute");
    expect(classifySkillOrchestrationPhase({ name: "concept-map", description: "Create a concept map diagram." })).toBe("execute");

    const plan = buildSkillOrchestrationPlan(["brainstorming", "paper-visualizer", "lecture-read"], {
      definitions: [
        { name: "brainstorming", description: "Generate options first." },
        { name: "paper-visualizer", description: "Create compact visual maps and diagrams." },
        { name: "lecture-read", description: "Read lecture notes and extract key concepts." },
      ],
    });

    expect(plan?.selectedSkills).toEqual(["brainstorming", "paper-visualizer", "lecture-read"]);
    expect(plan?.orderedSteps.map((step) => `${step.skillName}:${step.phase}`)).toEqual([
      "brainstorming:brainstorm",
      "lecture-read:source_read",
      "paper-visualizer:execute",
    ]);
  });

  it("formats a hidden prompt block without dropping unknown support skills", () => {
    const plan = buildSkillOrchestrationPlan(["unknown-helper"], {
      definitions: [{ name: "unknown-helper", description: "Personal helper." }],
    });

    expect(plan).not.toBeNull();
    expect(formatSkillOrchestrationPlanForPrompt(plan!)).toContain("Skill orchestration plan");
    expect(formatSkillOrchestrationPlanForPrompt(plan!)).toContain("Required skills: $unknown-helper");
    expect(formatSkillOrchestrationPlanForPrompt(plan!)).toContain("$unknown-helper [support]");
  });

  it("keeps required skills even when their score is otherwise low", () => {
    const plan = buildSkillOrchestrationPlan(["odd-required"], {
      prompt: "Summarize this lecture.",
      candidates: [{ name: "odd-required", description: "Unrelated helper.", userOwned: true }],
    });

    expect(plan?.requiredSkillNames).toEqual(["odd-required"]);
    expect(plan?.orderedSteps.map((step) => step.skillName)).toContain("odd-required");
    expect(plan?.candidateScores.find((score) => score.skillName === "odd-required")?.required).toBe(true);
  });

  it("does not auto-select low-confidence candidates", () => {
    const plan = buildSkillOrchestrationPlan([], {
      prompt: "Say hello.",
      candidates: [{ name: "quiet-helper", description: "Unrelated helper.", userOwned: true }],
    });

    expect(plan).toBeNull();
  });

  it("auto-selects high-confidence user-owned panel memory matches", () => {
    const plan = buildSkillOrchestrationPlan([], {
      prompt: "Review the frequency response homework and explain the phase issue.",
      panelWorkflow: "review",
      weakConceptLabels: ["frequency response phase magnitude"],
      candidates: [
        {
          name: "bode-drill",
          description: "Practice frequency response phase magnitude drills for review.",
          userOwned: true,
          panelPreferred: true,
        },
      ],
    });

    expect(plan?.autoSelectedSkillNames).toEqual(["bode-drill"]);
    expect(plan?.requiredSkillNames).toEqual([]);
    expect(formatSkillOrchestrationPlanForPrompt(plan!)).toContain("Auto-selected skills: $bode-drill");
  });

  it("does not auto-select plugin-cache skills unless they are required", () => {
    const pluginCandidate = {
      name: "superpowers:brainstorming",
      description: "Brainstorm creative options before work.",
      userOwned: false,
    };

    const autoPlan = buildSkillOrchestrationPlan([], {
      prompt: "Brainstorm options for this panel.",
      candidates: [pluginCandidate],
    });
    expect(autoPlan).toBeNull();

    const requiredPlan = buildSkillOrchestrationPlan(["superpowers:brainstorming"], {
      prompt: "Brainstorm options for this panel.",
      candidates: [pluginCandidate],
    });
    expect(requiredPlan?.requiredSkillNames).toEqual(["superpowers:brainstorming"]);
    expect(requiredPlan?.autoSelectedSkillNames).toEqual([]);
    expect(requiredPlan?.orderedSteps.map((step) => step.skillName)).toContain("superpowers:brainstorming");
  });
});
