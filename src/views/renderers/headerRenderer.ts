import { Notice, setIcon } from "obsidian";
import { canCloseTab, shouldShowTabBadges } from "../../util/tabBadges";
import { buildHeaderActionState } from "./viewModels/workspaceViewModels";
import type { WorkspaceRenderCallbacks, WorkspaceRenderContext } from "./types";
import { isTabStreaming } from "./workspaceViewShared";

export class HeaderRenderer {
  constructor(
    private readonly root: HTMLDivElement,
    private readonly callbacks: Pick<WorkspaceRenderCallbacks, "openSettings">,
  ) {}

  render(context: WorkspaceRenderContext): void {
    const { copy, service, state, activeTab } = context;
    const actionState = buildHeaderActionState(state, activeTab, service.getMaxOpenTabs());

    this.root.empty();
    this.root.addClass("obsidian-codex__header");

    const titleSlotEl = this.root.createDiv({ cls: "obsidian-codex__title-slot" });
    titleSlotEl.createEl("h4", { cls: "obsidian-codex__title-text", text: copy.workspace.title });
    const tabBarEl = titleSlotEl.createDiv({ cls: "obsidian-codex__tab-bar" });
    this.renderTabs(tabBarEl, context);

    const headerActionsEl = this.root.createDiv({ cls: "obsidian-codex__header-actions" });

    const newTabButton = this.createHeaderButton(headerActionsEl, copy.workspace.header.newTab, "plus", () => {
      if (!service.createTab()) {
        new Notice(copy.notices.openChatsLimited(service.getMaxOpenTabs()));
      }
    });
    newTabButton.addClass("obsidian-codex__new-tab-btn");
    newTabButton.dataset.smoke = "header-new-tab";
    newTabButton.disabled = actionState.newTabDisabled;

    const newSessionButton = this.createHeaderButton(
      headerActionsEl,
      copy.workspace.header.newSession,
      "rotate-ccw",
      () => {
        if (!activeTab) {
          return;
        }
        if (!service.startNewSession(activeTab.id)) {
          new Notice(copy.notices.cannotStartNewSession);
        }
      },
    );
    newSessionButton.dataset.smoke = "header-new-session";
    newSessionButton.disabled = actionState.newSessionDisabled;

    const forkButton = this.createHeaderButton(headerActionsEl, copy.workspace.header.forkConversation, "git-branch", () => {
      if (!activeTab) {
        return;
      }
      if (!service.forkTab(activeTab.id)) {
        new Notice(copy.notices.cannotForkConversation);
      }
    });
    forkButton.dataset.smoke = "header-fork";
    forkButton.disabled = actionState.forkDisabled;

    const resumeButton = this.createHeaderButton(headerActionsEl, copy.workspace.header.resumeThread, "history", () => {
      if (!activeTab) {
        return;
      }
      if (!service.resumeTab(activeTab.id)) {
        new Notice(copy.notices.noResumableThread);
      }
    });
    resumeButton.dataset.smoke = "header-resume";
    resumeButton.disabled = actionState.resumeDisabled;

    const compactButton = this.createHeaderButton(headerActionsEl, copy.workspace.header.compactConversation, "scissors", () => {
      if (!activeTab) {
        return;
      }
      service.compactTab(activeTab.id);
    });
    compactButton.dataset.smoke = "header-compact";
    compactButton.disabled = actionState.compactDisabled;

    const settingsButton = this.createHeaderButton(headerActionsEl, copy.workspace.header.settings, "settings", () => {
      this.callbacks.openSettings();
    });
    settingsButton.dataset.smoke = "header-settings";
  }

  private renderTabs(tabBarEl: HTMLDivElement, context: WorkspaceRenderContext): void {
    const { copy, service, state } = context;
    if (!shouldShowTabBadges(state.tabs.length)) {
      return;
    }

    const closable = canCloseTab(state.tabs.length);
    const badges = tabBarEl.createDiv({ cls: "obsidian-codex__tab-badges" });
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

  private createHeaderButton(
    parent: HTMLElement,
    label: string,
    iconName: string,
    action: () => void,
  ): HTMLButtonElement {
    const button = parent.createEl("button", { cls: "obsidian-codex__header-btn" });
    button.type = "button";
    button.ariaLabel = label;
    button.title = label;
    setIcon(button, iconName);
    button.addEventListener("click", action);
    return button;
  }
}
