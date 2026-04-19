import { Notice, setIcon } from "obsidian";
import { buildHeaderActionState } from "./viewModels/workspaceViewModels";
import { renderWorkspaceTabBadges } from "./tabBarRenderer";
import type { WorkspaceRenderCallbacks, WorkspaceRenderContext } from "./types";

type HeaderActionDescriptor = {
  label: string;
  icon: string;
  smokeId: string;
  disabled: boolean;
  run(): void;
};

export class HeaderRenderer {
  constructor(
    private readonly root: HTMLDivElement,
    private readonly callbacks: Pick<WorkspaceRenderCallbacks, "openSettings">,
  ) {}

  render(context: WorkspaceRenderContext): void {
    const { copy, service, state, activeTab } = context;
    const actionState = buildHeaderActionState(state, activeTab, service.getMaxOpenTabs());
    const actions = this.buildActions(context, actionState);

    this.root.empty();
    this.root.addClass("obsidian-codex__header");

    const titleSlotEl = this.root.createDiv({ cls: "obsidian-codex__title-slot" });
    titleSlotEl.createEl("h4", { cls: "obsidian-codex__title-text", text: copy.workspace.title });
    const tabBarPosition = context.service.getTabBarPosition?.() ?? "header";
    if (tabBarPosition === "header") {
      const tabBarEl = titleSlotEl.createDiv({ cls: "obsidian-codex__tab-bar" });
      renderWorkspaceTabBadges(tabBarEl, context);
    }

    const headerActionsEl = this.root.createDiv({ cls: "obsidian-codex__header-actions" });
    for (const action of actions) {
      const button = this.createHeaderButton(headerActionsEl, action.label, action.icon, () => {
        action.run();
      });
      if (action.smokeId === "header-new-tab") {
        button.addClass("obsidian-codex__new-tab-btn");
      }
      button.dataset.smoke = action.smokeId;
      button.disabled = action.disabled;
    }
  }

  private buildActions(context: WorkspaceRenderContext, actionState: ReturnType<typeof buildHeaderActionState>): HeaderActionDescriptor[] {
    const { copy, service, activeTab } = context;
    return [
      {
        label: copy.workspace.header.newTab,
        icon: "plus",
        smokeId: "header-new-tab",
        disabled: actionState.newTabDisabled,
        run: () => {
          if (!service.createTab()) {
            new Notice(copy.notices.openChatsLimited(service.getMaxOpenTabs()));
          }
        },
      },
      {
        label: copy.workspace.header.newSession,
        icon: "rotate-ccw",
        smokeId: "header-new-session",
        disabled: actionState.newSessionDisabled,
        run: () => {
          if (!activeTab) {
            return;
          }
          if (!service.startNewSession(activeTab.id)) {
            new Notice(copy.notices.cannotStartNewSession);
          }
        },
      },
      {
        label: copy.workspace.header.forkConversation,
        icon: "git-branch",
        smokeId: "header-fork",
        disabled: actionState.forkDisabled,
        run: () => {
          if (!activeTab) {
            return;
          }
          if (!service.forkTab(activeTab.id)) {
            new Notice(copy.notices.cannotForkConversation);
          }
        },
      },
      {
        label: copy.workspace.header.resumeThread,
        icon: "history",
        smokeId: "header-resume",
        disabled: actionState.resumeDisabled,
        run: () => {
          if (!activeTab) {
            return;
          }
          if (!service.resumeTab(activeTab.id)) {
            new Notice(copy.notices.noResumableThread);
          }
        },
      },
      {
        label: copy.workspace.header.compactConversation,
        icon: "scissors",
        smokeId: "header-compact",
        disabled: actionState.compactDisabled,
        run: () => {
          if (!activeTab) {
            return;
          }
          service.compactTab(activeTab.id);
        },
      },
      {
        label: copy.workspace.header.settings,
        icon: "settings",
        smokeId: "header-settings",
        disabled: false,
        run: () => {
          this.callbacks.openSettings();
        },
      },
    ];
  }

  private createHeaderButton(
    parent: HTMLElement,
    label: string,
    iconName: string,
    action: (event: MouseEvent) => void,
  ): HTMLButtonElement {
    const button = parent.createEl("button", { cls: "obsidian-codex__header-btn" });
    button.type = "button";
    button.ariaLabel = label;
    button.title = label;
    setIcon(button, iconName);
    button.addEventListener("click", (event) => action(event));
    return button;
  }
}
