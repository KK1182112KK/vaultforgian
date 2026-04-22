import type { ChatMessage, PendingApproval, ToolActivityKind, ToolCallRecord, WaitingState, WorkspaceState } from "../model/types";

export type TranscriptEntry =
  | { type: "message"; createdAt: number; message: ChatMessage }
  | { type: "activity"; createdAt: number; activity: ToolCallRecord }
  | { type: "approval"; createdAt: number; approval: PendingApproval }
  | { type: "waiting"; waitingState: WaitingState };

type SortableTranscriptEntry = Exclude<TranscriptEntry, { type: "waiting" }>;

function entryPriority(entry: TranscriptEntry): number {
  if (entry.type === "approval") {
    return 0;
  }
  if (entry.type === "activity") {
    return 1;
  }
  return 2;
}

export function hasRunningTranscriptActivity(toolLog: readonly ToolCallRecord[], pendingApprovals: readonly PendingApproval[]): boolean {
  return toolLog.some((entry) => entry.status === "running") || pendingApprovals.length > 0;
}

export function shouldRenderWaitingEntry(
  status: WorkspaceState["tabs"][number]["status"],
  waitingState: WaitingState | null | undefined,
  toolLog: readonly ToolCallRecord[],
  pendingApprovals: readonly PendingApproval[],
  hiddenActivityKinds: readonly ToolActivityKind[] = [],
): boolean {
  if (status !== "busy" || !waitingState) {
    return false;
  }
  if (waitingState.phase !== "tools") {
    return true;
  }
  const visibleToolLog = toolLog.filter((entry) => !hiddenActivityKinds.includes(entry.kind));
  return !hasRunningTranscriptActivity(visibleToolLog, pendingApprovals);
}

export function buildTranscriptEntries(
  messages: readonly ChatMessage[],
  showReasoning: boolean,
  toolLog: readonly ToolCallRecord[],
  pendingApprovals: readonly PendingApproval[],
  waitingState: WaitingState | null | undefined,
  status: WorkspaceState["tabs"][number]["status"],
  hiddenActivityKinds: readonly ToolActivityKind[] = [],
): TranscriptEntry[] {
  const entries: SortableTranscriptEntry[] = [];

  for (const message of messages) {
    if (!showReasoning && message.kind === "reasoning") {
      continue;
    }
    entries.push({
      type: "message",
      createdAt: message.createdAt,
      message,
    });
  }

  for (const activity of toolLog) {
    if (hiddenActivityKinds.includes(activity.kind)) {
      continue;
    }
    entries.push({
      type: "activity",
      createdAt: activity.createdAt,
      activity,
    });
  }

  for (const approval of pendingApprovals) {
    entries.push({
      type: "approval",
      createdAt: approval.createdAt,
      approval,
    });
  }

  entries.sort((left, right) => {
    if (left.createdAt !== right.createdAt) {
      return left.createdAt - right.createdAt;
    }
    return entryPriority(left) - entryPriority(right);
  });

  const mergedEntries: TranscriptEntry[] = [...entries];

  if (shouldRenderWaitingEntry(status, waitingState, toolLog, pendingApprovals, hiddenActivityKinds) && waitingState) {
    mergedEntries.push({
      type: "waiting",
      waitingState,
    });
  }

  return mergedEntries;
}
