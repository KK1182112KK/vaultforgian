import { describe, expect, it } from "vitest";
import {
  buildStudyWorkflowDraft,
  buildStudyWorkflowRuntimeBrief,
  getStudyWorkflowCatalog,
  getStudyWorkflowComposerPlaceholder,
  getStudyWorkflowDefinition,
  getStudyWorkflowMissingContextHint,
  getStudyWorkflowQuickAction,
} from "../util/studyWorkflows";

describe("studyWorkflows", () => {
  it("exposes the four study workflow entrypoints", () => {
    expect(getStudyWorkflowCatalog().map((entry) => entry.kind)).toEqual(["lecture", "review", "paper", "homework"]);
  });

  it("builds a lecture draft with study context", () => {
    const draft = buildStudyWorkflowDraft("lecture", {
      currentFilePath: "Courses/Signals/Lecture 05.md",
      hasAttachments: true,
      hasSelection: true,
    });

    expect(draft).toContain("Current note: Courses/Signals/Lecture 05.md");
    expect(draft).toContain("A selection is already attached in this conversation.");
    expect(draft).toContain("Attached files are available in this conversation.");
    expect(draft).toContain("Help me study this lecture material.");
    expect(draft).toContain("Key concepts and formulas");
  });

  it("exposes workflow profile details for paper mode", () => {
    const workflow = getStudyWorkflowDefinition("paper");
    expect(workflow.safeAutoSkillRefs).toEqual([]);
    expect(getStudyWorkflowQuickAction("paper")).toBe("Read the attached paper deeply");
    expect(getStudyWorkflowComposerPlaceholder("paper")).toContain("paper");
  });

  it("builds a review draft", () => {
    const draft = buildStudyWorkflowDraft("review", {
    });

    expect(draft).toContain("Help me run a review session over the current study context.");
    expect(draft).toContain("What I should review first");
    expect(draft).toContain("Weak spots or likely forgotten areas");
  });

  it("builds a paper draft", () => {
    const draft = buildStudyWorkflowDraft("paper", {
      currentFilePath: "Papers/Kalman 1960.pdf",
    });

    expect(draft).toContain("Help me read this paper deeply.");
    expect(draft).toContain("Research question and contribution");
    expect(draft).toContain("Important assumptions or limitations");
  });

  it("builds a homework draft", () => {
    const draft = buildStudyWorkflowDraft("homework", {
      hasAttachments: true,
    });

    expect(draft).toContain("Help me work through this homework or problem set.");
    expect(draft).toContain("A solution strategy before calculations");
    expect(draft).toContain("Common mistakes to avoid");
  });

  it("builds a runtime brief with workflow-specific guidance and missing-context hints", () => {
    const brief = buildStudyWorkflowRuntimeBrief("homework", {
      currentFilePath: "courses/control/HW1.md",
      hasSelection: false,
      hasAttachments: false,
      pinnedContextCount: 0,
    });

    expect(brief).toContain("Active study workflow: Homework");
    expect(brief).toContain("Response contract:");
    expect(brief).toContain("A solution strategy before calculations");
    expect(brief).toContain("Highest-value missing context");
    expect(brief).toContain("Capture the exact problem statement");
  });

  it("suppresses review missing-context hints when the workflow already has a grounded scope", () => {
    expect(
      getStudyWorkflowMissingContextHint("review", {
        pinnedContextCount: 2,
      }),
    ).toBeNull();
  });

  it("localizes workflow quick actions and runtime briefs", () => {
    expect(getStudyWorkflowQuickAction("paper", "ja")).toBe("添付した論文を深く読んで");
    expect(getStudyWorkflowComposerPlaceholder("homework", "ja")).toContain("宿題");

    const brief = buildStudyWorkflowRuntimeBrief(
      "lecture",
      {
        currentFilePath: "Courses/Signals/Lecture 05.md",
        hasAttachments: false,
      },
      "ja",
    );

    expect(brief).toContain("現在の study workflow: Lecture");
    expect(brief).toContain("不足していて価値が高い context");
  });
});
