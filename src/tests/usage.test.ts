import { describe, expect, it } from "vitest";
import {
  deriveAccountUsageFreshness,
  createEmptyAccountUsageSummary,
  createEmptyUsageSummary,
  extractUsageSummaryPatch,
  hasAccountUsageSummaryData,
  mergeAccountUsageSummary,
  mergeUsageSummary,
  shouldPreferAccountUsageSummary,
} from "../util/usage";

describe("usage helpers", () => {
  it("extracts token_count payloads from Codex events", () => {
    const patch = extractUsageSummaryPatch({
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 5000,
            cached_input_tokens: 1200,
            output_tokens: 640,
            reasoning_output_tokens: 300,
            total_tokens: 5640,
          },
          last_token_usage: {
            input_tokens: 1200,
            cached_input_tokens: 600,
            output_tokens: 180,
            reasoning_output_tokens: 80,
            total_tokens: 1380,
          },
        },
        rate_limits: {
          primary: { used_percent: 3 },
          secondary: { used_percent: 12 },
          plan_type: "plus",
        },
      },
    });

    expect(patch).toEqual({
      lastTurn: {
        inputTokens: 1200,
        cachedInputTokens: 600,
        outputTokens: 180,
        reasoningOutputTokens: 80,
        totalTokens: 1380,
      },
      total: {
        inputTokens: 5000,
        cachedInputTokens: 1200,
        outputTokens: 640,
        reasoningOutputTokens: 300,
        totalTokens: 5640,
      },
      limits: {
        fiveHourPercent: 3,
        weekPercent: 12,
        planType: "plus",
      },
    });
  });

  it("merges partial usage updates without clearing known fields", () => {
    const merged = mergeUsageSummary(createEmptyUsageSummary(), {
      limits: {
        fiveHourPercent: 5,
      },
    });

    expect(merged).toEqual({
      lastTurn: null,
      total: null,
      limits: {
        fiveHourPercent: 5,
        weekPercent: null,
        planType: null,
      },
    });
  });

  it("merges account usage metadata without dropping known limit values", () => {
    const merged = mergeAccountUsageSummary(createEmptyAccountUsageSummary(), {
      limits: {
        fiveHourPercent: 11,
        planType: "pro",
      },
      source: "live",
      updatedAt: 123,
      threadId: "thread-123",
    });

    expect(merged).toEqual({
      limits: {
        fiveHourPercent: 11,
        weekPercent: null,
        planType: "pro",
      },
      source: "live",
      updatedAt: 123,
      lastObservedAt: 123,
      lastCheckedAt: null,
      threadId: "thread-123",
    });
    expect(hasAccountUsageSummaryData(merged)).toBe(true);
  });

  it("derives freshness from source and timestamps", () => {
    expect(
      deriveAccountUsageFreshness({
        ...createEmptyAccountUsageSummary(),
        limits: {
          fiveHourPercent: 10,
          weekPercent: null,
          planType: "plus",
        },
        source: "live",
        updatedAt: 1_000,
        lastObservedAt: 1_000,
        lastCheckedAt: 1_000,
        threadId: "thread-1",
      }, 2_000),
    ).toBe("live");

    expect(
      deriveAccountUsageFreshness({
        ...createEmptyAccountUsageSummary(),
        limits: {
          fiveHourPercent: 10,
          weekPercent: null,
          planType: "plus",
        },
        source: "idle_poll",
        updatedAt: 1_000,
        lastObservedAt: 1_000,
        lastCheckedAt: 10_000,
        threadId: "thread-1",
      }, 20_000),
    ).toBe("polled");
  });

  it("prefers newer or more authoritative account usage snapshots", () => {
    const restored = {
      ...createEmptyAccountUsageSummary(),
      limits: {
        fiveHourPercent: 55,
        weekPercent: null,
        planType: "plus",
      },
      source: "restored" as const,
      updatedAt: 100,
      lastObservedAt: 100,
      lastCheckedAt: 100,
      threadId: "thread-1",
    };
    const live = {
      ...restored,
      source: "live" as const,
      updatedAt: 100,
      lastObservedAt: 100,
      lastCheckedAt: 100,
    };
    expect(shouldPreferAccountUsageSummary(restored, live)).toBe(true);
  });
});
