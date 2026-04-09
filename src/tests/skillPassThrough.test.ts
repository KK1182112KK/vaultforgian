import { describe, expect, it } from "vitest";
import { extractSkillReferences } from "../util/skillRouting";

describe("explicit skill pass-through", () => {
  it("preserves unknown explicit skill references instead of rejecting them in the plugin layer", () => {
    expect(extractSkillReferences("Use $grill-me and $custom:hidden-skill for this plan.").map((entry) => entry.name)).toEqual([
      "grill-me",
      "custom:hidden-skill",
    ]);
  });
});
