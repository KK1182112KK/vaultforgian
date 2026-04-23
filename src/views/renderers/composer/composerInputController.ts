import { Notice, setIcon } from "obsidian";
import {
  applyComposerSuggestion,
  matchComposerSuggestions,
  type ComposerSuggestion,
} from "../../../util/composerSuggestions";
import {
  clearComposerHistoryNavigation,
  EMPTY_COMPOSER_HISTORY_STATE,
  pushComposerHistoryEntry,
  stepComposerHistory,
  type ComposerHistoryState,
} from "../../../util/composerHistory";
import { isTabStreaming } from "../workspaceViewShared";
import type { ComposerCallbacks, ComposerElements, ComposerSharedState } from "./types";

export class ComposerInputController {
  private readonly lastTypedValueByTab = new Map<string, string>();
  private readonly handleInputRowMouseDown = (event: MouseEvent) => {
    if (!this.shouldFocusTextareaFromInputRow(event)) {
      return;
    }
    event.preventDefault();
    this.elements.inputEl.focus();
  };
  private readonly handleInputClick = () => {
    if (document.activeElement !== this.elements.inputEl) {
      this.elements.inputEl.focus();
    }
  };
  private readonly handleInputEvent = () => {
    this.syncInputHeight();
    const tabId = this.context?.activeTab?.id ?? this.context?.service.getActiveTab()?.id ?? null;
    if (tabId) {
      this.lastTypedValueByTab.set(tabId, this.elements.inputEl.value);
      if (!this.state.isApplyingHistoryDraft) {
        const nextHistory = clearComposerHistoryNavigation(this.getHistoryState(tabId));
        this.state.historyByTab.set(tabId, nextHistory);
        this.context?.service.setTabComposerHistory(tabId, nextHistory);
      }
      this.context?.service.setDraft(tabId, this.elements.inputEl.value);
    }
    this.renderComposerSuggestions();
  };
  private readonly handleInputPasteEvent = (event: ClipboardEvent) => {
    void this.handleInputPaste(event);
  };
  private readonly handleInputKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === "Tab" && event.shiftKey) {
      event.preventDefault();
      this.togglePlanMode();
      return;
    }

    if (this.state.composerSuggestions.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        this.moveComposerSelection(1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        this.moveComposerSelection(-1);
        return;
      }
      if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
        event.preventDefault();
        this.applyComposerMenuSuggestion(this.state.composerSuggestions[this.state.composerSelectedIndex] ?? null);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        this.state.composerSuggestions = [];
        this.state.composerSelectedIndex = 0;
        this.renderComposerSuggestions();
        return;
      }
    }

    if (event.key === "ArrowUp" && this.shouldHandleHistoryNavigation("older")) {
      event.preventDefault();
      this.navigateComposerHistory("older");
      return;
    }

    if (event.key === "ArrowDown" && this.shouldHandleHistoryNavigation("newer")) {
      event.preventDefault();
      this.navigateComposerHistory("newer");
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void this.sendCurrentPrompt();
    }
  };
  private readonly handleAttachButtonClick = () => {
    this.openAttachmentPicker();
  };
  private readonly handleSendButtonClick = () => {
    if (this.isBusy()) {
      void this.interruptActiveTurn();
      return;
    }
    void this.sendCurrentPrompt();
  };
  private readonly handleFileInputChangeEvent = () => {
    void this.handleFileInputChange();
  };

  constructor(
    private readonly elements: ComposerElements,
    private readonly state: ComposerSharedState,
    private readonly callbacks: ComposerCallbacks,
  ) {
    this.elements.inputRowEl.addEventListener("mousedown", this.handleInputRowMouseDown);
    this.elements.inputEl.addEventListener("click", this.handleInputClick);
    this.elements.inputEl.addEventListener("input", this.handleInputEvent);
    this.elements.inputEl.addEventListener("paste", this.handleInputPasteEvent);
    this.elements.inputEl.addEventListener("keydown", this.handleInputKeyDown);
    this.elements.attachButtonEl.addEventListener("click", this.handleAttachButtonClick);
    this.elements.sendButton.addEventListener("click", this.handleSendButtonClick);
    this.elements.fileInputEl.addEventListener("change", this.handleFileInputChangeEvent);

    this.syncInputHeight(true);
  }

  private get context() {
    return this.state.context;
  }

  render(placeholder: string): void {
    const context = this.context;
    if (!context) {
      return;
    }
    const activeTabId = context.activeTab?.id ?? null;

    this.elements.inputEl.placeholder = placeholder;
    this.elements.inputEl.disabled = false;
    this.elements.inputEl.readOnly = false;
    this.elements.inputEl.tabIndex = 0;
    this.elements.attachButtonEl.ariaLabel = context.copy.workspace.attachLocalFiles;
    this.elements.attachButtonEl.title = context.copy.workspace.attachLocalFiles;

    const draft = context.activeTab?.draft ?? "";
    if (activeTabId) {
      const persistedHistory = context.activeTab?.composerHistory ?? EMPTY_COMPOSER_HISTORY_STATE;
      this.state.historyByTab.set(activeTabId, {
        entries: [...persistedHistory.entries],
        index: persistedHistory.index,
        draft: persistedHistory.draft,
      });
    }
    this.syncInputValueFromContext(activeTabId, draft);
    this.renderComposerSuggestions();
    this.syncInputHeight();

    const busy = this.isBusy();
    this.renderSendButtonState(busy);
    this.elements.modelButtonEl.disabled = busy;
    this.elements.thinkingButtonEl.disabled = busy;
    this.elements.learningModeControlEl.disabled = busy || !context.activeTab;
    this.elements.fastModeControlEl.disabled = busy || !context.activeTab;
    this.elements.attachButtonEl.disabled = busy;
  }

  focusComposer(): void {
    window.setTimeout(() => {
      this.elements.inputEl.focus();
      const length = this.elements.inputEl.value.length;
      this.elements.inputEl.setSelectionRange(length, length);
    }, 0);
  }

  openAttachmentPicker(): void {
    this.elements.fileInputEl.click();
  }

  dispose(): void {
    this.elements.inputRowEl.removeEventListener("mousedown", this.handleInputRowMouseDown);
    this.elements.inputEl.removeEventListener("click", this.handleInputClick);
    this.elements.inputEl.removeEventListener("input", this.handleInputEvent);
    this.elements.inputEl.removeEventListener("paste", this.handleInputPasteEvent);
    this.elements.inputEl.removeEventListener("keydown", this.handleInputKeyDown);
    this.elements.attachButtonEl.removeEventListener("click", this.handleAttachButtonClick);
    this.elements.sendButton.removeEventListener("click", this.handleSendButtonClick);
    this.elements.fileInputEl.removeEventListener("change", this.handleFileInputChangeEvent);
  }

  async setDraftAndSend(prompt: string): Promise<void> {
    const tabId = this.context?.activeTab?.id ?? this.context?.service.getActiveTab()?.id ?? null;
    if (tabId) {
      this.context?.service.setDraft(tabId, prompt);
      this.state.lastAppliedDraftByTab.set(tabId, prompt);
    }
    this.elements.inputEl.value = prompt;
    await this.sendCurrentPrompt();
  }

  syncInputHeight(reset = false): void {
    this.elements.inputEl.style.height = "auto";
    const nextHeight =
      reset && !this.elements.inputEl.value.trim()
        ? 48
        : Math.min(Math.max(this.elements.inputEl.scrollHeight, 48), 176);
    this.elements.inputEl.style.height = `${nextHeight}px`;
  }

  async sendCurrentPrompt(): Promise<void> {
    const context = this.context;
    const tabId = context?.activeTab?.id ?? context?.service.getActiveTab()?.id ?? null;
    if (!context || !tabId || this.state.isSending) {
      return;
    }

    try {
      this.state.isSending = true;
      this.clearComposerSuggestions();
      this.callbacks.requestRender();
      this.renderSendButtonState(true);
      this.elements.attachButtonEl.disabled = true;
      const shouldCollapseHub =
        this.elements.inputEl.value.trim().length > 0 ||
        context.service.getTabAttachments(tabId).length > 0 ||
        Boolean(context.service.getTabSelectionContext(tabId));
      const draftValue = this.elements.inputEl.value;
      const { editor, file } = this.callbacks.resolvePromptContext();
      await context.service.sendPrompt(tabId, draftValue, { file, editor });
      this.state.lastAppliedDraftByTab.set(tabId, "");
      const nextHistory = pushComposerHistoryEntry(this.getHistoryState(tabId), draftValue);
      this.state.historyByTab.set(tabId, nextHistory);
      context.service.setTabComposerHistory(tabId, nextHistory);
      if (shouldCollapseHub && !context.service.getStudyHubState().isCollapsed) {
        context.service.setStudyHubCollapsed(true);
      }
      this.syncInputHeight(true);
    } catch (error) {
      new Notice((error as Error).message);
    } finally {
      this.state.isSending = false;
      this.callbacks.requestRender();
      const busy = this.isBusy();
      this.renderSendButtonState(busy);
      this.elements.attachButtonEl.disabled = busy;
    }
  }

  private renderSendButtonState(isBusy: boolean): void {
    const copy = this.context?.copy;
    this.elements.sendButton.classList.toggle("is-busy", isBusy);
    this.elements.sendButton.ariaLabel = isBusy
      ? copy?.commands.interruptActiveTurn ?? "Interrupt active Codex turn"
      : copy?.workspace.send ?? "Send";
    this.elements.sendButton.title = isBusy
      ? copy?.commands.interruptActiveTurn ?? "Interrupt active Codex turn"
      : copy?.workspace.send ?? "Send";
    setIcon(this.elements.sendIconEl, isBusy ? "square" : "send");
  }

  private async interruptActiveTurn(): Promise<void> {
    const context = this.context;
    const tabId = context?.activeTab?.id ?? context?.service.getActiveTab()?.id ?? null;
    if (!context || !tabId) {
      return;
    }
    await context.service.interruptActiveTurn(tabId);
  }

  private isBusy(): boolean {
    return this.state.isSending || isTabStreaming(this.context?.activeTab?.status);
  }

  private getHistoryState(tabId: string): ComposerHistoryState {
    return this.state.historyByTab.get(tabId) ?? this.context?.service.getTabComposerHistory(tabId) ?? EMPTY_COMPOSER_HISTORY_STATE;
  }

  private shouldHandleHistoryNavigation(direction: "older" | "newer"): boolean {
    const tabId = this.context?.activeTab?.id ?? this.context?.service.getActiveTab()?.id ?? null;
    if (!tabId || this.state.composerSuggestions.length > 0) {
      return false;
    }
    const selectionStart = this.elements.inputEl.selectionStart;
    const selectionEnd = this.elements.inputEl.selectionEnd;
    if (selectionStart === null || selectionEnd === null || selectionStart !== selectionEnd) {
      return false;
    }
    if (direction === "older") {
      if (this.getHistoryState(tabId).entries.length === 0) {
        return false;
      }
      return !this.elements.inputEl.value.slice(0, selectionStart).includes("\n");
    }
    return this.getHistoryState(tabId).index !== null && !this.elements.inputEl.value.slice(selectionStart).includes("\n");
  }

  private navigateComposerHistory(direction: "older" | "newer"): void {
    const tabId = this.context?.activeTab?.id ?? this.context?.service.getActiveTab()?.id ?? null;
    if (!tabId) {
      return;
    }
    const { nextState, nextDraft } = stepComposerHistory(this.getHistoryState(tabId), this.elements.inputEl.value, direction);
    if (nextDraft === null) {
      return;
    }
    this.state.historyByTab.set(tabId, nextState);
    this.context?.service.setTabComposerHistory(tabId, nextState);
    this.state.lastAppliedDraftByTab.set(tabId, nextDraft);
    this.state.isApplyingHistoryDraft = true;
    this.elements.inputEl.value = nextDraft;
    this.context?.service.setDraft(tabId, nextDraft);
    this.syncInputHeight();
    const cursor = nextDraft.length;
    this.elements.inputEl.setSelectionRange(cursor, cursor);
    this.state.isApplyingHistoryDraft = false;
    this.renderComposerSuggestions();
  }

  private renderComposerSuggestions(): void {
    const context = this.context;
    if (!context) {
      return;
    }
    if (this.isBusy()) {
      this.clearComposerSuggestions();
      return;
    }
    const cursor = this.elements.inputEl.selectionStart ?? this.elements.inputEl.value.length;
    const mentionSuggestions: ComposerSuggestion[] = context.service.getMentionCandidates().map((entry) => ({
      kind: "mention",
      token: entry.token,
      label: entry.label,
      description: entry.description,
    }));
    const suggestions = matchComposerSuggestions(
      this.elements.inputEl.value,
      cursor,
      context.service.getSlashCommandCatalog(),
      context.service.getInstalledSkills(),
      mentionSuggestions,
    );
    this.state.composerSuggestions = suggestions;
    if (suggestions.length === 0) {
      this.clearComposerSuggestions();
      return;
    }
    if (this.state.composerSelectedIndex >= suggestions.length) {
      this.state.composerSelectedIndex = 0;
    }

    this.elements.slashMenuEl.empty();
    this.elements.slashMenuEl.classList.add("is-visible");
    this.elements.root.classList.add("has-slash-menu");
    let selectedItemEl: HTMLDivElement | null = null;
    for (const [index, suggestion] of suggestions.entries()) {
      const itemEl = this.elements.slashMenuEl.createDiv({
        cls: `obsidian-codex__slash-item${index === this.state.composerSelectedIndex ? " is-selected" : ""}`,
      });
      if (index === this.state.composerSelectedIndex) {
        selectedItemEl = itemEl;
      }
      itemEl.addEventListener("mousedown", (event) => {
        event.preventDefault();
        this.applyComposerMenuSuggestion(suggestion);
      });

      const headEl = itemEl.createDiv({ cls: "obsidian-codex__slash-item-head" });
      headEl.createSpan({ cls: "obsidian-codex__slash-command", text: suggestion.token });
      headEl.createSpan({ cls: "obsidian-codex__slash-label", text: suggestion.label });
      itemEl.createDiv({ cls: "obsidian-codex__slash-desc", text: suggestion.description });
    }
    selectedItemEl?.scrollIntoView({ block: "nearest" });
  }

  private clearComposerSuggestions(): void {
    this.state.composerSuggestions = [];
    this.state.composerSelectedIndex = 0;
    this.elements.slashMenuEl.empty();
    this.elements.slashMenuEl.classList.remove("is-visible");
    this.elements.root.classList.remove("has-slash-menu");
  }

  private moveComposerSelection(delta: number): void {
    if (this.state.composerSuggestions.length === 0) {
      return;
    }
    this.state.composerSelectedIndex =
      (this.state.composerSelectedIndex + delta + this.state.composerSuggestions.length) % this.state.composerSuggestions.length;
    this.renderComposerSuggestions();
  }

  private applyComposerMenuSuggestion(suggestion: ComposerSuggestion | null): void {
    const context = this.context;
    if (!context || !suggestion) {
      return;
    }
    const cursor = this.elements.inputEl.selectionStart ?? this.elements.inputEl.value.length;
    const applied = applyComposerSuggestion(this.elements.inputEl.value, cursor, suggestion);
    this.elements.inputEl.value = applied.value;
    const tabId = context.activeTab?.id ?? context.service.getActiveTab()?.id ?? null;
    if (tabId) {
      this.state.lastAppliedDraftByTab.set(tabId, applied.value);
      context.service.setDraft(tabId, this.elements.inputEl.value);
    }
    this.state.composerSuggestions = [];
    this.state.composerSelectedIndex = 0;
    this.renderComposerSuggestions();
    this.syncInputHeight();
    this.elements.inputEl.focus();
    this.elements.inputEl.setSelectionRange(applied.cursor, applied.cursor);
  }

  private togglePlanMode(): void {
    const context = this.context;
    const tabId = context?.activeTab?.id ?? context?.service.getActiveTab()?.id ?? null;
    if (tabId) {
      context?.service.toggleTabComposeMode(tabId);
    }
  }

  private async handleFileInputChange(): Promise<void> {
    const files = this.elements.fileInputEl.files ? Array.from(this.elements.fileInputEl.files) : [];
    this.elements.fileInputEl.value = "";
    await this.callbacks.attachBrowserFiles(files, "picker");
  }

  private async handleInputPaste(event: ClipboardEvent): Promise<void> {
    const clipboardFiles = Array.from(event.clipboardData?.items ?? [])
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (clipboardFiles.length === 0) {
      return;
    }
    event.preventDefault();
    await this.callbacks.attachBrowserFiles(clipboardFiles, "clipboard");
  }

  private syncInputValueFromContext(tabId: string | null, draft: string): void {
    const isFocused = document.activeElement === this.elements.inputEl;
    const tabChanged = this.state.lastRenderedTabId !== tabId;
    if (!tabId) {
      if ((tabChanged || !isFocused) && this.elements.inputEl.value !== draft) {
        this.elements.inputEl.value = draft;
      }
      this.state.lastRenderedTabId = tabId;
      return;
    }

    const currentValue = this.elements.inputEl.value;
    const lastObservedDraft = this.state.lastAppliedDraftByTab.get(tabId) ?? null;
    const lastTypedValue = this.lastTypedValueByTab.get(tabId) ?? null;
    const preserveFocusedInput =
      isFocused &&
      !tabChanged &&
      currentValue !== draft &&
      lastObservedDraft === draft &&
      lastTypedValue === currentValue;

    if (!preserveFocusedInput && currentValue !== draft) {
      this.elements.inputEl.value = draft;
    }
    this.state.lastAppliedDraftByTab.set(tabId, draft);
    this.state.lastRenderedTabId = tabId;
  }

  private shouldFocusTextareaFromInputRow(event: MouseEvent): boolean {
    if (event.button !== 0) {
      return false;
    }
    const target = event.target as Element | null;
    if (!target || typeof target.closest !== "function") {
      return false;
    }
    if (target === this.elements.inputEl || this.elements.inputEl.contains(target)) {
      return false;
    }
    if (target.closest("button, input, textarea, select, a, [role='button']")) {
      return false;
    }
    return target === this.elements.inputRowEl || this.elements.inputRowEl.contains(target);
  }
}
