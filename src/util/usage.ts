import type { AccountUsageSource, AccountUsageSummary, UsageSummary } from "../model/types";

export type AccountUsageFreshness = "live" | "polled" | "restored" | "stale" | "unknown";

export interface AccountUsageFreshnessThresholds {
  liveMs: number;
  polledMs: number;
  staleMs: number;
}

export const DEFAULT_ACCOUNT_USAGE_FRESHNESS_THRESHOLDS: AccountUsageFreshnessThresholds = {
  liveMs: 5_000,
  polledMs: 30_000,
  staleMs: 120_000,
};

export interface UsageSummaryPatch {
  lastTurn?: UsageSummary["lastTurn"];
  total?: UsageSummary["total"];
  limits?: Partial<UsageSummary["limits"]>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseUsageMetric(value: unknown): UsageSummary["lastTurn"] {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const inputTokens = asNumber(record.input_tokens);
  const cachedInputTokens = asNumber(record.cached_input_tokens);
  const outputTokens = asNumber(record.output_tokens);
  const reasoningOutputTokens = asNumber(record.reasoning_output_tokens);
  const totalTokens = asNumber(record.total_tokens);
  if ([inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens, totalTokens].every((entry) => entry === null)) {
    return null;
  }

  return {
    inputTokens: inputTokens ?? 0,
    cachedInputTokens: cachedInputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    reasoningOutputTokens: reasoningOutputTokens ?? 0,
    totalTokens: totalTokens ?? 0,
  };
}

function extractTokenCountRecord(event: unknown): Record<string, unknown> | null {
  const root = asRecord(event);
  if (!root) {
    return null;
  }

  if (asString(root.type) === "token_count") {
    return root;
  }

  const payload = asRecord(root.payload);
  if (asString(payload?.type) === "token_count") {
    return payload;
  }

  const item = asRecord(root.item);
  if (asString(item?.type) === "token_count") {
    return item;
  }

  return null;
}

export function createEmptyUsageSummary(): UsageSummary {
  return {
    lastTurn: null,
    total: null,
    limits: {
      fiveHourPercent: null,
      weekPercent: null,
      planType: null,
    },
  };
}

export function createEmptyAccountUsageSummary(): AccountUsageSummary {
  return {
    limits: {
      fiveHourPercent: null,
      weekPercent: null,
      planType: null,
    },
    source: null,
    updatedAt: null,
    lastObservedAt: null,
    lastCheckedAt: null,
    threadId: null,
  };
}

export function getAccountUsageObservedAt(summary: AccountUsageSummary | null | undefined): number | null {
  return summary?.lastObservedAt ?? summary?.updatedAt ?? null;
}

export function normalizeAccountUsageSummary(summary: AccountUsageSummary | null | undefined): AccountUsageSummary {
  if (!summary) {
    return createEmptyAccountUsageSummary();
  }
  const lastObservedAt = getAccountUsageObservedAt(summary);
  return {
    limits: {
      fiveHourPercent: summary.limits.fiveHourPercent ?? null,
      weekPercent: summary.limits.weekPercent ?? null,
      planType: summary.limits.planType ?? null,
    },
    source: summary.source ?? null,
    updatedAt: lastObservedAt,
    lastObservedAt,
    lastCheckedAt: summary.lastCheckedAt ?? null,
    threadId: summary.threadId ?? null,
  };
}

export function mergeUsageSummary(current: UsageSummary, patch: UsageSummaryPatch): UsageSummary {
  return {
    lastTurn: patch.lastTurn ?? current.lastTurn,
    total: patch.total ?? current.total,
    limits: {
      fiveHourPercent: patch.limits?.fiveHourPercent ?? current.limits.fiveHourPercent,
      weekPercent: patch.limits?.weekPercent ?? current.limits.weekPercent,
      planType: patch.limits?.planType ?? current.limits.planType,
    },
  };
}

export function mergeAccountUsageSummary(
  current: AccountUsageSummary,
  patch: {
    limits?: Partial<AccountUsageSummary["limits"]>;
    source?: AccountUsageSource | null;
    updatedAt?: number | null;
    lastObservedAt?: number | null;
    lastCheckedAt?: number | null;
    threadId?: string | null;
  },
): AccountUsageSummary {
  const normalizedCurrent = normalizeAccountUsageSummary(current);
  const lastObservedAt: number | null = patch.lastObservedAt ?? patch.updatedAt ?? normalizedCurrent.lastObservedAt ?? null;
  return {
    limits: {
      fiveHourPercent: patch.limits?.fiveHourPercent ?? normalizedCurrent.limits.fiveHourPercent,
      weekPercent: patch.limits?.weekPercent ?? normalizedCurrent.limits.weekPercent,
      planType: patch.limits?.planType ?? normalizedCurrent.limits.planType,
    },
    source: patch.source ?? normalizedCurrent.source,
    updatedAt: lastObservedAt,
    lastObservedAt,
    lastCheckedAt: patch.lastCheckedAt ?? normalizedCurrent.lastCheckedAt,
    threadId: patch.threadId ?? normalizedCurrent.threadId,
  };
}

export function hasAccountUsageSummaryData(summary: AccountUsageSummary | null | undefined): boolean {
  const normalized = normalizeAccountUsageSummary(summary);
  return Boolean(
    normalized.limits.fiveHourPercent !== null ||
      normalized.limits.weekPercent !== null ||
      normalized.limits.planType ||
      normalized.source,
  );
}

export function shouldPreferAccountUsageSummary(
  current: AccountUsageSummary | null | undefined,
  candidate: AccountUsageSummary | null | undefined,
): boolean {
  const currentObservedAt = getAccountUsageObservedAt(current);
  const candidateObservedAt = getAccountUsageObservedAt(candidate);
  if (candidateObservedAt !== null && currentObservedAt !== null) {
    if (candidateObservedAt !== currentObservedAt) {
      return candidateObservedAt > currentObservedAt;
    }
  } else if (candidateObservedAt !== null) {
    return true;
  }

  const currentCheckedAt = current?.lastCheckedAt ?? null;
  const candidateCheckedAt = candidate?.lastCheckedAt ?? null;
  if (candidateCheckedAt !== null && currentCheckedAt !== null) {
    if (candidateCheckedAt !== currentCheckedAt) {
      return candidateCheckedAt > currentCheckedAt;
    }
  } else if (candidateCheckedAt !== null) {
    return true;
  }

  const sourcePriority = (source: AccountUsageSource | null | undefined): number => {
    switch (source) {
      case "live":
        return 4;
      case "active_poll":
        return 3;
      case "idle_poll":
      case "session_backfill":
        return 2;
      case "restored":
        return 1;
      default:
        return 0;
    }
  };
  const currentPriority = sourcePriority(current?.source);
  const candidatePriority = sourcePriority(candidate?.source);
  if (candidatePriority !== currentPriority) {
    return candidatePriority > currentPriority;
  }

  return !hasAccountUsageSummaryData(current) && hasAccountUsageSummaryData(candidate);
}

export function deriveAccountUsageFreshness(
  summary: AccountUsageSummary | null | undefined,
  now = Date.now(),
  thresholds: AccountUsageFreshnessThresholds = DEFAULT_ACCOUNT_USAGE_FRESHNESS_THRESHOLDS,
): AccountUsageFreshness {
  const normalized = normalizeAccountUsageSummary(summary);
  if (!hasAccountUsageSummaryData(normalized)) {
    return "unknown";
  }
  const referenceAt: number | null = normalized.lastCheckedAt ?? normalized.lastObservedAt ?? null;
  if (referenceAt === null) {
    return normalized.source === "restored" ? "restored" : "stale";
  }
  const ageMs = Math.max(0, now - referenceAt);
  if (normalized.source === "live" && ageMs <= thresholds.liveMs) {
    return "live";
  }
  if (
    (normalized.source === "active_poll" ||
      normalized.source === "idle_poll" ||
      normalized.source === "session_backfill") &&
    ageMs <= thresholds.polledMs
  ) {
    return "polled";
  }
  if (normalized.source === "restored" && ageMs <= thresholds.staleMs) {
    return "restored";
  }
  return "stale";
}

export function extractUsageSummaryPatch(event: unknown): UsageSummaryPatch | null {
  const tokenCount = extractTokenCountRecord(event);
  if (!tokenCount) {
    return null;
  }

  const info = asRecord(tokenCount.info);
  const rateLimits = asRecord(tokenCount.rate_limits);
  const primary = asRecord(rateLimits?.primary);
  const secondary = asRecord(rateLimits?.secondary);

  const patch: UsageSummaryPatch = {};
  const lastTurn = parseUsageMetric(info?.last_token_usage);
  const total = parseUsageMetric(info?.total_token_usage);
  if (lastTurn) {
    patch.lastTurn = lastTurn;
  }
  if (total) {
    patch.total = total;
  }

  const limits: UsageSummaryPatch["limits"] = {};
  const fiveHourPercent = asNumber(primary?.used_percent);
  const weekPercent = asNumber(secondary?.used_percent);
  const planType = asString(rateLimits?.plan_type);
  if (fiveHourPercent !== null) {
    limits.fiveHourPercent = fiveHourPercent;
  }
  if (weekPercent !== null) {
    limits.weekPercent = weekPercent;
  }
  if (planType) {
    limits.planType = planType;
  }
  if (Object.keys(limits).length > 0) {
    patch.limits = limits;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}
