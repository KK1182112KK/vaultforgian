import type { AccountUsageSummary, UsageSummary } from "../model/types";

export interface UsageMeter {
  key: "fiveHour" | "week";
  label: "5H" | "WEEK";
  percent: number;
  displayPercent: number;
  usedPercent: number;
  displayUsedPercent: number;
}

function clampUsagePercent(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.min(100, value));
}

function toRemainingPercent(value: number): number {
  return Math.max(0, Math.min(100, 100 - value));
}

type UsageDisplaySource = Pick<UsageSummary, "limits"> | AccountUsageSummary;

export function getVisibleUsageMeters(summary: UsageDisplaySource | null | undefined): UsageMeter[] {
  const fiveHourPercent = clampUsagePercent(summary?.limits?.fiveHourPercent);
  const weekPercent = clampUsagePercent(summary?.limits?.weekPercent);
  const meters: UsageMeter[] = [];

  if (fiveHourPercent !== null) {
    const remaining = toRemainingPercent(fiveHourPercent);
    meters.push({
      key: "fiveHour",
      label: "5H",
      percent: remaining,
      displayPercent: Math.round(remaining),
      usedPercent: Math.round(fiveHourPercent * 100) / 100,
      displayUsedPercent: Math.round(fiveHourPercent),
    });
  }

  if (weekPercent !== null) {
    const remaining = toRemainingPercent(weekPercent);
    meters.push({
      key: "week",
      label: "WEEK",
      percent: remaining,
      displayPercent: Math.round(remaining),
      usedPercent: Math.round(weekPercent * 100) / 100,
      displayUsedPercent: Math.round(weekPercent),
    });
  }

  return meters;
}
