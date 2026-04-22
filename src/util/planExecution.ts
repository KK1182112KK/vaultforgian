import type { AgentStatus, ChatSuggestion, ComposeMode } from "../model/types";
import type { PermissionMode } from "./permissionMode";

export type EffectiveExecutionState = "planning" | "armed" | "editing" | "assisted" | "read_only";

export interface EffectiveExecutionStateResult {
  yoloConfigured: boolean;
  effectivePermissionState: EffectiveExecutionState;
  planImplementationArmed: boolean;
  showPlanYoloWarning: boolean;
  canImplementReadyPlan: boolean;
}

export function resolveEffectiveExecutionState(params: {
  composeMode: ComposeMode;
  permissionMode: PermissionMode;
  status: AgentStatus | null;
  chatSuggestion: ChatSuggestion | null;
}): EffectiveExecutionStateResult {
  const { chatSuggestion, composeMode, permissionMode, status: _status } = params;
  const yoloConfigured = permissionMode === "full-auto";
  const planImplementationArmed = composeMode === "plan" && yoloConfigured;
  const showPlanYoloWarning = planImplementationArmed;
  const canImplementReadyPlan =
    planImplementationArmed &&
    chatSuggestion?.kind === "plan_execute" &&
    chatSuggestion.status === "pending" &&
    chatSuggestion.planStatus === "ready_to_implement";

  if (composeMode === "plan") {
    return {
      yoloConfigured,
      effectivePermissionState: yoloConfigured ? "armed" : "planning",
      planImplementationArmed,
      showPlanYoloWarning,
      canImplementReadyPlan,
    };
  }

  return {
    yoloConfigured,
    effectivePermissionState:
      permissionMode === "full-auto" ? "editing" : permissionMode === "auto-edit" ? "assisted" : "read_only",
    planImplementationArmed: false,
    showPlanYoloWarning: false,
    canImplementReadyPlan: false,
  };
}
