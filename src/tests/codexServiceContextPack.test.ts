import { describe, expect, it } from "vitest";
import { TFile } from "obsidian";
import { CodexService } from "../app/codexService";
import { DEFAULT_SETTINGS } from "../model/types";

function createApp(files: Record<string, string>, basePath = "/vault") {
  const entries = new Map(
    Object.entries(files).map(([path, content]) => {
      const file = Object.assign(new TFile(), { path }) as TFile;
      return [path, { file, content }] as const;
    }),
  );

  return {
    vault: {
      adapter: { basePath },
      getAbstractFileByPath: (path: string) => entries.get(path)?.file ?? null,
      cachedRead: async (file: TFile) => entries.get(file.path)?.content ?? "",
    },
    workspace: {
      getActiveFile: () => null,
      getMostRecentLeaf: () => null,
    },
  } as never;
}

describe("CodexService context pack capture", () => {
  it("builds prompt text for pinned notes without clearing explicit pins", async () => {
    const service = new CodexService(
      createApp({
        "notes/a.md": "# A\n\nAlpha body.",
        "notes/b.md": "# B\n\nBeta body.",
      }),
      () => DEFAULT_SETTINGS,
      () => "en",
      null,
      async () => {},
      async () => {},
    );

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    service.store.setContextPaths(tabId, ["notes/a.md", "notes/b.md"]);
    const text = await (
      service as unknown as {
        captureContextPackText: (tabId: string, excludedPaths: string[]) => Promise<string | null>;
      }
    ).captureContextPackText(tabId, ["notes/b.md"]);

    expect(text).toContain("Pinned context notes:");
    expect(text).toContain("Pinned note 1: notes/a.md");
    expect(text).not.toContain("notes/b.md");
    expect(service.getActiveTab()?.contextPaths).toEqual(["notes/a.md", "notes/b.md"]);
  });

  it("drops missing pinned notes from persisted tab state while keeping readable notes", async () => {
    const service = new CodexService(
      createApp({
        "notes/a.md": "# A\n\nAlpha body.",
      }),
      () => DEFAULT_SETTINGS,
      () => "en",
      null,
      async () => {},
      async () => {},
    );

    const tabId = service.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    service.store.setContextPaths(tabId, ["notes/a.md", "notes/missing.md"]);
    const text = await (
      service as unknown as {
        captureContextPackText: (tabId: string, excludedPaths: string[]) => Promise<string | null>;
      }
    ).captureContextPackText(tabId, []);

    expect(text).toContain("Pinned note 1: notes/a.md");
    expect(service.getActiveTab()?.contextPaths).toEqual(["notes/a.md"]);
  });
});
