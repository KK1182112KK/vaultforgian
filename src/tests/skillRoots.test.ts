import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import { expandHomePath, normalizeConfiguredSkillRoots } from "../util/skillRoots";

describe("skill root helpers", () => {
  it("expands home-relative paths and removes duplicates", () => {
    expect(
      normalizeConfiguredSkillRoots([
        "~/skills",
        " /tmp/custom-skills ",
        "~/skills",
        "",
      ]),
    ).toEqual([`${homedir()}/skills`, "/tmp/custom-skills"]);
  });

  it("leaves absolute paths unchanged", () => {
    expect(expandHomePath("/var/tmp/skills")).toBe("/var/tmp/skills");
  });
});
