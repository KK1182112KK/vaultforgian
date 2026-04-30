import type { CodexSpawnSpec } from "../util/codexCli";
import { renderCodexSpawnSpec } from "../util/codexCli";
import { unwrapApiErrorMessage } from "../util/reasoning";
import { containsFuturePatchPromise, sanitizeOperationalAssistantText } from "../util/assistantChatter";
import {
  createEmptyUsageSummary,
  extractUsageSummaryPatch,
  mergeUsageSummary,
} from "../util/usage";
import { makeId } from "../util/id";
import type { AgentStore } from "../model/store";
import type { AccountUsageSummary, ConversationTabState, RuntimeMode, ToolActivityStatus, WaitingPhase } from "../model/types";

type JsonRecord = Record<string, unknown>;
export type AssistantOutputVisibility = "visible" | "artifact_only";

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null ? (value as JsonRecord) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeAssistantOutputText(rawText: string | null | undefined): string | null {
  const raw = rawText ?? "";
  return sanitizeOperationalAssistantText(raw) ?? (containsFuturePatchPromise(raw) ? raw : null);
}

function getErrorMessage(value: unknown): string {
  if (value instanceof Error) {
    return unwrapApiErrorMessage(value.message);
  }
  if (typeof value === "string") {
    return unwrapApiErrorMessage(value);
  }
  if (asRecord(value)) {
    const message = extractNestedErrorMessage(value);
    if (message) {
      return unwrapApiErrorMessage(message);
    }
    const json = safeJson(value);
    if (json !== "{}") {
      return unwrapApiErrorMessage(json);
    }
  }
  return "Unknown Codex error.";
}

function extractNestedErrorMessage(value: unknown, seen = new Set<unknown>()): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Error) {
    return value.message;
  }
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  if (seen.has(record)) {
    return null;
  }
  seen.add(record);
  const directMessage = asString(record.message);
  if (directMessage) {
    return directMessage;
  }
  for (const key of ["error", "last_error", "cause", "details", "payload"]) {
    const nestedMessage = extractNestedErrorMessage(record[key], seen);
    if (nestedMessage) {
      return nestedMessage;
    }
  }
  return null;
}

function extractCodexSessionId(event: JsonRecord): string | null {
  if (asString(event.type) === "thread.started") {
    return asString(event.thread_id);
  }
  if (asString(event.type) === "session_meta") {
    return asString(asRecord(event.payload)?.id);
  }
  return null;
}

function buildEventBackedMessageId(event: JsonRecord, phase: string, fallbackPrefix: string, scope: string | null = null): string {
  const timestamp = asString(event.timestamp)?.replace(/[^a-zA-Z0-9]+/g, "-") ?? makeId(fallbackPrefix);
  const normalizedScope = scope?.trim().replace(/[^a-zA-Z0-9]+/g, "-") ?? "";
  return normalizedScope ? `${fallbackPrefix}-${normalizedScope}-${timestamp}-${phase}` : `${fallbackPrefix}-${timestamp}-${phase}`;
}

function buildItemBackedMessageId(itemId: string, fallbackPrefix: string, scope: string | null = null): string {
  const normalizedScope = scope?.trim().replace(/[^a-zA-Z0-9]+/g, "-") ?? "";
  return normalizedScope ? `${fallbackPrefix}-${normalizedScope}-${itemId}` : `${fallbackPrefix}-${itemId}`;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "{}";
  }
}

function deriveActivityStatus(pending: boolean, failed = false): ToolActivityStatus {
  if (failed) {
    return "failed";
  }
  return pending ? "running" : "completed";
}

function extractCallId(value: JsonRecord): string | null {
  return asString(value.call_id) ?? asString(value.callId) ?? asString(value.id);
}

function summarizeResultText(item: JsonRecord): string | null {
  const result = asString(item.result);
  if (result?.trim()) {
    return result;
  }
  const output = asString(item.output);
  if (output?.trim()) {
    return output;
  }
  return null;
}

function summarizeCommand(item: JsonRecord): string {
  const command = asString(item.command) ?? asString(item.input) ?? "";
  if (!command.trim()) {
    return "Shell command";
  }
  return command.trim();
}

function summarizeWebSearch(item: JsonRecord): string {
  const query = asString(item.query) ?? asString(asRecord(item.input)?.query) ?? "";
  return query.trim() ? query.trim() : "Search query";
}

function summarizeMcpTool(item: JsonRecord): { title: string; summary: string; name: string } {
  const name = asString(item.name) ?? asString(item.tool_name) ?? "mcp_tool";
  const summary = summarizeResultText(item) ?? asString(item.arguments) ?? asString(item.input) ?? name;
  return {
    title: name,
    summary,
    name,
  };
}

function summarizeFileChange(item: JsonRecord): { summary: string; resultText: string } {
  const changes = Array.isArray(item.changes) ? item.changes : [];
  const lines = changes
    .map((entry) => asRecord(entry))
    .filter((entry): entry is JsonRecord => Boolean(entry))
    .map((entry) => `${asString(entry.kind) ?? "change"}: ${asString(entry.path) ?? "unknown"}`);
  const resultText = lines.join("\n");
  return {
    summary: lines[0] ?? "File changes",
    resultText,
  };
}

function summarizeTodoList(item: JsonRecord): string {
  const items = Array.isArray(item.items) ? item.items : [];
  const lines = items
    .map((entry) => asRecord(entry))
    .filter((entry): entry is JsonRecord => Boolean(entry))
    .map((entry) => `- ${asString(entry.text) ?? "Todo item"}`);
  return lines.join("\n") || "Todo list";
}

function buildActivityRecord(
  current: ConversationTabState["toolLog"][number] | null,
  callId: string,
  kind: ConversationTabState["toolLog"][number]["kind"],
  name: string,
  title: string,
  summary: string,
  argsJson: string,
  status: ToolActivityStatus,
  resultText?: string,
): ConversationTabState["toolLog"][number] {
  return {
    id: current?.id ?? makeId("activity"),
    callId,
    kind,
    name,
    title,
    summary,
    argsJson,
    createdAt: current?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    status,
    resultText: resultText ?? current?.resultText,
  };
}

function extractResponseMessageText(payload: JsonRecord): string | null {
  const content = Array.isArray(payload.content) ? payload.content : [];
  const parts = content
    .map((entry) => asRecord(entry))
    .filter((entry): entry is JsonRecord => Boolean(entry))
    .map((entry) => asString(entry.text))
    .filter((entry): entry is string => Boolean(entry?.trim()));

  if (parts.length > 0) {
    return parts.join("\n\n");
  }

  const directText = asString(payload.text);
  return directText?.trim() ? directText : null;
}

function extractReasoningText(payload: JsonRecord): string | null {
  const directText = asString(payload.text) ?? asString(payload.content);
  if (directText?.trim()) {
    return directText;
  }

  const summary = Array.isArray(payload.summary) ? payload.summary : [];
  const lines = summary
    .map((entry) => asRecord(entry))
    .filter((entry): entry is JsonRecord => Boolean(entry))
    .map((entry) => asString(entry.text) ?? asString(entry.summary))
    .filter((entry): entry is string => Boolean(entry?.trim()));

  return lines.length > 0 ? lines.join("\n\n") : null;
}

function extractTaskCompleteMessageText(payload: JsonRecord): string | null {
  const text = asString(payload.last_agent_message) ?? asString(payload.lastAgentMessage);
  return text?.trim() ? text : null;
}

export interface ThreadEventReducerDeps {
  store: AgentStore;
  getLocale: () => "en" | "ja";
  getShowReasoning: () => boolean;
  findTab: (tabId: string) => ConversationTabState | null;
  setWaitingPhase: (tabId: string, phase: WaitingPhase, mode: RuntimeMode) => void;
  updateAccountUsageFromPatch: (
    limits: Partial<AccountUsageSummary["limits"]> | null,
    threadId: string | null,
    source: AccountUsageSummary["source"],
    updatedAt: number,
  ) => void;
  queueAssistantArtifactSync: (
    tabId: string,
    messageId: string,
    text: string,
    visibility?: AssistantOutputVisibility,
  ) => void;
  shouldSuppressAssistantOutput?: (tabId: string, text: string) => boolean;
}

export class ThreadEventReducer {
  constructor(private readonly deps: ThreadEventReducerDeps) {}

  buildCliExitMessage(
    stderrChunks: Buffer[],
    code: number | null,
    signal: NodeJS.Signals | null,
    spec: CodexSpawnSpec,
    terminalEventError: string | null,
  ): string {
    if (terminalEventError) {
      return unwrapApiErrorMessage(terminalEventError);
    }
    const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
    if (stderr) {
      return unwrapApiErrorMessage(stderr);
    }
    const exitDetail = signal ? `signal ${signal}` : `code ${code ?? 1}`;
    return this.deps.getLocale() === "ja"
      ? `Codex CLI が ${exitDetail} で終了しました。\nResolved command: ${renderCodexSpawnSpec(spec)}`
      : `Codex CLI exited with ${exitDetail}.\nResolved command: ${renderCodexSpawnSpec(spec)}`;
  }

  handleThreadEvent(
    tabId: string,
    event: JsonRecord,
    assistantOutputVisibility: AssistantOutputVisibility = "visible",
    messageIdScope: string | null = null,
  ): string | null {
    const usagePatch = extractUsageSummaryPatch(event);
    if (usagePatch) {
      const currentUsage = this.deps.findTab(tabId)?.usageSummary ?? createEmptyUsageSummary();
      this.deps.store.setUsageSummary(tabId, mergeUsageSummary(currentUsage, usagePatch));
      this.deps.updateAccountUsageFromPatch(
        usagePatch.limits ?? null,
        extractCodexSessionId(event) ?? this.deps.findTab(tabId)?.codexThreadId ?? null,
        "live",
        Date.now(),
      );
    }

    const eventType = asString(event.type);
    const payload = asRecord(event.payload);
    const mode = this.deps.findTab(tabId)?.runtimeMode ?? "normal";
    const threadId = extractCodexSessionId(event);
    if (threadId) {
      this.deps.store.setCodexThreadId(tabId, threadId);
      return null;
    }

    if (eventType === "turn.failed") {
      const message = getErrorMessage(event.error);
      this.failRunningActivities(tabId, message);
      return message;
    }

    if (eventType === "error") {
      const message = getErrorMessage(event.message ?? event.error);
      this.failRunningActivities(tabId, message);
      return message;
    }

    if (eventType === "event_msg" && payload) {
      const payloadType = asString(payload.type);
      if (payloadType === "task_started") {
        this.deps.setWaitingPhase(tabId, "boot", mode);
        return null;
      }

      if (payloadType === "task_complete") {
        const text = normalizeAssistantOutputText(extractTaskCompleteMessageText(payload));
        if (text && assistantOutputVisibility !== "artifact_only") {
          this.appendAssistantFallbackMessage(
            tabId,
            text,
            buildEventBackedMessageId(event, "final_answer", "codex-message", messageIdScope),
            assistantOutputVisibility,
          );
        }
        return null;
      }

      if (payloadType === "agent_message") {
        const text = normalizeAssistantOutputText(asString(payload.message));
        if (!text) {
          return null;
        }
        const phase = asString(payload.phase) ?? "final_answer";
        const messageId = buildEventBackedMessageId(event, phase, "codex-message", messageIdScope);
        this.recordAssistantOutput(tabId, messageId, text, false, mode, assistantOutputVisibility);
        return null;
      }
    }

    if (eventType === "response_item" && payload) {
      const payloadType = asString(payload.type);
      if (payloadType === "message") {
        if (asString(payload.role) !== "assistant") {
          return null;
        }
        const text = normalizeAssistantOutputText(extractResponseMessageText(payload));
        if (!text) {
          return null;
        }
        const phase = asString(payload.phase) ?? "final_answer";
        const messageId = buildEventBackedMessageId(event, phase, "codex-message", messageIdScope);
        this.recordAssistantOutput(tabId, messageId, text, false, mode, assistantOutputVisibility);
        return null;
      }

      if (payloadType === "reasoning") {
        this.deps.setWaitingPhase(tabId, "reasoning", mode);
        if (!this.deps.getShowReasoning()) {
          return null;
        }
        const text = extractReasoningText(payload);
        if (!text) {
          return null;
        }
        this.deps.store.upsertMessage(tabId, buildEventBackedMessageId(event, "reasoning", "codex-reasoning", messageIdScope), (current) => ({
          id: current?.id ?? buildEventBackedMessageId(event, "reasoning", "codex-reasoning", messageIdScope),
          kind: "reasoning",
          text,
          createdAt: current?.createdAt ?? Date.now(),
          pending: false,
        }));
        return null;
      }

      if (payloadType === "function_call" || payloadType === "function_call_output") {
        this.deps.setWaitingPhase(tabId, "tools", mode);
        this.recordResponseItemActivity(tabId, payload, payloadType === "function_call");
        return null;
      }
    }

    const item = asRecord(event.item);
    if (!item) {
      return null;
    }

    if (asString(item.type) === "error") {
      const message = getErrorMessage(item.message ?? item.error);
      this.failRunningActivities(tabId, message);
      return message;
    }

    this.handleThreadItem(tabId, item, eventType !== "item.completed", assistantOutputVisibility, messageIdScope);
    return null;
  }

  private handleThreadItem(
    tabId: string,
    item: JsonRecord,
    pending: boolean,
    assistantOutputVisibility: AssistantOutputVisibility,
    messageIdScope: string | null,
  ): void {
    const itemType = asString(item.type);
    const itemId = asString(item.id) ?? makeId("codex-item");
    const mode = this.deps.findTab(tabId)?.runtimeMode ?? "normal";

    if (itemType === "agent_message") {
      const text = sanitizeOperationalAssistantText(asString(item.text) ?? "");
      if (!text) {
        return;
      }
      this.recordAssistantOutput(tabId, buildItemBackedMessageId(itemId, "codex-assistant", messageIdScope), text, pending, mode, assistantOutputVisibility);
      return;
    }

    if (itemType === "reasoning") {
      this.deps.setWaitingPhase(tabId, "reasoning", mode);
      if (!this.deps.getShowReasoning()) {
        return;
      }
      const messageId = buildItemBackedMessageId(itemId, "codex-reasoning", messageIdScope);
      this.deps.store.upsertMessage(tabId, messageId, (current) => ({
        id: messageId,
        kind: "reasoning",
        text: asString(item.text) ?? "",
        createdAt: current?.createdAt ?? Date.now(),
        pending,
      }));
      return;
    }

    if (itemType === "command_execution") {
      this.deps.setWaitingPhase(tabId, "tools", mode);
      this.recordCommandExecution(tabId, item, pending);
      return;
    }

    if (itemType === "mcp_tool_call") {
      this.deps.setWaitingPhase(tabId, "tools", mode);
      this.recordMcpToolCall(tabId, item, pending);
      return;
    }

    if (itemType === "file_change") {
      this.deps.setWaitingPhase(tabId, "tools", mode);
      this.recordFileChange(tabId, item, pending);
      return;
    }

    if (itemType === "web_search") {
      this.deps.setWaitingPhase(tabId, "tools", mode);
      this.recordWebSearch(tabId, item, pending);
      return;
    }

    if (itemType === "todo_list") {
      this.deps.setWaitingPhase(tabId, "tools", mode);
      this.recordTodoList(tabId, item, pending);
    }
  }

  private recordCommandExecution(tabId: string, item: JsonRecord, pending: boolean): void {
    const callId = extractCallId(item) ?? makeId("shell");
    const summary = summarizeCommand(item);
    const resultText = summarizeResultText(item) ?? undefined;
    this.deps.store.upsertToolLog(tabId, callId, (current) =>
      buildActivityRecord(
        current,
        callId,
        "shell",
        "command_execution",
        "Run shell command",
        summary,
        safeJson(item),
        deriveActivityStatus(pending),
        resultText,
      ),
    );
  }

  private recordMcpToolCall(tabId: string, item: JsonRecord, pending: boolean): void {
    const callId = extractCallId(item) ?? makeId("mcp");
    const { title, summary, name } = summarizeMcpTool(item);
    const resultText = summarizeResultText(item) ?? undefined;
    this.deps.store.upsertToolLog(tabId, callId, (current) =>
      buildActivityRecord(
        current,
        callId,
        "mcp",
        name,
        title,
        summary,
        safeJson(item),
        deriveActivityStatus(pending),
        resultText,
      ),
    );
  }

  private recordFileChange(tabId: string, item: JsonRecord, pending: boolean): void {
    const callId = extractCallId(item) ?? makeId("file-change");
    const { summary, resultText } = summarizeFileChange(item);
    this.deps.store.setDiff(tabId, resultText);
    this.deps.store.upsertToolLog(tabId, callId, (current) =>
      buildActivityRecord(
        current,
        callId,
        "file",
        "file_change",
        "File changes",
        summary,
        safeJson(item),
        deriveActivityStatus(pending),
        resultText,
      ),
    );
  }

  private recordWebSearch(tabId: string, item: JsonRecord, pending: boolean): void {
    const callId = extractCallId(item) ?? makeId("web");
    const summary = summarizeWebSearch(item);
    const resultText = summarizeResultText(item) ?? undefined;
    this.deps.store.upsertToolLog(tabId, callId, (current) =>
      buildActivityRecord(
        current,
        callId,
        "web",
        "web_search",
        "Web search",
        summary,
        safeJson(item),
        deriveActivityStatus(pending),
        resultText,
      ),
    );
  }

  private recordTodoList(tabId: string, item: JsonRecord, pending: boolean): void {
    const callId = extractCallId(item) ?? makeId("todo");
    const summary = summarizeTodoList(item);
    this.deps.store.upsertToolLog(tabId, callId, (current) =>
      buildActivityRecord(
        current,
        callId,
        "todo",
        "todo_list",
        "Todo list",
        summary,
        safeJson(item),
        deriveActivityStatus(pending),
        summarizeResultText(item) ?? undefined,
      ),
    );
  }

  private recordResponseItemActivity(tabId: string, payload: JsonRecord, isStart: boolean): void {
    const callId = extractCallId(payload) ?? makeId("tool");
    const name = asString(payload.name) ?? asString(payload.tool_name) ?? "tool";
    const summary = asString(payload.arguments) ?? asString(payload.input) ?? summarizeResultText(payload) ?? name;
    const resultText = isStart ? undefined : summarizeResultText(payload) ?? asString(payload.output) ?? undefined;
    this.deps.store.upsertToolLog(tabId, callId, (current) =>
      buildActivityRecord(
        current,
        callId,
        "tool",
        name,
        name,
        summary,
        safeJson(payload),
        deriveActivityStatus(isStart, false),
        resultText,
      ),
    );
  }

  private failRunningActivities(tabId: string, resultText: string): void {
    this.deps.store.updateRunningToolLogs(tabId, (current) => ({
      ...current,
      status: "failed",
      updatedAt: Date.now(),
      resultText: current.resultText ?? resultText,
    }));
  }

  private recordAssistantOutput(
    tabId: string,
    messageId: string,
    text: string,
    pending: boolean,
    mode: RuntimeMode,
    visibility: AssistantOutputVisibility,
  ): void {
    this.deps.setWaitingPhase(tabId, "finalizing", mode);
    if (visibility === "artifact_only") {
      if (!pending) {
        this.deps.queueAssistantArtifactSync(tabId, messageId, text, visibility);
      }
      return;
    }
    if (!pending && this.deps.shouldSuppressAssistantOutput?.(tabId, text)) {
      return;
    }
    this.deps.store.upsertMessage(tabId, messageId, (current) => ({
      id: current?.id ?? messageId,
      kind: "assistant",
      text,
      createdAt: current?.createdAt ?? Date.now(),
      pending,
    }));
    if (!pending) {
      this.deps.queueAssistantArtifactSync(tabId, messageId, text, visibility);
    }
  }

  private appendAssistantFallbackMessage(
    tabId: string,
    text: string,
    messageId: string,
    visibility: AssistantOutputVisibility,
  ): void {
    const normalizedText = normalizeAssistantOutputText(text) ?? "";
    if (!normalizedText) {
      return;
    }

    if (visibility === "artifact_only") {
      this.deps.queueAssistantArtifactSync(tabId, messageId, normalizedText, visibility);
      return;
    }

    if (this.deps.shouldSuppressAssistantOutput?.(tabId, normalizedText)) {
      return;
    }

    const tab = this.deps.findTab(tabId);
    if (!tab) {
      return;
    }

    const lastPromptIndex = [...tab.messages]
      .map((message, index) => ({ message, index }))
      .reverse()
      .find(({ message }) => message.kind === "user" && message.meta?.selectionContext !== true)?.index;

    if (typeof lastPromptIndex === "number") {
      const hasAssistantReply = tab.messages
        .slice(lastPromptIndex + 1)
        .some((message) => message.kind === "assistant" && !message.pending && message.text.trim().length > 0);
      if (hasAssistantReply) {
        return;
      }
    }

    this.deps.store.upsertMessage(tabId, messageId, (current) => ({
      id: current?.id ?? messageId,
      kind: "assistant",
      text: normalizedText,
      createdAt: current?.createdAt ?? Date.now(),
      pending: false,
    }));
    this.deps.queueAssistantArtifactSync(tabId, messageId, normalizedText, visibility);
  }
}
