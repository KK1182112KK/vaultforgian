import { setIcon } from "obsidian";
import type { WorkspaceRenderCallbacks, WorkspaceRenderContext } from "./types";
import { buildComposerDisplayState } from "./viewModels/workspaceViewModels";
import { ComposerContextSections } from "./composer/composerContextSections";
import { ComposerInputController } from "./composer/composerInputController";
import { ComposerStatusControls } from "./composer/composerStatusControls";
import type { ComposerCallbacks, ComposerElements, ComposerSharedState } from "./composer/types";

export class ComposerRenderer {
  private readonly elements: ComposerElements;
  private readonly state: ComposerSharedState = {
    context: null,
    composerSuggestions: [],
    composerSelectedIndex: 0,
    statusMenuEl: null,
    statusMenuAnchorEl: null,
    statusMenuCloseHandler: null,
    historyByTab: new Map(),
    lastAppliedDraftByTab: new Map(),
    lastRenderedTabId: null,
    isSending: false,
    isApplyingHistoryDraft: false,
  };
  private readonly inputController: ComposerInputController;
  private readonly statusControls: ComposerStatusControls;
  private readonly contextSections: ComposerContextSections;

  constructor(
    private readonly root: HTMLDivElement,
    callbacks: Pick<
      WorkspaceRenderCallbacks,
      "attachBrowserFiles" | "focusComposer" | "openTargetNote" | "resolvePromptContext"
    >,
  ) {
    this.elements = this.buildElements();
    const composerCallbacks: ComposerCallbacks = callbacks;
    this.statusControls = new ComposerStatusControls(this.elements, this.state);
    this.inputController = new ComposerInputController(this.elements, this.state, composerCallbacks);
    this.contextSections = new ComposerContextSections({
      elements: this.elements,
      state: this.state,
      callbacks: composerCallbacks,
      closeStatusMenu: () => this.closeStatusMenu(),
    });
  }

  render(context: WorkspaceRenderContext): void {
    this.state.context = context;
    const displayState = buildComposerDisplayState(context.activeTab, context.service.getHubPanels(), context.locale);
    this.root.dataset.workflow = context.activeTab?.studyWorkflow ?? "";
    this.elements.planModeTextEl.textContent = context.copy.workspace.planMode;

    this.contextSections.render(displayState);
    this.statusControls.render();
    this.inputController.render(displayState.placeholder);
  }

  closeStatusMenu(): void {
    this.statusControls.closeStatusMenu();
  }

  focusComposer(): void {
    this.inputController.focusComposer();
  }

  openAttachmentPicker(): void {
    this.inputController.openAttachmentPicker();
  }

  async setDraftAndSend(prompt: string): Promise<void> {
    await this.inputController.setDraftAndSend(prompt);
  }

  syncInputHeight(reset = false): void {
    this.inputController.syncInputHeight(reset);
  }

  private buildElements(): ComposerElements {
    this.root.addClass("obsidian-codex__input-area");
    const composerFlagsEl = this.root.createDiv({ cls: "obsidian-codex__composer-flags" });
    const planModeTextEl = composerFlagsEl.createDiv({ cls: "obsidian-codex__plan-mode-text" });
    const workflowBriefEl = this.root.createDiv({ cls: "obsidian-codex__workflow-brief" });
    const slashMenuEl = this.root.createDiv({ cls: "obsidian-codex__slash-menu" });
    const contextRowEl = this.root.createDiv({ cls: "obsidian-codex__context-row" });
    const referenceDocEl = contextRowEl.createDiv({ cls: "obsidian-codex__reference-doc" });
    const pinnedContextEl = contextRowEl.createDiv({ cls: "obsidian-codex__pinned-context" });
    const instructionRowEl = this.root.createDiv({ cls: "obsidian-codex__instruction-row" });
    const selectionPreviewEl = this.root.createDiv({ cls: "obsidian-codex__selection-preview" });
    const attachmentsRowEl = this.root.createDiv({ cls: "obsidian-codex__attachments-row" });
    const changesTrayEl = this.root.createDiv({ cls: "obsidian-codex__changes-tray" });

    const inputRowEl = this.root.createDiv({ cls: "obsidian-codex__input-row" });
    const inputEl = inputRowEl.createEl("textarea", {
      cls: "obsidian-codex__input",
      attr: { rows: "1" },
    });
    inputEl.disabled = false;
    inputEl.readOnly = false;
    inputEl.tabIndex = 0;
    inputEl.dataset.smoke = "composer-input";
    inputRowEl.addEventListener("mousedown", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      if (
        target === inputEl ||
        target.closest(".obsidian-codex__input") ||
        target.closest("button") ||
        target.closest("a") ||
        target.closest(".obsidian-codex__slash-menu") ||
        target.closest(".obsidian-codex__status-menu")
      ) {
        return;
      }
      window.requestAnimationFrame(() => {
        if (document.activeElement !== inputEl) {
          inputEl.focus();
        }
      });
    });

    const inputActionsEl = inputRowEl.createDiv({ cls: "obsidian-codex__input-actions" });
    const attachButtonEl = inputActionsEl.createEl("button", {
      cls: "obsidian-codex__attach-btn",
      attr: { type: "button" },
    });
    setIcon(attachButtonEl, "paperclip");

    const sendButton = inputActionsEl.createEl("button", { cls: "obsidian-codex__send-btn" });
    sendButton.type = "button";
    const sendIconEl = sendButton.createSpan({ cls: "obsidian-codex__send-btn-icon" });
    setIcon(sendIconEl, "send");

    const fileInputEl = this.root.createEl("input", {
      cls: "obsidian-codex__file-input",
      attr: { type: "file", multiple: "true" },
    });

    const statusBarEl = this.root.createDiv({ cls: "obsidian-codex__status-bar" });
    const statusPrimaryEl = statusBarEl.createDiv({ cls: "obsidian-codex__status-primary" });
    const statusControlsEl = statusPrimaryEl.createDiv({ cls: "obsidian-codex__status-controls" });
    const modelGroupEl = statusControlsEl.createDiv({
      cls: "obsidian-codex__status-stack obsidian-codex__status-stack-model",
    });
    const modelButtonEl = modelGroupEl.createEl("button", {
      cls: "obsidian-codex__status-picker obsidian-codex__status-picker-model",
    });
    modelButtonEl.type = "button";
    const modelValueEl = modelButtonEl.createSpan({ cls: "obsidian-codex__status-picker-value" });
    const modelChevron = modelButtonEl.createSpan({ cls: "obsidian-codex__status-picker-chevron" });
    setIcon(modelChevron, "chevron-down");

    const thinkingButtonEl = statusControlsEl.createEl("button", {
      cls: "obsidian-codex__status-picker obsidian-codex__status-picker-thinking",
    });
    thinkingButtonEl.type = "button";
    const thinkingValueEl = thinkingButtonEl.createSpan({ cls: "obsidian-codex__status-picker-value" });
    const thinkingChevron = thinkingButtonEl.createSpan({ cls: "obsidian-codex__status-picker-chevron" });
    setIcon(thinkingChevron, "chevron-down");

    const executionStateEl = statusPrimaryEl.createDiv({ cls: "obsidian-codex__execution-state" });
    const usageMetersEl = statusPrimaryEl.createDiv({ cls: "obsidian-codex__usage-meters" });
    const planWarningEl = statusBarEl.createDiv({ cls: "obsidian-codex__plan-warning" });
    const modifierControlEl = statusBarEl.createEl("button", {
      cls: "obsidian-codex__workflow-brief-add-modifier obsidian-codex__status-modifier-control",
    });
    modifierControlEl.type = "button";

    const fastModeControlEl = statusBarEl.createEl("button", { cls: "obsidian-codex__fastmode-control" });
    fastModeControlEl.type = "button";
    const fastModeLabel = fastModeControlEl.createDiv({ cls: "obsidian-codex__fastmode-label" });
    const fastModeTextEl = fastModeLabel.createSpan({ cls: "obsidian-codex__fastmode-text" });
    const fastModeToggle = fastModeControlEl.createDiv({ cls: "obsidian-codex__toggle-switch" });
    fastModeToggle.createDiv({ cls: "obsidian-codex__toggle-knob" });

    const yoloControlEl = statusBarEl.createEl("button", { cls: "obsidian-codex__yolo-control" });
    yoloControlEl.type = "button";
    const yoloLabel = yoloControlEl.createDiv({ cls: "obsidian-codex__yolo-label" });
    yoloLabel.createSpan({ cls: "obsidian-codex__yolo-text" });
    const yoloToggle = yoloControlEl.createDiv({ cls: "obsidian-codex__toggle-switch" });
    yoloToggle.createDiv({ cls: "obsidian-codex__toggle-knob" });

    return {
      root: this.root,
      composerFlagsEl,
      slashMenuEl,
      contextRowEl,
      referenceDocEl,
      pinnedContextEl,
      instructionRowEl,
      selectionPreviewEl,
      attachmentsRowEl,
      changesTrayEl,
      planModeTextEl,
      workflowBriefEl,
      inputRowEl,
      attachButtonEl,
      inputEl,
      sendButton,
      sendIconEl,
      fileInputEl,
      statusBarEl,
      statusPrimaryEl,
      statusControlsEl,
      modelGroupEl,
      modelButtonEl,
      modelValueEl,
      executionStateEl,
      usageMetersEl,
      planWarningEl,
      modifierControlEl,
      fastModeControlEl,
      fastModeTextEl,
      thinkingButtonEl,
      thinkingValueEl,
      yoloControlEl,
    };
  }
}
