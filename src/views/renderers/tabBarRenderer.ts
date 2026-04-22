import { canCloseTab, shouldShowTabBadges } from "../../util/tabBadges";
import type { WorkspaceRenderContext } from "./types";
import { isTabStreaming } from "./workspaceViewShared";

export function renderWorkspaceTabBadges(parent: HTMLElement, context: WorkspaceRenderContext): void {
  const { copy, service, state } = context;
  parent.empty();
  if (!shouldShowTabBadges(state.tabs.length)) {
    return;
  }

  const closable = canCloseTab(state.tabs.length);
  const badges = parent.createDiv({ cls: "obsidian-codex__tab-badges" });
  for (const [index, tab] of state.tabs.slice(0, service.getMaxOpenTabs()).entries()) {
    let cls = "obsidian-codex__tab-badge";
    if (tab.id === state.activeTabId) {
      cls += " obsidian-codex__tab-badge-active";
    }
    if (isTabStreaming(tab.status)) {
      cls += " obsidian-codex__tab-badge-streaming";
    } else if (tab.status === "error") {
      cls += " obsidian-codex__tab-badge-attention";
    }

    const badge = badges.createEl("button", { cls, text: String(index + 1) });
    badge.type = "button";
    badge.ariaLabel = tab.title || `${copy.workspace.title} ${index + 1}`;
    badge.title = tab.title || `${copy.workspace.header.newTab} ${index + 1}`;
    badge.addEventListener("click", () => {
      service.activateTab(tab.id);
    });
    badge.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (closable && !isTabStreaming(tab.status)) {
        service.closeTab(tab.id);
      }
    });
    badge.addEventListener("auxclick", (event) => {
      if (event.button === 1 && closable && !isTabStreaming(tab.status)) {
        service.closeTab(tab.id);
      }
    });
  }
}
