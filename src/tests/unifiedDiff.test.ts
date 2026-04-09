import { describe, expect, it } from "vitest";
import { buildUnifiedDiff } from "../util/unifiedDiff";

describe("buildUnifiedDiff", () => {
  it("renders added and removed lines", () => {
    const diff = buildUnifiedDiff("Notes/Test.md", "alpha\nbeta\ngamma", "alpha\nbeta changed\ngamma\ndelta");

    expect(diff).toContain("--- Notes/Test.md");
    expect(diff).toContain("+++ Notes/Test.md");
    expect(diff).toContain("-beta");
    expect(diff).toContain("+beta changed");
    expect(diff).toContain("+delta");
  });

  it("reports no changes when content is identical", () => {
    expect(buildUnifiedDiff("Notes/Test.md", "same", "same")).toContain("(no changes)");
  });
});
