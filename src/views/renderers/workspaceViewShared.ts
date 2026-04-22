import type { AccountUsageSummary, ToolCallRecord, WorkspaceState } from "../../model/types";
import { getLocaleDateTag, type LocalizedCopy, type SupportedLocale } from "../../util/i18n";
import { formatReasoningEffortLabel } from "../../util/reasoning";

export interface StatusMenuOption {
  label: string;
  selected: boolean;
  iconText?: string;
  description?: string;
  onSelect: () => void;
}

export interface HubPanelDraft {
  title: string;
  description: string;
  promptTemplate: string;
  linkedSkillNames: string[];
}

export function displayEffortLabel(value: string, locale: SupportedLocale): string {
  return formatReasoningEffortLabel(value as "low" | "medium" | "high" | "xhigh", locale);
}

export function compactModelLabel(slug: string, fallback: string): string {
  if (/^gpt-5\.4$/i.test(slug)) {
    return "GPT-5.4";
  }
  if (/^gpt-5\.3-codex$/i.test(slug)) {
    return "GPT-5.3";
  }
  if (/^gpt-5\.2$/i.test(slug)) {
    return "GPT-5.2";
  }
  return fallback
    .replace(/^gpt-/i, "GPT-")
    .replace(/-mini$/i, "-Mini")
    .replace(/-codex$/i, "-Codex");
}

export function isTabStreaming(status: WorkspaceState["tabs"][number]["status"] | undefined): boolean {
  return status === "busy" || status === "waiting_approval";
}

export function formatUsageSourceLabel(
  source: AccountUsageSummary["source"],
  copy: LocalizedCopy["workspace"],
): string | null {
  if (source === "live") {
    return copy.usageSource.live;
  }
  if (source === "active_poll" || source === "idle_poll" || source === "session_backfill") {
    return copy.usageSource.recovered;
  }
  if (source === "restored") {
    return copy.usageSource.restored;
  }
  return null;
}

export function formatActivityStatusLabel(status: ToolCallRecord["status"], copy: LocalizedCopy["workspace"]): string {
  if (status === "running") {
    return copy.activityStatus.running;
  }
  if (status === "failed") {
    return copy.activityStatus.failed;
  }
  return copy.activityStatus.done;
}

export function getActivityIcon(kind: ToolCallRecord["kind"]): string {
  if (kind === "shell") {
    return "terminal";
  }
  if (kind === "mcp") {
    return "blocks";
  }
  if (kind === "web") {
    return "globe";
  }
  if (kind === "file") {
    return "file-text";
  }
  if (kind === "todo") {
    return "list-todo";
  }
  return "wrench";
}

export function summarizePreviewText(text: string, maxLines = 4, maxChars = 280): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines);
  const joined = lines.join("\n");
  if (joined.length <= maxChars) {
    return joined;
  }
  return `${joined.slice(0, maxChars).trimEnd()}...`;
}

export function formatCompactTimestamp(
  value: number | null,
  locale: SupportedLocale,
  copy: LocalizedCopy["workspace"],
): string {
  if (!value) {
    return copy.never;
  }
  return new Date(value).toLocaleString(getLocaleDateTag(locale), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function bindKeyboardActivation(element: HTMLElement, action: () => void): void {
  element.tabIndex = 0;
  element.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      action();
    }
  });
}
