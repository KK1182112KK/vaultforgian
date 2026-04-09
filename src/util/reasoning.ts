export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";
import type { SupportedLocale } from "./i18n";

export interface ApiErrorDetails {
  code: string | null;
  message: string;
  param: string | null;
}

export const REASONING_EFFORT_ORDER: ReasoningEffort[] = ["low", "medium", "high", "xhigh"];
export const REASONING_EFFORT_DESCENDING_ORDER: ReasoningEffort[] = [...REASONING_EFFORT_ORDER].reverse();

export function normalizeReasoningEffort(value: string | null | undefined): ReasoningEffort | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "middle") {
    return "medium";
  }
  if (normalized === "x-high") {
    return "xhigh";
  }
  return REASONING_EFFORT_ORDER.includes(normalized as ReasoningEffort) ? (normalized as ReasoningEffort) : null;
}

export function formatReasoningEffortLabel(value: ReasoningEffort, locale: SupportedLocale = "en"): string {
  if (locale === "ja") {
    if (value === "low") {
      return "低";
    }
    if (value === "medium") {
      return "中";
    }
    if (value === "high") {
      return "高";
    }
    return "最高";
  }
  return value === "xhigh" ? "x-high" : value;
}

export function sortReasoningEffortsDescending(efforts: readonly ReasoningEffort[]): ReasoningEffort[] {
  const supported = new Set(efforts);
  return REASONING_EFFORT_DESCENDING_ORDER.filter((effort) => supported.has(effort));
}

export function parseReasoningEffortFromConfig(configToml: string): ReasoningEffort | null {
  const match = configToml.match(/^\s*model_reasoning_effort\s*=\s*"?(low|medium|high|xhigh)"?\s*(?:#.*)?$/m);
  return normalizeReasoningEffort(match?.[1]);
}

export function getCompatibleReasoningEffort(model: string, desired: ReasoningEffort | null): ReasoningEffort | null {
  if (!desired) {
    return null;
  }

  if (isGpt51CodexModel(model) && desired === "xhigh") {
    return "high";
  }

  return desired;
}

export function isGpt51CodexModel(model: string): boolean {
  return /^gpt-5\.1-codex(?:$|-)/i.test(model.trim());
}

export function extractSupportedReasoningEfforts(message: string): ReasoningEffort[] {
  const supportedSection = message.match(/supported values are:\s*(.+)$/i)?.[1] ?? message;
  const efforts = new Set<ReasoningEffort>();
  for (const match of supportedSection.matchAll(/'(low|medium|high|xhigh)'/gi)) {
    efforts.add(match[1].toLowerCase() as ReasoningEffort);
  }
  return [...efforts].sort((left, right) => REASONING_EFFORT_ORDER.indexOf(left) - REASONING_EFFORT_ORDER.indexOf(right));
}

export function chooseHighestReasoningEffort(efforts: readonly ReasoningEffort[]): ReasoningEffort | null {
  let best: ReasoningEffort | null = null;
  for (const effort of efforts) {
    if (!best || REASONING_EFFORT_ORDER.indexOf(effort) > REASONING_EFFORT_ORDER.indexOf(best)) {
      best = effort;
    }
  }
  return best;
}

export function extractApiErrorDetails(raw: string): ApiErrorDetails | null {
  try {
    const parsed = JSON.parse(raw) as {
      error?: {
        code?: unknown;
        message?: unknown;
        param?: unknown;
      };
    };
    if (!parsed || typeof parsed !== "object" || !parsed.error || typeof parsed.error !== "object") {
      return null;
    }

    const message = typeof parsed.error.message === "string" ? parsed.error.message : null;
    if (!message) {
      return null;
    }

    return {
      code: typeof parsed.error.code === "string" ? parsed.error.code : null,
      message,
      param: typeof parsed.error.param === "string" ? parsed.error.param : null,
    };
  } catch {
    return null;
  }
}

export function unwrapApiErrorMessage(raw: string): string {
  return extractApiErrorDetails(raw)?.message ?? raw;
}

export function isUnsupportedReasoningEffortError(raw: string): boolean {
  const details = extractApiErrorDetails(raw);
  if (details?.param === "reasoning.effort") {
    return true;
  }

  const text = details?.message ?? raw;
  return /reasoning\.effort/i.test(text) || /unsupported value/i.test(text) && /supported values/i.test(text);
}
