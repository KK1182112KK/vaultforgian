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

function normalizeActivityToken(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function isGenericMcpActivity(activity: ToolCallRecord): boolean {
  if (activity.kind !== "mcp" && activity.kind !== "tool") {
    return false;
  }
  const name = normalizeActivityToken(activity.name);
  const title = normalizeActivityToken(activity.title);
  if (name !== "mcp_tool" && title !== "mcp_tool" && name !== "mcp" && title !== "mcp") {
    return false;
  }
  const visibleTokens = [activity.name, activity.title, activity.summary, activity.resultText]
    .map(normalizeActivityToken)
    .filter(Boolean);
  return visibleTokens.length > 0 && visibleTokens.every((token) => token === "mcp_tool" || token === "mcp");
}

function isCompletedPluginManagedApplyActivity(activity: ToolCallRecord): boolean {
  if (activity.status !== "completed" || activity.kind !== "file") {
    return false;
  }
  const name = normalizeActivityToken(activity.name);
  const title = normalizeActivityToken(activity.title);
  if (name === "skill_update" && title.startsWith("update skill:")) {
    return true;
  }
  return name === "write_note" && (title === "apply note patch" || title === "create note");
}

export function shouldRenderActivity(activity: ToolCallRecord): boolean {
  if (activity.status === "failed") {
    return true;
  }
  if (isCompletedPluginManagedApplyActivity(activity)) {
    return false;
  }
  return !isGenericMcpActivity(activity);
}

export function hasRunningTranscriptActivity(
  toolLog: readonly ToolCallRecord[],
  pendingApprovals: readonly PendingApproval[],
  hiddenActivityKinds: readonly ToolActivityKind[] = [],
): boolean {
  return toolLog.some((entry) => entry.status === "running" && !hiddenActivityKinds.includes(entry.kind) && shouldRenderActivity(entry)) || pendingApprovals.length > 0;
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
  return !hasRunningTranscriptActivity(toolLog, pendingApprovals, hiddenActivityKinds);
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
    if (hiddenActivityKinds.includes(activity.kind) || !shouldRenderActivity(activity)) {
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
