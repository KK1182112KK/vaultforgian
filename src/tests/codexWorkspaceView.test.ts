// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { CodexWorkspaceView, syncWorkspaceLeafBranding } from "../views/codexWorkspaceView";
import { installObsidianDomHelpers } from "./setup/obsidian";

describe("syncWorkspaceLeafBranding", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    installObsidianDomHelpers();
  });

  it("updates the visible leaf header and persists the renamed title when the cached state is stale", async () => {
    const titleEl = document.createElement("div");
    const iconEl = document.createElement("div");
    const setViewState = vi.fn(async () => {});
    const leaf = {
      getViewState: vi.fn(() => ({
        type: "obsidian-codex-study-workspace",
        state: {},
        title: "Obsidian Codex Study",
        icon: "sparkles",
      })),
      setViewState,
      tabHeaderInnerTitleEl: titleEl,
      tabHeaderIconEl: iconEl,
    };

    await syncWorkspaceLeafBranding(leaf as never, "Codex Noteforge", "sparkles", { persist: true });

    expect(titleEl.textContent).toBe("Codex Noteforge");
    expect(iconEl.dataset.icon).toBe("sparkles");
    expect(setViewState).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Codex Noteforge",
        icon: "sparkles",
      }),
    );
  });

  it("avoids rewriting leaf state when the persisted branding is already current", async () => {
    const titleEl = document.createElement("div") as HTMLDivElement & { setText?: (text: string) => void };
    const setText = vi.fn((text: string) => {
      titleEl.textContent = text;
    });
    titleEl.setText = setText;
    const setViewState = vi.fn(async () => {});
    const leaf = {
      getViewState: vi.fn(() => ({
        type: "obsidian-codex-study-workspace",
        state: {},
        title: "Codex Noteforge",
        icon: "sparkles",
      })),
      setViewState,
      tabHeaderInnerTitleEl: titleEl,
      tabHeaderIconEl: document.createElement("div"),
    };

    await syncWorkspaceLeafBranding(leaf as never, "Codex Noteforge", "sparkles", { persist: true });

    expect(setText).toHaveBeenCalledWith("Codex Noteforge");
    expect(setViewState).not.toHaveBeenCalled();
  });
});

describe("CodexWorkspaceView Panel Studio opening", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    installObsidianDomHelpers();
  });

  it("opens Panel Studio without forcing the workspace scroll position", () => {
    const openStudyHub = vi.fn();
    const view = new CodexWorkspaceView({} as never, { openStudyHub } as never) as unknown as {
      showIngestHubPanel: () => void;
      ingestHubPanelEl: HTMLDivElement;
    };
    const panelEl = document.createElement("div");
    const scrollIntoView = vi.fn();
    panelEl.scrollIntoView = scrollIntoView;
    view.ingestHubPanelEl = panelEl;

    view.showIngestHubPanel();

    expect(openStudyHub).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
