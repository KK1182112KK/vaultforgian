import { describe, expect, it } from "vitest";
import { extractSkillReferences, hasExplicitSkillRequest } from "../util/skillRouting";

describe("skill routing", () => {
  it("extracts unique explicit skill references in order", () => {
    expect(extractSkillReferences("Use $techdebt and then $hand-off? no, $techdebt again.")).toEqual([
      { raw: "$techdebt", name: "techdebt" },
      { raw: "$hand-off", name: "hand-off" },
    ]);
  });

  it("supports namespaced skill ids", () => {
    expect(extractSkillReferences("Run $github:gh-fix-ci on this repo.")).toEqual([
      { raw: "$github:gh-fix-ci", name: "github:gh-fix-ci" },
    ]);
  });

  it("detects whether a prompt explicitly requests a skill", () => {
    expect(hasExplicitSkillRequest("plain prompt")).toBe(false);
    expect(hasExplicitSkillRequest("Please use $slides")).toBe(true);
  });

  it("does not treat inline math variables or numbers as skill references", () => {
    expect(extractSkillReferences("Use $a^2 + b^2 = c^2$ and try $3$, $5$, $12$, $13$.")).toEqual([]);
    expect(extractSkillReferences("Compare $a$ and $b$ before using $deep-read.")).toEqual([
      { raw: "$deep-read", name: "deep-read" },
    ]);
    expect(hasExplicitSkillRequest("Formula: $a$ / $b$ / $c$")).toBe(false);
  });
});
