import { describe, expect, it } from "vitest";
import { buildContextPackText, normalizeContextPaths, MAX_CONTEXT_PATHS } from "../util/contextPack";

describe("context pack helpers", () => {
  it("deduplicates and caps pinned context paths", () => {
    expect(
      normalizeContextPaths([
        " notes/a.md ",
        "notes/b.md",
        "notes/a.md",
        "notes/c.md",
        "notes/d.md",
        "notes/e.md",
        "notes/f.md",
        "notes/g.md",
      ]),
    ).toEqual(["notes/a.md", "notes/b.md", "notes/c.md", "notes/d.md", "notes/e.md", "notes/f.md"]);
    expect(MAX_CONTEXT_PATHS).toBe(6);
  });

  it("builds a prompt block for pinned notes", () => {
    expect(
      buildContextPackText([
        {
          path: "projects/spec.md",
          content: "# Spec\n\nShip the feature.",
        },
        {
          path: "daily/2026-04-05.md",
          content: "Need to compare the latest patch.",
        },
      ]),
    ).toContain("Pinned note 1: projects/spec.md");
    expect(
      buildContextPackText([
        {
          path: "projects/spec.md",
          content: "# Spec\n\nShip the feature.",
        },
      ]),
    ).toContain("```md");
  });
});
