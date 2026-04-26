import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { validateManagedAssetPath, validateManagedFolderPath, validateManagedNotePath } from "../util/vaultPathPolicy";

function createApp(basePath?: string): App {
  return {
    vault: {
      adapter: {
        basePath,
      },
    },
  } as unknown as App;
}

describe("vaultPathPolicy", () => {
  it("rejects managed note paths when the vault base path is missing", () => {
    const result = validateManagedNotePath(createApp(""), "notes/source.md");

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing_base_path");
  });

  it("rejects managed folder paths when the vault base path is missing", () => {
    const result = validateManagedFolderPath(createApp(""), "notes/archive");

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing_base_path");
  });

  it("accepts valid note and folder paths when the vault base path is known", () => {
    const noteResult = validateManagedNotePath(createApp("/vault"), "notes/source.md");
    const folderResult = validateManagedFolderPath(createApp("/vault"), "notes/archive");

    expect(noteResult).toEqual({
      ok: true,
      normalizedPath: "notes/source.md",
      reason: "empty",
    });
    expect(folderResult).toEqual({
      ok: true,
      normalizedPath: "notes/archive",
      reason: "empty",
    });
  });

  it("allows generated SVG assets only in the managed diagram folder", () => {
    expect(validateManagedAssetPath(createApp("/vault"), "assets/noteforge/diagrams/power-flow.svg")).toEqual({
      ok: true,
      normalizedPath: "assets/noteforge/diagrams/power-flow.svg",
      reason: "empty",
    });

    expect(validateManagedAssetPath(createApp("/vault"), "assets/noteforge/power-flow.svg")).toMatchObject({
      ok: false,
      reason: "outside_managed_assets",
    });
    expect(validateManagedAssetPath(createApp("/vault"), "assets/noteforge/diagrams/power-flow.png")).toMatchObject({
      ok: false,
      reason: "unsupported_extension",
    });
    expect(validateManagedAssetPath(createApp("/vault"), "assets/noteforge/diagrams/.hidden.svg")).toMatchObject({
      ok: false,
      reason: "hidden_segment",
    });
  });
});
