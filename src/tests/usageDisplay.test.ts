import { describe, expect, it } from "vitest";
import { createEmptyUsageSummary } from "../util/usage";
import { getVisibleUsageMeters } from "../util/usageDisplay";

describe("usage display helpers", () => {
  it("returns no meters when no rate limit data is available", () => {
    expect(getVisibleUsageMeters(createEmptyUsageSummary())).toEqual([]);
  });

  it("returns five-hour and week meters in fixed order", () => {
    expect(
      getVisibleUsageMeters({
        ...createEmptyUsageSummary(),
        limits: {
          fiveHourPercent: 42,
          weekPercent: 71,
          planType: "plus",
        },
      }),
    ).toEqual([
      {
        key: "fiveHour",
        label: "5H",
        percent: 58,
        displayPercent: 58,
        usedPercent: 42,
        displayUsedPercent: 42,
      },
      {
        key: "week",
        label: "WEEK",
        percent: 29,
        displayPercent: 29,
        usedPercent: 71,
        displayUsedPercent: 71,
      },
    ]);
  });

  it("keeps a single visible meter and clamps percent values", () => {
    expect(
      getVisibleUsageMeters({
        ...createEmptyUsageSummary(),
        limits: {
          fiveHourPercent: 133,
          weekPercent: null,
          planType: null,
        },
      }),
    ).toEqual([
      {
        key: "fiveHour",
        label: "5H",
        percent: 0,
        displayPercent: 0,
        usedPercent: 100,
        displayUsedPercent: 100,
      },
    ]);
  });
});
