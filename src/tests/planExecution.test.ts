import { describe, expect, it } from "vitest";
import { resolveEffectiveExecutionState } from "../util/planExecution";

describe("plan execution state", () => {
  it("keeps plan mode read-only when YOLO is off", () => {
    const result = resolveEffectiveExecutionState({
      composeMode: "plan",
      permissionMode: "auto-edit",
      status: "ready",
      chatSuggestion: null,
    });

    expect(result.effectivePermissionState).toBe("planning");
    expect(result.planImplementationArmed).toBe(false);
    expect(result.showPlanYoloWarning).toBe(false);
    expect(result.canImplementReadyPlan).toBe(false);
  });

  it("arms plan mode when YOLO is on and enables Implement now for ready signals", () => {
    const result = resolveEffectiveExecutionState({
      composeMode: "plan",
      permissionMode: "full-auto",
      status: "ready",
      chatSuggestion: {
        id: "suggestion-1",
        kind: "plan_execute",
        status: "pending",
        messageId: "message-1",
        panelId: null,
        panelTitle: null,
        promptSnapshot: "",
        matchedSkillName: null,
        canUpdatePanel: false,
        canSaveCopy: false,
        planSummary: "Implement the approved refactor.",
        planStatus: "ready_to_implement",
        createdAt: 1,
      },
    });

    expect(result.effectivePermissionState).toBe("armed");
    expect(result.planImplementationArmed).toBe(true);
    expect(result.showPlanYoloWarning).toBe(true);
    expect(result.canImplementReadyPlan).toBe(true);
  });
});

