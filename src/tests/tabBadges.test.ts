import { describe, expect, it } from "vitest";
import { canCloseTab, shouldShowTabBadges } from "../util/tabBadges";

describe("tab badge helpers", () => {
  it("shows badges when at least one tab exists", () => {
    expect(shouldShowTabBadges(0)).toBe(false);
    expect(shouldShowTabBadges(1)).toBe(true);
    expect(shouldShowTabBadges(2)).toBe(true);
  });

  it("only allows closing when more than one tab exists", () => {
    expect(canCloseTab(0)).toBe(false);
    expect(canCloseTab(1)).toBe(false);
    expect(canCloseTab(2)).toBe(true);
  });
});
