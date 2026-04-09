import type { AccountUsageSource, AccountUsageSummary, UsageSummary } from "../model/types";

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
    threadId: null,
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
    threadId?: string | null;
  },
): AccountUsageSummary {
  return {
    limits: {
      fiveHourPercent: patch.limits?.fiveHourPercent ?? current.limits.fiveHourPercent,
      weekPercent: patch.limits?.weekPercent ?? current.limits.weekPercent,
      planType: patch.limits?.planType ?? current.limits.planType,
    },
    source: patch.source ?? current.source,
    updatedAt: patch.updatedAt ?? current.updatedAt,
    threadId: patch.threadId ?? current.threadId,
  };
}

export function hasAccountUsageSummaryData(summary: AccountUsageSummary | null | undefined): boolean {
  return Boolean(
    summary?.limits.fiveHourPercent !== null ||
      summary?.limits.weekPercent !== null ||
      summary?.limits.planType ||
      summary?.source,
  );
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
