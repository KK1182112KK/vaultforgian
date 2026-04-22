import { describe, expect, it } from "vitest";
import { resolveEditTarget } from "../util/editTarget";

describe("resolveEditTarget", () => {
  it("prefers an explicit target over every other note hint", () => {
    expect(
      resolveEditTarget({
        explicitTargetPath: "notes/explicit.md",
        selectionSourcePath: "notes/selection.md",
        activeFilePath: "notes/active.md",
        sessionTargetPath: "notes/session.md",
      }),
    ).toEqual({
      path: "notes/explicit.md",
      source: "explicit",
    });
  });

  it("falls back from selection to active note to session target", () => {
    expect(
      resolveEditTarget({
        selectionSourcePath: "notes/selection.md",
        activeFilePath: "notes/active.md",
        sessionTargetPath: "notes/session.md",
      }),
    ).toEqual({
      path: "notes/selection.md",
      source: "selection",
    });

    expect(
      resolveEditTarget({
        activeFilePath: "notes/active.md",
        sessionTargetPath: "notes/session.md",
      }),
    ).toEqual({
      path: "notes/active.md",
      source: "active",
    });

    expect(
      resolveEditTarget({
        sessionTargetPath: "notes/session.md",
      }),
    ).toEqual({
      path: "notes/session.md",
      source: "session",
    });
  });

  it("returns unresolved when no target exists", () => {
    expect(resolveEditTarget({})).toEqual({
      path: null,
      source: "unresolved",
    });
  });
});
