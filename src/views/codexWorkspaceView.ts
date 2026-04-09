import { ItemView, MarkdownRenderer, MarkdownView, Notice, TFile, setIcon, type WorkspaceLeaf } from "obsidian";
import { basename } from "node:path";
import type { CodexService } from "../app/codexService";
import { applyComposerSuggestion, matchComposerSuggestions, type ComposerSuggestion } from "../util/composerSuggestions";
import {
  DEFAULT_PRIMARY_MODEL,
  type AccountUsageSummary,
  type RefactorCampaign,
  type RefactorRecipe,
  type ChatMessage,
  type ComposerAttachmentInput,
  type ModelCatalogEntry,
  type PendingApproval,
  type SmartSet,
  type ToolCallRecord,
  type WorkspaceState,
} from "../model/types";
import { formatReasoningEffortLabel, sortReasoningEffortsDescending } from "../util/reasoning";
import { canCloseTab, shouldShowTabBadges } from "../util/tabBadges";
import { buildTranscriptEntries } from "../util/transcriptEntries";
import {
  getStudyWorkflowCatalog,
  getStudyWorkflowComposerPlaceholder,
  getStudyWorkflowDefinition,
  getStudyWorkflowMissingContextHint,
  getStudyWorkflowQuickAction,
} from "../util/studyWorkflows";
import { VAULT_SURGEON_ENABLED } from "../util/featureFlags";
import { getLocaleDateTag, type LocalizedCopy, type SupportedLocale } from "../util/i18n";
import { getVisibleUsageMeters } from "../util/usageDisplay";
import { stripAssistantProposalBlocks } from "../util/assistantProposals";
import { PromptModal } from "./promptModal";

export const CODEX_VIEW_TYPE = "obsidian-codex-study-workspace";
export const LEGACY_CODEX_VIEW_TYPE = "obsidian-openai-agent-study-workspace";

interface StatusMenuOption {
  label: string;
  selected: boolean;
  iconText?: string;
  onSelect: () => void;
}

function displayEffortLabel(value: string, locale: SupportedLocale): string {
  return formatReasoningEffortLabel(value as "low" | "medium" | "high" | "xhigh", locale);
}

function compactModelLabel(slug: string, fallback: string): string {
  if (/^gpt-5\.4$/i.test(slug)) {
    return "GPT-5.4";
  }
  if (/^gpt-5\.3-codex$/i.test(slug)) {
    return "GPT-5.3";
  }
  if (/^gpt-5\.2$/i.test(slug)) {
    return "GPT-5.2";
  }
  return fallback
    .replace(/^gpt-/i, "GPT-")
    .replace(/-mini$/i, "-Mini")
    .replace(/-codex$/i, "-Codex");
}

function isTabStreaming(status: WorkspaceState["tabs"][number]["status"] | undefined): boolean {
  return status === "busy" || status === "waiting_approval";
}

function formatUsageSourceLabel(
  source: AccountUsageSummary["source"],
  copy: LocalizedCopy["workspace"],
): string | null {
  if (source === "live") {
    return copy.usageSource.live;
  }
  if (source === "session_backfill") {
    return copy.usageSource.recovered;
  }
  if (source === "restored") {
    return copy.usageSource.restored;
  }
  return null;
}

function formatActivityStatusLabel(status: ToolCallRecord["status"], copy: LocalizedCopy["workspace"]): string {
  if (status === "running") {
    return copy.activityStatus.running;
  }
  if (status === "failed") {
    return copy.activityStatus.failed;
  }
  return copy.activityStatus.done;
}

function getActivityIcon(kind: ToolCallRecord["kind"]): string {
  if (kind === "shell") {
    return "terminal";
  }
  if (kind === "mcp") {
    return "blocks";
  }
  if (kind === "web") {
    return "globe";
  }
  if (kind === "file") {
    return "file-text";
  }
  if (kind === "todo") {
    return "list-todo";
  }
  return "wrench";
}

function summarizePreviewText(text: string, maxLines = 4, maxChars = 280): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines);
  const joined = lines.join("\n");
  if (joined.length <= maxChars) {
    return joined;
  }
  return `${joined.slice(0, maxChars).trimEnd()}...`;
}

function formatCompactTimestamp(value: number | null, locale: SupportedLocale, copy: LocalizedCopy["workspace"]): string {
  if (!value) {
    return copy.never;
  }
  return new Date(value).toLocaleString(getLocaleDateTag(locale), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function bindKeyboardActivation(element: HTMLElement, action: () => void): void {
  element.tabIndex = 0;
  element.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      action();
    }
  });
}

export class CodexWorkspaceView extends ItemView {
  private unsubscribe: (() => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private state: WorkspaceState | null = null;
  private activeTabId: string | null = null;
  private shellEl!: HTMLDivElement;
  private headerEl!: HTMLDivElement;
  private ingestHubPanelEl!: HTMLDivElement;
  private vaultSurgeonPanelEl!: HTMLDivElement;
  private smartSetPanelEl!: HTMLDivElement;
  private tabBarEl!: HTMLDivElement;
  private newTabButton!: HTMLButtonElement;
  private newSessionButton!: HTMLButtonElement;
  private forkButton!: HTMLButtonElement;
  private resumeButton!: HTMLButtonElement;
  private compactButton!: HTMLButtonElement;
  private settingsButton!: HTMLButtonElement;
  private messagesEl!: HTMLDivElement;
  private inputAreaEl!: HTMLDivElement;
  private slashMenuEl!: HTMLDivElement;
  private contextRowEl!: HTMLDivElement;
  private referenceDocEl!: HTMLDivElement;
  private instructionRowEl!: HTMLDivElement;
  private selectionPreviewEl!: HTMLDivElement;
  private attachmentsRowEl!: HTMLDivElement;
  private campaignPanelEl!: HTMLDivElement;
  private changesTrayEl!: HTMLDivElement;
  private planModeTextEl!: HTMLDivElement;
  private workflowBriefEl!: HTMLDivElement;
  private inputRowEl!: HTMLDivElement;
  private attachButtonEl!: HTMLButtonElement;
  private inputEl!: HTMLTextAreaElement;
  private sendButton!: HTMLButtonElement;
  private fileInputEl!: HTMLInputElement;
  private statusBarEl!: HTMLDivElement;
  private statusPrimaryEl!: HTMLDivElement;
  private statusControlsEl!: HTMLDivElement;
  private modelGroupEl!: HTMLDivElement;
  private modelButtonEl!: HTMLButtonElement;
  private modelValueEl!: HTMLSpanElement;
  private usageMetersEl!: HTMLDivElement;
  private thinkingButtonEl!: HTMLButtonElement;
  private thinkingValueEl!: HTMLSpanElement;
  private yoloControlEl!: HTMLButtonElement;
  private restoreStarted = false;
  private composerSuggestions: ComposerSuggestion[] = [];
  private composerSelectedIndex = 0;
  private statusMenuEl: HTMLDivElement | null = null;
  private statusMenuAnchorEl: HTMLElement | null = null;
  private statusMenuCloseHandler: ((event: MouseEvent) => void) | null = null;
  private readonly viewType: string;

  constructor(leaf: WorkspaceLeaf, private readonly service: CodexService, viewType = CODEX_VIEW_TYPE) {
    super(leaf);
    this.viewType = viewType;
  }

  override getViewType(): string {
    return this.viewType;
  }

  override getDisplayText(): string {
    return this.getCopy().workspace.title;
  }

  override getIcon(): string {
    return "sparkles";
  }

  refreshLocalization(): void {
    if (!this.shellEl) {
      return;
    }
    this.closeStatusMenu();
    this.shellEl.empty();
    this.buildLayout();
    this.render();
  }

  private getLocale(): SupportedLocale {
    return this.service.getLocale();
  }

  private getCopy() {
    return this.service.getLocalizedCopy();
  }

  override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("obsidian-codex");
    this.contentEl.toggleClass("obsidian-codex--vault-surgeon-disabled", !VAULT_SURGEON_ENABLED);

    this.shellEl = this.contentEl.createDiv({ cls: "obsidian-codex__container" });
    this.buildLayout();

    this.resizeObserver = new ResizeObserver(() => {
      this.syncInputHeight();
    });
    this.resizeObserver.observe(this.contentEl);

    this.unsubscribe = this.service.store.subscribe((state) => {
      this.state = state;
      this.render();
    });

    if (!this.restoreStarted) {
      this.restoreStarted = true;
      await this.service.ensureStarted();
      if (this.service.shouldAutoRestoreTabs()) {
        await this.service.restoreTabs();
      }
    }
  }

  override async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.closeStatusMenu();
  }

  private buildLayout(): void {
    const copy = this.getCopy();
    this.headerEl = this.shellEl.createDiv({ cls: "obsidian-codex__header" });
    const titleSlotEl = this.headerEl.createDiv({ cls: "obsidian-codex__title-slot" });
    titleSlotEl.createEl("h4", { cls: "obsidian-codex__title-text", text: copy.workspace.title });
    this.tabBarEl = titleSlotEl.createDiv({ cls: "obsidian-codex__tab-bar" });

    const headerActionsEl = this.headerEl.createDiv({ cls: "obsidian-codex__header-actions" });

    this.newTabButton = headerActionsEl.createEl("button", { cls: "obsidian-codex__header-btn obsidian-codex__new-tab-btn" });
    this.newTabButton.type = "button";
    this.newTabButton.ariaLabel = copy.workspace.header.newTab;
    this.newTabButton.title = copy.workspace.header.newTab;
    setIcon(this.newTabButton, "plus");
    this.newTabButton.addEventListener("click", () => {
      if (!this.service.createTab()) {
        new Notice(copy.notices.openChatsLimited(this.service.getMaxOpenTabs()));
      }
    });

    this.newSessionButton = headerActionsEl.createEl("button", { cls: "obsidian-codex__header-btn" });
    this.newSessionButton.type = "button";
    this.newSessionButton.ariaLabel = copy.workspace.header.newSession;
    this.newSessionButton.title = copy.workspace.header.newSession;
    setIcon(this.newSessionButton, "rotate-ccw");
    this.newSessionButton.addEventListener("click", () => {
      const tab = this.service.getActiveTab();
      if (!tab) {
        return;
      }
      if (!this.service.startNewSession(tab.id)) {
        new Notice(copy.notices.cannotStartNewSession);
      }
    });

    this.forkButton = headerActionsEl.createEl("button", { cls: "obsidian-codex__header-btn" });
    this.forkButton.type = "button";
    this.forkButton.ariaLabel = copy.workspace.header.forkConversation;
    this.forkButton.title = copy.workspace.header.forkConversation;
    setIcon(this.forkButton, "git-fork");
    this.forkButton.addEventListener("click", () => {
      const activeTabId = this.activeTabId ?? this.service.getActiveTab()?.id;
      if (!activeTabId) {
        return;
      }
      if (!this.service.forkTab(activeTabId)) {
        new Notice(copy.notices.cannotForkConversation);
      }
    });

    this.resumeButton = headerActionsEl.createEl("button", { cls: "obsidian-codex__header-btn" });
    this.resumeButton.type = "button";
    this.resumeButton.ariaLabel = copy.workspace.header.resumeThread;
    this.resumeButton.title = copy.workspace.header.resumeThread;
    setIcon(this.resumeButton, "history");
    this.resumeButton.addEventListener("click", () => {
      const activeTabId = this.activeTabId ?? this.service.getActiveTab()?.id;
      if (!activeTabId) {
        return;
      }
      if (!this.service.resumeTab(activeTabId)) {
        new Notice(copy.notices.noResumableThread);
      }
    });

    this.compactButton = headerActionsEl.createEl("button", { cls: "obsidian-codex__header-btn" });
    this.compactButton.type = "button";
    this.compactButton.ariaLabel = copy.workspace.header.compactConversation;
    this.compactButton.title = copy.workspace.header.compactConversation;
    setIcon(this.compactButton, "minimize-2");
    this.compactButton.addEventListener("click", () => {
      const activeTabId = this.activeTabId ?? this.service.getActiveTab()?.id;
      if (!activeTabId) {
        return;
      }
      this.service.compactTab(activeTabId);
    });

    this.settingsButton = headerActionsEl.createEl("button", { cls: "obsidian-codex__header-btn" });
    this.settingsButton.type = "button";
    this.settingsButton.ariaLabel = copy.workspace.header.settings;
    this.settingsButton.title = copy.workspace.header.settings;
    setIcon(this.settingsButton, "settings");
    this.settingsButton.addEventListener("click", () => {
      const settingsApp = this.app as typeof this.app & {
        setting?: {
          open: () => void;
          openTabById: (id: string) => void;
        };
      };
      settingsApp.setting?.open();
      settingsApp.setting?.openTabById("obsidian-codex-study");
    });

    this.ingestHubPanelEl = this.shellEl.createDiv({ cls: "obsidian-codex__ingest-hub-panel" });
    this.vaultSurgeonPanelEl = VAULT_SURGEON_ENABLED
      ? this.shellEl.createDiv({ cls: "obsidian-codex__vault-surgeon-panel" })
      : document.createElement("div");
    this.smartSetPanelEl = this.shellEl.createDiv({ cls: "obsidian-codex__smart-set-panel" });
    this.messagesEl = this.shellEl.createDiv({ cls: "obsidian-codex__messages" });

    this.inputAreaEl = this.shellEl.createDiv({ cls: "obsidian-codex__input-area" });
    this.planModeTextEl = this.inputAreaEl.createDiv({
      cls: "obsidian-codex__plan-mode-text",
      text: copy.workspace.planMode,
    });
    this.workflowBriefEl = this.inputAreaEl.createDiv({ cls: "obsidian-codex__workflow-brief" });
    this.slashMenuEl = this.inputAreaEl.createDiv({ cls: "obsidian-codex__slash-menu" });
    this.contextRowEl = this.inputAreaEl.createDiv({ cls: "obsidian-codex__context-row" });
    this.referenceDocEl = this.contextRowEl.createDiv({ cls: "obsidian-codex__reference-doc" });
    this.instructionRowEl = this.inputAreaEl.createDiv({ cls: "obsidian-codex__instruction-row" });
    this.selectionPreviewEl = this.inputAreaEl.createDiv({ cls: "obsidian-codex__selection-preview" });
    this.attachmentsRowEl = this.inputAreaEl.createDiv({ cls: "obsidian-codex__attachments-row" });
    this.campaignPanelEl = VAULT_SURGEON_ENABLED
      ? this.inputAreaEl.createDiv({ cls: "obsidian-codex__campaign-panel" })
      : document.createElement("div");
    this.changesTrayEl = this.inputAreaEl.createDiv({ cls: "obsidian-codex__changes-tray" });

    this.inputRowEl = this.inputAreaEl.createDiv({ cls: "obsidian-codex__input-row" });
    this.inputEl = this.inputRowEl.createEl("textarea", {
      cls: "obsidian-codex__input",
      attr: {
        placeholder: copy.workspace.defaultComposerPlaceholder,
        rows: "1",
      },
    });
    this.inputEl.addEventListener("input", () => {
      this.syncInputHeight();
      const tabId = this.activeTabId ?? this.service.getActiveTab()?.id;
      if (tabId) {
        this.service.setDraft(tabId, this.inputEl.value);
      }
      this.renderComposerSuggestions();
    });
    this.inputEl.addEventListener("paste", (event) => {
      void this.handleInputPaste(event);
    });
    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Tab" && event.shiftKey) {
        event.preventDefault();
        this.togglePlanMode();
        return;
      }

      if (event.key.toLowerCase() === "c" && event.ctrlKey) {
        const tabId = this.activeTabId ?? this.service.getActiveTab()?.id;
        if (tabId) {
          void this.service.interruptActiveTurn(tabId);
        }
        return;
      }

      if (this.composerSuggestions.length > 0) {
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
          this.applyComposerMenuSuggestion(this.composerSuggestions[this.composerSelectedIndex] ?? null);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          this.composerSuggestions = [];
          this.composerSelectedIndex = 0;
          this.renderComposerSuggestions();
          return;
        }
      }

      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void this.sendCurrentPrompt();
      }
    });

    const inputActionsEl = this.inputRowEl.createDiv({ cls: "obsidian-codex__input-actions" });

    this.attachButtonEl = inputActionsEl.createEl("button", {
      cls: "obsidian-codex__attach-btn",
      attr: {
        type: "button",
        "aria-label": copy.workspace.attachLocalFiles,
        title: copy.workspace.attachLocalFiles,
      },
    });
    setIcon(this.attachButtonEl, "paperclip");
    this.attachButtonEl.addEventListener("click", () => {
      this.openAttachmentPicker();
    });

    this.sendButton = inputActionsEl.createEl("button", { cls: "obsidian-codex__send-btn" });
    this.sendButton.type = "button";
    this.sendButton.ariaLabel = copy.workspace.send;
    this.sendButton.title = copy.workspace.send;
    setIcon(this.sendButton, "send");
    this.sendButton.addEventListener("click", () => {
      void this.sendCurrentPrompt();
    });

    this.fileInputEl = this.inputAreaEl.createEl("input", {
      cls: "obsidian-codex__file-input",
      attr: {
        type: "file",
        multiple: "true",
      },
    });
    this.fileInputEl.addEventListener("change", () => {
      void this.handleFileInputChange();
    });

    this.statusBarEl = this.inputAreaEl.createDiv({ cls: "obsidian-codex__status-bar" });
    this.statusPrimaryEl = this.statusBarEl.createDiv({ cls: "obsidian-codex__status-primary" });
    this.statusControlsEl = this.statusPrimaryEl.createDiv({ cls: "obsidian-codex__status-controls" });

    this.modelGroupEl = this.statusControlsEl.createDiv({ cls: "obsidian-codex__status-stack obsidian-codex__status-stack-model" });

    this.modelButtonEl = this.modelGroupEl.createEl("button", {
      cls: "obsidian-codex__status-picker obsidian-codex__status-picker-model",
    });
    this.modelButtonEl.type = "button";
    this.modelButtonEl.ariaLabel = copy.workspace.selectModel;
    this.modelButtonEl.title = copy.workspace.selectModel;
    this.modelValueEl = this.modelButtonEl.createSpan({ cls: "obsidian-codex__status-picker-value" });
    const modelChevron = this.modelButtonEl.createSpan({ cls: "obsidian-codex__status-picker-chevron" });
    setIcon(modelChevron, "chevron-down");
    this.modelButtonEl.addEventListener("click", (event) => {
      event.stopPropagation();
      this.showModelPicker(this.modelButtonEl);
    });

    this.thinkingButtonEl = this.statusControlsEl.createEl("button", {
      cls: "obsidian-codex__status-picker obsidian-codex__status-picker-thinking",
    });
    this.thinkingButtonEl.type = "button";
    this.thinkingButtonEl.ariaLabel = copy.workspace.selectThinkingLevel;
    this.thinkingButtonEl.title = copy.workspace.selectThinkingLevel;
    this.thinkingValueEl = this.thinkingButtonEl.createSpan({ cls: "obsidian-codex__status-picker-value" });
    const thinkingChevron = this.thinkingButtonEl.createSpan({ cls: "obsidian-codex__status-picker-chevron" });
    setIcon(thinkingChevron, "chevron-down");
    this.thinkingButtonEl.addEventListener("click", (event) => {
      event.stopPropagation();
      this.showThinkingPicker(this.thinkingButtonEl);
    });
    this.usageMetersEl = this.statusPrimaryEl.createDiv({ cls: "obsidian-codex__usage-meters" });

    this.statusBarEl.createDiv({ cls: "obsidian-codex__status-spacer" });

    this.yoloControlEl = this.statusBarEl.createEl("button", { cls: "obsidian-codex__yolo-control" });
    this.yoloControlEl.type = "button";
    this.yoloControlEl.ariaLabel = copy.workspace.toggleYolo;
    this.yoloControlEl.title = copy.workspace.toggleYolo;
    const yoloLabel = this.yoloControlEl.createDiv({ cls: "obsidian-codex__yolo-label" });
    yoloLabel.createSpan({ cls: "obsidian-codex__yolo-text", text: copy.workspace.yolo });
    const yoloToggle = this.yoloControlEl.createDiv({ cls: "obsidian-codex__toggle-switch" });
    yoloToggle.createDiv({ cls: "obsidian-codex__toggle-knob" });
    this.yoloControlEl.addEventListener("click", (event) => {
      event.stopPropagation();
      const nextMode = this.service.getPermissionMode() === "full-auto" ? "auto-edit" : "full-auto";
      void this.service.setPermissionMode(nextMode);
    });

    this.syncInputHeight(true);
  }

  private render(): void {
    const state = this.state;
    if (!state) {
      return;
    }
    const locale = this.getLocale();
    this.contentEl.toggleClass("obsidian-codex--vault-surgeon-disabled", !VAULT_SURGEON_ENABLED);

    const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0] ?? null;
    this.activeTabId = activeTab?.id ?? null;
    if (activeTab?.studyWorkflow) {
      this.inputAreaEl.dataset.workflow = activeTab.studyWorkflow;
    } else {
      delete this.inputAreaEl.dataset.workflow;
    }

    this.renderTabs(state);
    this.renderIngestHubPanel(activeTab);
    if (VAULT_SURGEON_ENABLED) {
      this.renderVaultSurgeonPanel(activeTab);
    } else {
      this.vaultSurgeonPanelEl.empty();
      this.vaultSurgeonPanelEl.classList.remove("is-visible");
    }
    this.renderSmartSetPanel();
    this.renderReferenceDoc(activeTab?.id ?? null);
    this.renderInstructionChips(activeTab?.id ?? null);
    this.renderSelectionPreview(activeTab?.id ?? null);
    this.renderAttachments(activeTab?.id ?? null);
    this.renderCampaignPanel(activeTab?.id ?? null);
    this.renderPatchBasket(activeTab?.id ?? null);
    this.renderPlanMode(activeTab?.composeMode ?? "chat");
    this.renderWorkflowBrief(activeTab);
    this.renderMessages(activeTab);
    this.renderStatusBar(activeTab, state.availableModels);

    const draft = activeTab?.draft ?? "";
    if (document.activeElement !== this.inputEl || this.inputEl.value !== draft) {
      this.inputEl.value = draft;
    }
    this.inputEl.placeholder = getStudyWorkflowComposerPlaceholder(activeTab?.studyWorkflow ?? null, locale);
    this.renderComposerSuggestions();
    this.syncInputHeight();

    const busy = isTabStreaming(activeTab?.status);
    this.sendButton.disabled = busy;
    this.newTabButton.disabled = state.tabs.length >= this.service.getMaxOpenTabs();
    this.newSessionButton.disabled = busy;
    this.forkButton.disabled = !activeTab || busy;
    this.resumeButton.disabled = !activeTab?.codexThreadId || busy;
    this.compactButton.disabled = !activeTab || busy || activeTab.messages.length === 0;
    this.modelButtonEl.disabled = busy;
    this.thinkingButtonEl.disabled = busy;
    this.attachButtonEl.disabled = busy;
  }

  private renderTabs(state: WorkspaceState): void {
    this.tabBarEl.empty();
    if (!shouldShowTabBadges(state.tabs.length)) {
      return;
    }

    const copy = this.getCopy();
    const closable = canCloseTab(state.tabs.length);
    const badges = this.tabBarEl.createDiv({ cls: "obsidian-codex__tab-badges" });
    for (const [index, tab] of state.tabs.slice(0, this.service.getMaxOpenTabs()).entries()) {
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
        this.closeStatusMenu();
        this.service.activateTab(tab.id);
      });
      badge.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        if (closable) {
          this.service.closeTab(tab.id);
        }
      });
      badge.addEventListener("auxclick", (event) => {
        if (event.button === 1 && closable) {
          this.service.closeTab(tab.id);
        }
      });
    }
  }

  private renderReferenceDoc(tabId: string | null): void {
    this.referenceDocEl.empty();
    const copy = this.getCopy();
    if (!tabId) {
      this.contextRowEl.classList.remove("has-content");
      return;
    }

    const targetPath = this.service.getTabTargetNotePath(tabId);
    if (!targetPath) {
      this.contextRowEl.classList.remove("has-content");
      this.referenceDocEl.onclick = null;
      this.referenceDocEl.onkeydown = null;
      this.referenceDocEl.tabIndex = -1;
      return;
    }

    this.contextRowEl.classList.add("has-content");
    this.referenceDocEl.classList.remove("is-empty");
    this.referenceDocEl.title = targetPath;
    this.referenceDocEl.onclick = () => {
      void this.openTargetNote();
    };
    this.referenceDocEl.tabIndex = 0;
    this.referenceDocEl.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void this.openTargetNote();
      }
    };

    const iconEl = this.referenceDocEl.createDiv({ cls: "obsidian-codex__reference-doc-icon" });
    setIcon(iconEl, "file-text");
    const bodyEl = this.referenceDocEl.createDiv({ cls: "obsidian-codex__reference-doc-body" });
    bodyEl.createSpan({ cls: "obsidian-codex__reference-doc-label", text: copy.workspace.referenceNote });
    bodyEl.createSpan({ cls: "obsidian-codex__reference-doc-value", text: basename(targetPath) });

    const removeButton = this.referenceDocEl.createEl("button", {
      cls: "obsidian-codex__reference-doc-remove",
      attr: {
        type: "button",
        "aria-label": copy.workspace.removeReferenceNote,
      },
    });
    setIcon(removeButton, "x");
    removeButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const activeId = this.activeTabId ?? this.service.getActiveTab()?.id;
      if (activeId) {
        this.service.setTabTargetNote(activeId, null);
      }
    });
  }

  showSmartSetPanel(): void {
    this.smartSetPanelEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  showIngestHubPanel(): void {
    this.service.openStudyHub();
    this.ingestHubPanelEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  showVaultSurgeonPanel(): void {
    if (!VAULT_SURGEON_ENABLED) {
      return;
    }
    this.vaultSurgeonPanelEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  private renderIngestHubPanel(activeTab: WorkspaceState["tabs"][number] | null): void {
    this.ingestHubPanelEl.empty();
    this.ingestHubPanelEl.classList.add("is-visible");

    const locale = this.getLocale();
    const copy = this.getCopy();
    const workflowCatalog = getStudyWorkflowCatalog(locale);
    const activeWorkflow = this.service.getActiveStudyWorkflow();
    const studyHubState = this.service.getStudyHubState();
    const isCollapsed = studyHubState.isCollapsed;
    this.ingestHubPanelEl.dataset.workflow = activeWorkflow ?? "";
    this.ingestHubPanelEl.classList.toggle("is-collapsed", isCollapsed);

    const headerEl = this.ingestHubPanelEl.createDiv({ cls: "obsidian-codex__ingest-hub-header" });
    const headingEl = headerEl.createDiv({ cls: "obsidian-codex__ingest-hub-heading" });
    const titleWrapEl = headingEl.createDiv({ cls: "obsidian-codex__ingest-hub-title-wrap" });
    titleWrapEl.createSpan({ cls: "obsidian-codex__ingest-hub-title", text: copy.workspace.ingestHubTitle });
    if (!isCollapsed) {
      titleWrapEl.createSpan({
        cls: "obsidian-codex__ingest-hub-subtitle",
        text: copy.workspace.ingestHubSubtitle,
      });
    }

    const toggleButton = headerEl.createEl("button", {
      cls: "obsidian-codex__ingest-hub-toggle",
      attr: {
        type: "button",
        "aria-label": isCollapsed ? copy.workspace.expandIngestHub : copy.workspace.collapseIngestHub,
        "aria-expanded": String(!isCollapsed),
      },
    });
    setIcon(toggleButton, isCollapsed ? "chevron-right" : "chevron-down");
    toggleButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.service.toggleStudyHubCollapsed();
    });

    if (isCollapsed) {
      return;
    }

    const metaEl = this.ingestHubPanelEl.createDiv({ cls: "obsidian-codex__ingest-hub-meta" });
    metaEl.createSpan({
      cls: "obsidian-codex__vault-surgeon-pill",
      text: copy.workspace.activeWorkflow(
        activeWorkflow ? getStudyWorkflowDefinition(activeWorkflow, locale).label : copy.workspace.none,
      ),
    });
    metaEl.createSpan({
      cls: "obsidian-codex__vault-surgeon-pill",
      text: copy.workspace.openedAt(formatCompactTimestamp(studyHubState.lastOpenedAt, locale, copy.workspace)),
    });
    if (activeTab?.targetNotePath) {
      metaEl.createSpan({
        cls: "obsidian-codex__vault-surgeon-pill",
        text: copy.workspace.note(basename(activeTab.targetNotePath)),
      });
    }

    const cardsEl = this.ingestHubPanelEl.createDiv({ cls: "obsidian-codex__ingest-hub-cards" });
    for (const workflow of workflowCatalog) {
      const cardEl = cardsEl.createDiv({
        cls: `obsidian-codex__ingest-hub-card${workflow.kind === activeWorkflow ? " is-active" : ""}`,
      });
      cardEl.dataset.workflow = workflow.kind;
      const cardHeadEl = cardEl.createDiv({ cls: "obsidian-codex__ingest-hub-card-head" });
      cardHeadEl.createSpan({ cls: "obsidian-codex__ingest-hub-card-title", text: workflow.label });
      if (workflow.attachRecommended) {
        cardHeadEl.createSpan({ cls: "obsidian-codex__ingest-hub-card-badge", text: copy.workspace.attachFriendly });
      }
      cardEl.createDiv({ cls: "obsidian-codex__ingest-hub-card-desc", text: workflow.description });
      cardEl.createDiv({ cls: "obsidian-codex__ingest-hub-card-note", text: workflow.helperText });
      cardEl.createDiv({ cls: "obsidian-codex__ingest-hub-card-note is-muted", text: workflow.missingContextHint });

      const actionsEl = cardEl.createDiv({ cls: "obsidian-codex__ingest-hub-card-actions" });
      this.createSmartSetActionButton(actionsEl, copy.workspace.seedPrompt, async () => {
        await this.startStudyWorkflowFromHub(workflow.kind, false);
      });
      if (workflow.attachRecommended) {
        this.createSmartSetActionButton(actionsEl, copy.workspace.attachFiles, async () => {
          await this.startStudyWorkflowFromHub(workflow.kind, true);
        }, true);
      }
    }
  }

  private renderVaultSurgeonPanel(activeTab: WorkspaceState["tabs"][number] | null): void {
    if (!VAULT_SURGEON_ENABLED) {
      this.vaultSurgeonPanelEl.empty();
      this.vaultSurgeonPanelEl.classList.remove("is-visible");
      return;
    }

    this.vaultSurgeonPanelEl.empty();
    const recipes = this.service.getRefactorRecipes();
    const activeSmartSetId = this.service.getActiveSmartSetId();
    const activeSmartSet = activeSmartSetId ? this.service.getSmartSets().find((entry) => entry.id === activeSmartSetId) ?? null : null;

    if (!activeTab && recipes.length === 0) {
      this.vaultSurgeonPanelEl.classList.remove("is-visible");
      return;
    }

    this.vaultSurgeonPanelEl.classList.add("is-visible");
    const headerEl = this.vaultSurgeonPanelEl.createDiv({ cls: "obsidian-codex__vault-surgeon-header" });
    headerEl.createSpan({ cls: "obsidian-codex__vault-surgeon-title", text: "Vault Surgeon" });
    if (activeTab) {
      const countsEl = headerEl.createDiv({ cls: "obsidian-codex__vault-surgeon-counts" });
      const vaultApprovals = activeTab.pendingApprovals.filter((approval) => approval.toolName === "vault_op").length;
      const pendingPatches = activeTab.patchBasket.filter((proposal) => proposal.status === "pending" || proposal.status === "conflicted").length;
      const rollbackReady = activeTab.campaigns.filter((campaign) => campaign.snapshotCapsule).length;
      countsEl.createSpan({ cls: "obsidian-codex__vault-surgeon-pill", text: `${vaultApprovals} approvals` });
      countsEl.createSpan({ cls: "obsidian-codex__vault-surgeon-pill", text: `${pendingPatches} patches` });
      countsEl.createSpan({ cls: "obsidian-codex__vault-surgeon-pill", text: `${activeTab.campaigns.length} campaigns` });
      countsEl.createSpan({ cls: "obsidian-codex__vault-surgeon-pill", text: `${rollbackReady} rollback-ready` });
    }

    if (activeTab) {
      const scopeEl = this.vaultSurgeonPanelEl.createDiv({ cls: "obsidian-codex__vault-surgeon-scope" });
      scopeEl.createSpan({ cls: "obsidian-codex__vault-surgeon-section-label", text: "Scope" });
      this.createSmartSetActionButton(scopeEl, "Current note surgery", async () => {
        const { file, editor } = this.resolvePromptContext();
        await this.service.startCurrentNoteSurgery(activeTab.id, file, editor);
      });
      this.createSmartSetActionButton(scopeEl, "Search query", async () => {
        new PromptModal(
          this.app,
          "Launch Vault Surgery",
          "lecture notes ai",
          (value) => {
            const query = value.trim();
            if (!query) {
              new Notice("Provide a search query.");
              return;
            }
            const { file, editor } = this.resolvePromptContext();
            void this.service.startRefactorCampaign(activeTab.id, query, file, editor).catch((error: unknown) => {
              new Notice((error as Error).message);
            });
          },
          "Enter a search query for the notes to include in this surgery.",
        ).open();
      });
      if (activeSmartSet) {
        this.createSmartSetActionButton(scopeEl, "Active Smart Set", async () => {
          const { file, editor } = this.resolvePromptContext();
          await this.service.launchCampaignFromSmartSet(activeSmartSet.id, activeTab.id, file, editor);
        });
      }
    }

    if (activeTab?.campaigns.length) {
      const activeCampaignsEl = this.vaultSurgeonPanelEl.createDiv({ cls: "obsidian-codex__vault-surgeon-section" });
      activeCampaignsEl.createSpan({ cls: "obsidian-codex__vault-surgeon-section-label", text: "Active surgeries" });
      for (const campaign of activeTab.campaigns) {
        this.renderCampaignCard(activeCampaignsEl, activeTab.id, campaign, true);
      }
    }

    const recipesEl = this.vaultSurgeonPanelEl.createDiv({ cls: "obsidian-codex__vault-surgeon-section" });
    recipesEl.createSpan({ cls: "obsidian-codex__vault-surgeon-section-label", text: "Recipes" });
    if (recipes.length === 0) {
      recipesEl.createDiv({
        cls: "obsidian-codex__vault-surgeon-empty",
        text: "Save a successful surgery as a recipe to reuse it on other note sets.",
      });
    } else {
      const listEl = recipesEl.createDiv({ cls: "obsidian-codex__recipe-list" });
      const activeRecipeId = this.service.getActiveRefactorRecipeId();
      for (const recipe of recipes) {
        this.renderRecipeCard(listEl, recipe, recipe.id === activeRecipeId, activeTab?.id ?? null);
      }
    }
  }

  private renderSmartSetPanel(): void {
    this.smartSetPanelEl.empty();
    const smartSets = this.service.getSmartSets();
    if (smartSets.length === 0) {
      this.smartSetPanelEl.classList.remove("is-visible");
      return;
    }

    const activeSmartSetId = this.service.getActiveSmartSetId();
    const copy = this.getCopy();
    this.smartSetPanelEl.classList.add("is-visible");
    const headerEl = this.smartSetPanelEl.createDiv({ cls: "obsidian-codex__smart-set-header" });
    headerEl.createSpan({ cls: "obsidian-codex__smart-set-title", text: copy.workspace.smartSets });
    headerEl.createSpan({ cls: "obsidian-codex__smart-set-count", text: String(smartSets.length) });

    const listEl = this.smartSetPanelEl.createDiv({ cls: "obsidian-codex__smart-set-list" });
    for (const smartSet of smartSets) {
      this.renderSmartSetCard(listEl, smartSet, smartSet.id === activeSmartSetId);
    }
  }

  private renderSmartSetCard(parent: HTMLElement, smartSet: SmartSet, isActive: boolean): void {
    const locale = this.getLocale();
    const copy = this.getCopy();
    const cardEl = parent.createDiv({
      cls: `obsidian-codex__smart-set-card${isActive ? " is-active" : ""}`,
    });
    cardEl.addEventListener("click", () => {
      this.service.activateSmartSet(smartSet.id);
    });
    bindKeyboardActivation(cardEl, () => {
      this.service.activateSmartSet(smartSet.id);
    });

    const headEl = cardEl.createDiv({ cls: "obsidian-codex__smart-set-card-head" });
    const titleWrapEl = headEl.createDiv({ cls: "obsidian-codex__smart-set-card-title-wrap" });
    titleWrapEl.createSpan({ cls: "obsidian-codex__smart-set-card-title", text: smartSet.title });
    titleWrapEl.createSpan({
      cls: "obsidian-codex__smart-set-card-query",
      text: smartSet.naturalQuery,
    });

    const metaEl = cardEl.createDiv({ cls: "obsidian-codex__smart-set-card-meta" });
    metaEl.createSpan({ text: copy.workspace.notesCount(smartSet.liveResult?.count ?? 0) });
    metaEl.createSpan({ text: copy.workspace.runAt(formatCompactTimestamp(smartSet.lastRunAt, locale, copy.workspace)) });
    metaEl.createSpan({
      text: smartSet.lastSnapshot
        ? copy.workspace.snapshotAt(formatCompactTimestamp(smartSet.lastSnapshot.createdAt, locale, copy.workspace))
        : copy.workspace.noSnapshot,
    });

    if (smartSet.lastDrift) {
      const driftEl = cardEl.createDiv({ cls: "obsidian-codex__smart-set-card-drift" });
      driftEl.createSpan({ text: `+${smartSet.lastDrift.added.length}` });
      driftEl.createSpan({ text: `-${smartSet.lastDrift.removed.length}` });
      driftEl.createSpan({ text: `Δ${smartSet.lastDrift.changed.length}` });
    }

    const actionsEl = cardEl.createDiv({ cls: "obsidian-codex__smart-set-card-actions" });
    this.createSmartSetActionButton(actionsEl, copy.workspace.run, async () => {
      await this.service.runSmartSet(smartSet.id);
    });
    this.createSmartSetActionButton(actionsEl, copy.workspace.viewDrift, async () => {
      await this.service.computeSmartSetDrift(smartSet.id);
    });
    if (VAULT_SURGEON_ENABLED) {
      this.createSmartSetActionButton(actionsEl, "Launch campaign", async () => {
        const { file, editor } = this.resolvePromptContext();
        const tab = this.service.getActiveTab() ?? this.service.createTab();
        if (!tab) {
          return;
        }
        await this.service.launchCampaignFromSmartSet(smartSet.id, tab.id, file, editor);
      });
    }

    if (smartSet.savedNotePath) {
      this.createSmartSetActionButton(
        actionsEl,
        copy.workspace.openNote,
        async () => {
          await this.service.openSmartSetNote(smartSet.id);
        },
        true,
      );
    }
  }

  private async startStudyWorkflowFromHub(kind: "lecture" | "review" | "paper" | "homework", openPicker: boolean): Promise<void> {
    const tab = this.service.getActiveTab() ?? this.service.createTab();
    if (!tab) {
      return;
    }

    this.service.startStudyWorkflow(tab.id, kind, this.app.workspace.getActiveFile());
    if (openPicker) {
      this.openAttachmentPicker();
      return;
    }
    this.focusComposer();
  }

  private createSmartSetActionButton(
    parent: HTMLElement,
    label: string,
    action: () => Promise<void>,
    muted = false,
  ): void {
    const button = parent.createEl("button", {
      cls: `obsidian-codex__change-card-btn${muted ? " is-muted" : ""}`,
      text: label,
    });
    button.type = "button";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void action().catch((error: unknown) => {
        new Notice((error as Error).message);
      });
    });
  }

  private renderMessages(activeTab: WorkspaceState["tabs"][number] | null): void {
    this.messagesEl.empty();
    const transcript = activeTab
      ? buildTranscriptEntries(
          activeTab.messages,
          this.service.getShowReasoning(),
          activeTab.toolLog,
          activeTab.pendingApprovals,
          activeTab.waitingState,
          activeTab.status,
        )
      : [];
    const hasConversationContext =
      Boolean(activeTab?.summary) ||
      Boolean(activeTab?.lineage.forkedFromThreadId) ||
      Boolean(activeTab?.lineage.resumedFromThreadId) ||
      Boolean(activeTab?.lineage.compactedAt);

    if (!transcript.length && activeTab?.status !== "busy" && !hasConversationContext) {
      this.renderWelcome(activeTab);
      return;
    }

    if (activeTab && hasConversationContext) {
      this.renderConversationSummary(activeTab, transcript.length);
    }

    if (activeTab && activeTab.pendingApprovals.filter((approval) => approval.toolName === "vault_op").length > 1) {
      this.renderApprovalBatchBar(activeTab.id);
    }

    const visibleTranscript =
      activeTab?.summary && transcript.length > 10 ? transcript.slice(-10) : transcript;

    for (const entry of visibleTranscript) {
      if (entry.type === "message") {
        this.renderTranscriptMessage(entry.message);
        continue;
      }
      if (entry.type === "activity") {
        this.renderActivityEntry(entry.activity);
        continue;
      }
      if (entry.type === "approval") {
        this.renderApprovalEntry(entry.approval);
        continue;
      }
      this.renderWaitingEntry(entry.waitingState);
    }

    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private renderConversationSummary(activeTab: WorkspaceState["tabs"][number], transcriptLength: number): void {
    const locale = this.getLocale();
    const copy = this.getCopy();
    const cardEl = this.messagesEl.createDiv({ cls: "obsidian-codex__conversation-summary" });
    const metaEl = cardEl.createDiv({ cls: "obsidian-codex__conversation-summary-meta" });
    metaEl.createSpan({ cls: "obsidian-codex__conversation-summary-title", text: copy.workspace.conversationContext });
    if (activeTab.lineage.forkedFromThreadId) {
      metaEl.createSpan({ cls: "obsidian-codex__conversation-summary-chip", text: copy.workspace.forked });
    }
    if (activeTab.lineage.resumedFromThreadId) {
      metaEl.createSpan({ cls: "obsidian-codex__conversation-summary-chip", text: copy.workspace.resumed });
    }
    if (activeTab.lineage.compactedAt) {
      metaEl.createSpan({
        cls: "obsidian-codex__conversation-summary-chip",
        text: copy.workspace.compactedAt(formatCompactTimestamp(activeTab.lineage.compactedAt, locale, copy.workspace)),
      });
    }
    if (activeTab.summary && transcriptLength > 10) {
      metaEl.createSpan({ cls: "obsidian-codex__conversation-summary-chip", text: copy.workspace.showingLastItems(10) });
    }

    if (activeTab.summary?.text.trim()) {
      cardEl.createDiv({
        cls: "obsidian-codex__conversation-summary-body",
        text: activeTab.summary.text,
      });
    }
  }

  private renderInstructionChips(tabId: string | null): void {
    this.instructionRowEl.empty();
    const copy = this.getCopy();
    if (!tabId) {
      this.instructionRowEl.classList.remove("is-visible");
      return;
    }

    const chips = this.service.getTabInstructionChips(tabId);
    if (chips.length === 0) {
      this.instructionRowEl.classList.remove("is-visible");
      return;
    }

    this.instructionRowEl.classList.add("is-visible");
    this.instructionRowEl.createSpan({
      cls: "obsidian-codex__instruction-row-label",
      text: copy.workspace.instructions,
    });

    for (const chip of chips) {
      const chipEl = this.instructionRowEl.createDiv({ cls: "obsidian-codex__instruction-chip" });
      chipEl.createSpan({ cls: "obsidian-codex__instruction-chip-text", text: `#${chip.label}` });
      const removeButton = chipEl.createEl("button", {
        cls: "obsidian-codex__instruction-chip-remove",
        attr: {
          type: "button",
          "aria-label": copy.workspace.removeInstruction(chip.label),
        },
      });
      setIcon(removeButton, "x");
      removeButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.service.removeInstructionChip(tabId, chip.id);
      });
    }
  }

  private renderApprovalBatchBar(tabId: string): void {
    const copy = this.getCopy();
    const wrapEl = this.messagesEl.createDiv({ cls: "obsidian-codex__approval-batch" });
    wrapEl.createSpan({ cls: "obsidian-codex__approval-batch-label", text: copy.workspace.pendingApprovals });
    const actionsEl = wrapEl.createDiv({ cls: "obsidian-codex__approval-batch-actions" });
    this.createApprovalBatchButton(actionsEl, tabId, copy.workspace.approveAll, "approve", false);
    this.createApprovalBatchButton(actionsEl, tabId, copy.workspace.thisSession, "approve_session", false);
    this.createApprovalBatchButton(actionsEl, tabId, copy.workspace.denyAll, "deny", true);
  }

  private renderTranscriptMessage(message: ChatMessage): void {
    const copy = this.getCopy();
    const isSelectionContext = message.meta?.selectionContext === true;
    const isAttachmentSummary = message.meta?.attachmentSummary === true;
    const msgEl = this.messagesEl.createDiv({
      cls: `obsidian-codex__message obsidian-codex__message-${message.kind}${isSelectionContext ? " obsidian-codex__message-selection" : ""}`,
    });

    if (message.kind !== "user" && message.kind !== "system") {
      const avatar = msgEl.createDiv({ cls: "obsidian-codex__avatar obsidian-codex__avatar-assistant" });
      setIcon(avatar, "sparkles");
    }

    const contentEl = msgEl.createDiv({
      cls:
        `obsidian-codex__message-content obsidian-codex__message-content--${message.kind}` +
        `${message.pending ? " is-pending" : ""}` +
        `${isSelectionContext ? " is-selection-context" : ""}` +
        `${isAttachmentSummary ? " is-attachment-summary" : ""}`,
    });
    const bodyEl = contentEl.createDiv({ cls: "obsidian-codex__message-body" });
    if (isSelectionContext) {
      const selectionHeader = bodyEl.createDiv({ cls: "obsidian-codex__selection-message-header" });
      selectionHeader.createSpan({ cls: "obsidian-codex__selection-message-label", text: copy.workspace.selectedText });
      const sourcePath = typeof message.meta?.sourcePath === "string" ? message.meta.sourcePath : null;
      if (sourcePath) {
        selectionHeader.createSpan({ cls: "obsidian-codex__selection-message-source", text: basename(sourcePath) });
      }
      bodyEl.createDiv({
        cls: "obsidian-codex__context-message-preview obsidian-codex__context-message-preview-selection",
        text: message.text,
      });
      return;
    }

    if (isAttachmentSummary) {
      const attachmentHeader = bodyEl.createDiv({ cls: "obsidian-codex__selection-message-header" });
      const attachmentCount =
        typeof message.meta?.attachmentCount === "number" && Number.isFinite(message.meta.attachmentCount)
          ? message.meta.attachmentCount
          : null;
      attachmentHeader.createSpan({
        cls: "obsidian-codex__selection-message-label",
        text: copy.workspace.attachedFiles(attachmentCount),
      });
      bodyEl.createDiv({
        cls: "obsidian-codex__context-message-preview obsidian-codex__context-message-preview-attachments",
        text: message.text,
      });
      return;
    }

    const markdownEl = bodyEl.createDiv({ cls: "obsidian-codex__message-markdown" });
    void MarkdownRenderer.render(this.app, this.getRenderableMessageText(message), markdownEl, "", this);
  }

  private renderActivityEntry(activity: ToolCallRecord): void {
    const copy = this.getCopy();
    const msgEl = this.messagesEl.createDiv({
      cls: `obsidian-codex__message obsidian-codex__message-activity obsidian-codex__message-activity-${activity.status}`,
    });
    const cardEl = msgEl.createDiv({ cls: "obsidian-codex__activity-card" });
    const headEl = cardEl.createDiv({ cls: "obsidian-codex__activity-head" });
    const titleWrapEl = headEl.createDiv({ cls: "obsidian-codex__activity-title-wrap" });
    const iconEl = titleWrapEl.createSpan({ cls: "obsidian-codex__activity-icon" });
    setIcon(iconEl, getActivityIcon(activity.kind));
    titleWrapEl.createSpan({ cls: "obsidian-codex__activity-title", text: activity.title });
    headEl.createSpan({
      cls: `obsidian-codex__activity-status obsidian-codex__activity-status--${activity.status}`,
      text: formatActivityStatusLabel(activity.status, copy.workspace),
    });

    if (activity.summary.trim()) {
      cardEl.createDiv({
        cls: "obsidian-codex__activity-summary",
        text: summarizePreviewText(activity.summary, activity.kind === "file" ? 4 : 3),
      });
    }

    const detailsText =
      activity.resultText && activity.resultText.trim() && activity.resultText.trim() !== activity.summary.trim()
        ? summarizePreviewText(activity.resultText, activity.kind === "file" ? 4 : 3, 320)
        : "";
    if (detailsText) {
      cardEl.createDiv({ cls: "obsidian-codex__activity-details", text: detailsText });
    }
  }

  private renderApprovalEntry(approval: PendingApproval): void {
    const copy = this.getCopy();
    const msgEl = this.messagesEl.createDiv({ cls: "obsidian-codex__message obsidian-codex__message-approval" });
    const cardEl = msgEl.createDiv({ cls: "obsidian-codex__approval-card" });
    cardEl.dataset.approvalId = approval.id;

    const headEl = cardEl.createDiv({ cls: "obsidian-codex__activity-head" });
    const titleWrapEl = headEl.createDiv({ cls: "obsidian-codex__activity-title-wrap" });
    const iconEl = titleWrapEl.createSpan({ cls: "obsidian-codex__activity-icon" });
    setIcon(iconEl, "shield");
    titleWrapEl.createSpan({ cls: "obsidian-codex__activity-title", text: approval.title });
    headEl.createSpan({ cls: "obsidian-codex__approval-status", text: copy.workspace.approvalRequired });

    if (approval.description.trim()) {
      cardEl.createDiv({ cls: "obsidian-codex__activity-summary", text: approval.description });
    }

    const details = approval.diffText?.trim() || approval.details.trim();
    if (details) {
      cardEl.createDiv({
        cls: "obsidian-codex__activity-details obsidian-codex__approval-details",
        text: summarizePreviewText(details, 4, 360),
      });
    }

    const impact = approval.toolPayload?.impact;
    if (impact && (approval.toolPayload?.kind === "rename" || approval.toolPayload?.kind === "move")) {
      const impactEl = cardEl.createDiv({ cls: "obsidian-codex__approval-impact" });
      impactEl.createDiv({
        cls: "obsidian-codex__approval-impact-item",
        text: copy.workspace.backlinks(impact.backlinksCount),
      });
      if (impact.destinationState) {
        impactEl.createDiv({
          cls: "obsidian-codex__approval-impact-item",
          text: impact.destinationState,
        });
      }
      if (impact.backlinkSources.length > 0) {
        impactEl.createDiv({
          cls: "obsidian-codex__approval-impact-item",
          text: copy.workspace.topSources(impact.backlinkSources.join(" · ")),
        });
      }
      if (impact.unresolvedWarning) {
        impactEl.createDiv({
          cls: "obsidian-codex__approval-impact-item is-warning",
          text: impact.unresolvedWarning,
        });
      }
      if (impact.unresolvedSources.length > 0) {
        impactEl.createDiv({
          cls: "obsidian-codex__approval-impact-item",
          text: copy.workspace.unresolvedSources(impact.unresolvedSources.join(" · ")),
        });
      }
      if (impact.recoveryNote) {
        impactEl.createDiv({
          cls: "obsidian-codex__approval-impact-item",
          text: impact.recoveryNote,
        });
      }
    }

    const actionsEl = cardEl.createDiv({ cls: "obsidian-codex__approval-actions" });
    this.createApprovalButton(actionsEl, approval.id, copy.workspace.approve, "approve", false);
    this.createApprovalButton(actionsEl, approval.id, copy.workspace.thisSession, "approve_session", false);
    this.createApprovalButton(actionsEl, approval.id, copy.workspace.deny, "deny", true);
    this.createApprovalButton(actionsEl, approval.id, copy.workspace.abort, "abort", true);
  }

  private createApprovalButton(
    parent: HTMLElement,
    approvalId: string,
    label: string,
    decision: "approve" | "approve_session" | "deny" | "abort",
    isMuted: boolean,
  ): void {
    const button = parent.createEl("button", {
      cls: `obsidian-codex__approval-btn${isMuted ? " is-muted" : ""}`,
      text: label,
    });
    button.type = "button";
    button.addEventListener("click", () => {
      void this.service.respondToApproval(approvalId, decision);
    });
  }

  private createApprovalBatchButton(
    parent: HTMLElement,
    tabId: string,
    label: string,
    decision: "approve" | "approve_session" | "deny",
    isMuted: boolean,
  ): void {
    const button = parent.createEl("button", {
      cls: `obsidian-codex__approval-btn${isMuted ? " is-muted" : ""}`,
      text: label,
    });
    button.type = "button";
    button.addEventListener("click", () => {
      void this.service.respondToAllApprovals(tabId, decision);
    });
  }

  private renderWaitingEntry(waitingState: WorkspaceState["tabs"][number]["waitingState"]): void {
    if (!waitingState) {
      return;
    }
    const msgEl = this.messagesEl.createDiv({ cls: "obsidian-codex__message obsidian-codex__message-waiting" });
    const avatar = msgEl.createDiv({ cls: "obsidian-codex__avatar obsidian-codex__avatar-assistant" });
    setIcon(avatar, "sparkles");
    const body = msgEl.createDiv({ cls: "obsidian-codex__message-content obsidian-codex__message-content--waiting" });
    body.createSpan({ cls: "obsidian-codex__waiting-copy", text: waitingState.text });
    const dotsEl = body.createSpan({ cls: "obsidian-codex__waiting-dots" });
    for (let index = 0; index < 3; index += 1) {
      dotsEl.createSpan({ cls: "obsidian-codex__waiting-dot" });
    }
  }

  private renderPlanMode(composeMode: WorkspaceState["tabs"][number]["composeMode"]): void {
    const planActive = composeMode === "plan";
    this.inputAreaEl.classList.toggle("is-plan-mode", planActive);
    this.planModeTextEl.classList.toggle("is-visible", planActive);
  }

  private renderWorkflowBrief(activeTab: WorkspaceState["tabs"][number] | null): void {
    this.workflowBriefEl.empty();
    if (!activeTab?.studyWorkflow) {
      this.workflowBriefEl.classList.remove("is-visible");
      delete this.workflowBriefEl.dataset.workflow;
      return;
    }

    const locale = this.getLocale();
    const copy = this.getCopy();
    const workflow = getStudyWorkflowDefinition(activeTab.studyWorkflow, locale);
    const activeSmartSetId = this.service.getActiveSmartSetId();
    const activeSmartSet = activeSmartSetId ? this.service.getSmartSets().find((entry) => entry.id === activeSmartSetId) ?? null : null;
    const missingHint = getStudyWorkflowMissingContextHint(activeTab.studyWorkflow, {
      currentFilePath: activeTab.targetNotePath,
      targetNotePath: activeTab.targetNotePath,
      activeSmartSetTitle: activeSmartSet?.title ?? null,
      hasAttachments: this.service.getTabAttachments(activeTab.id).length > 0,
      hasSelection: Boolean(this.service.getTabSelectionContext(activeTab.id)),
      pinnedContextCount: activeTab.contextPaths.length,
    }, locale);

    this.workflowBriefEl.classList.add("is-visible");
    this.workflowBriefEl.dataset.workflow = activeTab.studyWorkflow;
    const headerEl = this.workflowBriefEl.createDiv({ cls: "obsidian-codex__workflow-brief-header" });
    headerEl.createSpan({
      cls: "obsidian-codex__workflow-brief-badge",
      text: workflow.label,
    });
    headerEl.createSpan({
      cls: "obsidian-codex__workflow-brief-summary",
      text: workflow.helperText,
    });

    this.workflowBriefEl.createDiv({
      cls: "obsidian-codex__workflow-brief-contract",
      text: `${copy.workspace.response}: ${workflow.responseContract.join(" · ")}`,
    });

    if (missingHint) {
      this.workflowBriefEl.createDiv({
        cls: "obsidian-codex__workflow-brief-hint",
        text: missingHint,
      });
    }
  }

  private renderSelectionPreview(tabId: string | null): void {
    this.selectionPreviewEl.empty();
    const copy = this.getCopy();
    if (!tabId) {
      this.selectionPreviewEl.classList.remove("is-visible");
      return;
    }

    const selectionContext = this.service.getTabSelectionContext(tabId);
    if (!selectionContext) {
      this.selectionPreviewEl.classList.remove("is-visible");
      return;
    }

    this.selectionPreviewEl.classList.add("is-visible");
    const headerEl = this.selectionPreviewEl.createDiv({ cls: "obsidian-codex__selection-preview-header" });
    headerEl.createSpan({ cls: "obsidian-codex__selection-preview-label", text: copy.workspace.selection });
    headerEl.createSpan({
      cls: "obsidian-codex__selection-preview-source",
      text: selectionContext.sourcePath ? basename(selectionContext.sourcePath) : copy.workspace.currentNote,
    });

    const removeButton = headerEl.createEl("button", {
      cls: "obsidian-codex__selection-preview-remove",
      attr: {
        type: "button",
        "aria-label": copy.workspace.removeSelectedText,
      },
    });
    setIcon(removeButton, "x");
    removeButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.service.setTabSelectionContext(tabId, null);
    });

    this.selectionPreviewEl.createDiv({
      cls: "obsidian-codex__selection-preview-copy",
      text: selectionContext.text,
    });
  }

  private renderAttachments(tabId: string | null): void {
    this.attachmentsRowEl.empty();
    const copy = this.getCopy();
    if (!tabId) {
      this.attachmentsRowEl.classList.remove("is-visible");
      return;
    }

    const attachments = this.service.getTabAttachments(tabId);
    if (attachments.length === 0) {
      this.attachmentsRowEl.classList.remove("is-visible");
      return;
    }

    this.attachmentsRowEl.classList.add("is-visible");
    for (const attachment of attachments) {
      const chipEl = this.attachmentsRowEl.createDiv({ cls: "obsidian-codex__attachment-chip" });
      const iconEl = chipEl.createSpan({ cls: "obsidian-codex__attachment-chip-icon" });
      setIcon(iconEl, attachment.kind === "image" ? "image" : "file-text");
      chipEl.createSpan({ cls: "obsidian-codex__attachment-chip-label", text: attachment.displayName });
      const removeButton = chipEl.createEl("button", {
        cls: "obsidian-codex__attachment-chip-remove",
        attr: {
          type: "button",
          "aria-label": copy.workspace.removeAttachment(attachment.displayName),
        },
      });
      setIcon(removeButton, "x");
      removeButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.service.removeComposerAttachment(tabId, attachment.id);
      });
    }
  }

  private renderCampaignPanel(tabId: string | null): void {
    this.campaignPanelEl.empty();
    if (!VAULT_SURGEON_ENABLED) {
      this.campaignPanelEl.classList.remove("is-visible");
      return;
    }
    if (!tabId) {
      this.campaignPanelEl.classList.remove("is-visible");
      return;
    }

    const campaigns = this.service.getTabCampaigns(tabId);
    if (campaigns.length === 0) {
      this.campaignPanelEl.classList.remove("is-visible");
      return;
    }

    this.campaignPanelEl.classList.add("is-visible");
    for (const campaign of campaigns) {
      this.renderCampaignCard(this.campaignPanelEl, tabId, campaign, true);
    }
  }

  private renderCampaignCard(parent: HTMLElement, tabId: string, campaign: RefactorCampaign, showRecipeAction: boolean): void {
    const cardEl = parent.createDiv({ cls: "obsidian-codex__campaign-card" });
    const headEl = cardEl.createDiv({ cls: "obsidian-codex__campaign-head" });
    const titleWrapEl = headEl.createDiv({ cls: "obsidian-codex__campaign-title-wrap" });
    titleWrapEl.createSpan({ cls: "obsidian-codex__campaign-title", text: campaign.title });
    titleWrapEl.createSpan({ cls: "obsidian-codex__campaign-query", text: campaign.query });
    headEl.createSpan({ cls: `obsidian-codex__campaign-status is-${campaign.status}`, text: campaign.status });

    const summaryEl = cardEl.createDiv({ cls: "obsidian-codex__campaign-summary" });
    summaryEl.createSpan({ text: `${campaign.targetPaths.length} notes` });
    summaryEl.createSpan({ text: `${campaign.items.filter((item) => item.enabled).length}/${campaign.items.length} enabled` });
    summaryEl.createSpan({ text: `${campaign.heatmap.length} impact nodes` });

    if (campaign.heatmap.length > 0) {
      const heatmapEl = cardEl.createDiv({ cls: "obsidian-codex__campaign-heatmap" });
      for (const node of campaign.heatmap.slice(0, 5)) {
        heatmapEl.createDiv({
          cls: "obsidian-codex__campaign-heatmap-item",
          text: `${basename(node.path)} · score ${node.score} · backlinks ${node.backlinks}`,
        });
      }
    }

    const itemsEl = cardEl.createDiv({ cls: "obsidian-codex__campaign-items" });
    for (const item of campaign.items) {
      const itemEl = itemsEl.createDiv({ cls: "obsidian-codex__campaign-item" });
      const toggleEl = itemEl.createEl("input", {
        attr: {
          type: "checkbox",
          "aria-label": `Include ${item.title} in this campaign`,
        },
      });
      toggleEl.checked = item.enabled;
      toggleEl.addEventListener("change", () => {
        this.service.toggleCampaignItem(tabId, campaign.id, item.id, toggleEl.checked);
      });

      const bodyEl = itemEl.createDiv({ cls: "obsidian-codex__campaign-item-body" });
      bodyEl.createDiv({ cls: "obsidian-codex__campaign-item-title", text: item.title });
      bodyEl.createDiv({
        cls: "obsidian-codex__campaign-item-summary",
        text: summarizePreviewText(item.summary || item.targetPath, 2, 180),
      });
      bodyEl.createDiv({
        cls: "obsidian-codex__campaign-item-path",
        text: item.destinationPath ? `${item.targetPath} -> ${item.destinationPath}` : item.targetPath,
      });
    }

    const actionsEl = cardEl.createDiv({ cls: "obsidian-codex__campaign-actions" });
    const applyButton = actionsEl.createEl("button", {
      cls: "obsidian-codex__change-card-btn",
      text: "Apply campaign",
    });
    applyButton.type = "button";
    applyButton.addEventListener("click", () => {
      void this.service.applyCampaign(tabId, campaign.id).catch((error: unknown) => {
        new Notice((error as Error).message);
      });
    });

    const rollbackButton = actionsEl.createEl("button", {
      cls: "obsidian-codex__change-card-btn is-muted",
      text: "Rollback campaign",
    });
    rollbackButton.type = "button";
    rollbackButton.disabled = !campaign.snapshotCapsule;
    rollbackButton.addEventListener("click", () => {
      void this.service.rollbackCampaign(tabId, campaign.id).catch((error: unknown) => {
        new Notice((error as Error).message);
      });
    });

    if (showRecipeAction) {
      const enabledItemCount = campaign.items.filter((item) => item.enabled).length;
      const recipeButton = actionsEl.createEl("button", {
        cls: "obsidian-codex__change-card-btn is-muted",
        text: "Save as recipe",
      });
      recipeButton.type = "button";
      recipeButton.disabled = enabledItemCount === 0;
      recipeButton.addEventListener("click", () => {
        try {
          this.service.saveRecipeFromCampaign(tabId, campaign.id);
        } catch (error) {
          new Notice((error as Error).message);
        }
      });
    }

    const dismissButton = actionsEl.createEl("button", {
      cls: "obsidian-codex__change-card-btn is-muted",
      text: "Dismiss",
    });
    dismissButton.type = "button";
    dismissButton.addEventListener("click", () => {
      this.service.dismissCampaign(tabId, campaign.id);
    });
  }

  private renderRecipeCard(parent: HTMLElement, recipe: RefactorRecipe, isActive: boolean, tabId: string | null): void {
    const cardEl = parent.createDiv({ cls: `obsidian-codex__recipe-card${isActive ? " is-active" : ""}` });
    cardEl.addEventListener("click", () => {
      this.service.activateRefactorRecipe(recipe.id);
    });

    const headEl = cardEl.createDiv({ cls: "obsidian-codex__campaign-head" });
    const titleWrapEl = headEl.createDiv({ cls: "obsidian-codex__campaign-title-wrap" });
    titleWrapEl.createSpan({ cls: "obsidian-codex__campaign-title", text: recipe.title });
    titleWrapEl.createSpan({ cls: "obsidian-codex__campaign-query", text: recipe.description || recipe.sourceQuery });
    headEl.createSpan({
      cls: "obsidian-codex__campaign-status",
      text: recipe.preferredScopeKind.replace("_", " "),
    });

    const summaryEl = cardEl.createDiv({ cls: "obsidian-codex__campaign-summary" });
    summaryEl.createSpan({ text: `${recipe.examples.length} examples` });
    summaryEl.createSpan({ text: recipe.operationKinds.join(", ") || "vault surgery" });
    if (recipe.sourceQuery.trim()) {
      summaryEl.createSpan({ text: recipe.sourceQuery });
    }

    if (recipe.examples.length > 0) {
      const examplesEl = cardEl.createDiv({ cls: "obsidian-codex__recipe-examples" });
      for (const example of recipe.examples.slice(0, 4)) {
        examplesEl.createDiv({
          cls: "obsidian-codex__campaign-heatmap-item",
          text: example.destinationPath
            ? `${example.operationKind}: ${basename(example.targetPath)} -> ${basename(example.destinationPath)}`
            : `${example.operationKind}: ${basename(example.targetPath)}`,
        });
      }
    }

    const actionsEl = cardEl.createDiv({ cls: "obsidian-codex__campaign-actions" });
    const disabled = !tabId;
    const currentNoteButton = actionsEl.createEl("button", {
      cls: "obsidian-codex__change-card-btn",
      text: "Run on current note",
    });
    currentNoteButton.type = "button";
    currentNoteButton.disabled = disabled;
    currentNoteButton.addEventListener("click", () => {
      if (!tabId) {
        return;
      }
      const { file, editor } = this.resolvePromptContext();
      void this.service.runRecipeOnCurrentNote(recipe.id, tabId, file, editor).catch((error: unknown) => {
        new Notice((error as Error).message);
      });
    });

    const smartSetButton = actionsEl.createEl("button", {
      cls: "obsidian-codex__change-card-btn",
      text: "Run on active Smart Set",
    });
    smartSetButton.type = "button";
    smartSetButton.disabled = disabled || !this.service.getActiveSmartSetId();
    smartSetButton.addEventListener("click", () => {
      if (!tabId) {
        return;
      }
      const { file, editor } = this.resolvePromptContext();
      void this.service.runRecipeOnActiveSmartSet(recipe.id, tabId, file, editor).catch((error: unknown) => {
        new Notice((error as Error).message);
      });
    });

    const searchButton = actionsEl.createEl("button", {
      cls: "obsidian-codex__change-card-btn is-muted",
      text: "Run on search",
    });
    searchButton.type = "button";
    searchButton.disabled = disabled;
    searchButton.addEventListener("click", () => {
      if (!tabId) {
        return;
      }
      new PromptModal(
        this.app,
        "Run Refactor Recipe",
        recipe.sourceQuery || "lecture notes ai",
        (value) => {
          const query = value.trim();
          if (!query) {
            new Notice("Provide a search query.");
            return;
          }
          const { file, editor } = this.resolvePromptContext();
          void this.service.runRecipeFromQuery(recipe.id, tabId, query, file, editor).catch((error: unknown) => {
            new Notice((error as Error).message);
          });
        },
        "Enter the search query for the note set that should receive this recipe.",
      ).open();
    });

    const removeButton = actionsEl.createEl("button", {
      cls: "obsidian-codex__change-card-btn is-muted",
      text: "Delete",
    });
    removeButton.type = "button";
    removeButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.service.removeRefactorRecipe(recipe.id);
    });
  }

  private renderPatchBasket(tabId: string | null): void {
    this.changesTrayEl.empty();
    const copy = this.getCopy();
    if (!tabId) {
      this.changesTrayEl.classList.remove("is-visible");
      return;
    }

    const proposals = this.service
      .getTabPatchBasket(tabId)
      .filter((proposal) => proposal.status === "pending" || proposal.status === "conflicted" || proposal.status === "stale");
    if (proposals.length === 0) {
      this.changesTrayEl.classList.remove("is-visible");
      return;
    }

    this.changesTrayEl.classList.add("is-visible");
    const headingEl = this.changesTrayEl.createDiv({ cls: "obsidian-codex__changes-tray-header" });
    headingEl.createSpan({ cls: "obsidian-codex__changes-tray-title", text: copy.workspace.changes });
    headingEl.createSpan({ cls: "obsidian-codex__changes-tray-count", text: String(proposals.length) });

    for (const proposal of proposals) {
      const cardEl = this.changesTrayEl.createDiv({ cls: "obsidian-codex__change-card" });
      const headEl = cardEl.createDiv({ cls: "obsidian-codex__change-card-head" });
      headEl.createSpan({ cls: "obsidian-codex__change-card-path", text: basename(proposal.targetPath) });
      headEl.createSpan({ cls: `obsidian-codex__change-card-status is-${proposal.status}`, text: proposal.status });
      cardEl.createDiv({ cls: "obsidian-codex__change-card-summary", text: proposal.summary });
      cardEl.createEl("pre", {
        cls: "obsidian-codex__change-card-diff",
        text: summarizePreviewText(proposal.unifiedDiff, 8, 520),
      });

      const actionsEl = cardEl.createDiv({ cls: "obsidian-codex__change-card-actions" });
      const openButton = actionsEl.createEl("button", {
        cls: "obsidian-codex__change-card-btn is-muted",
        text: copy.workspace.open,
      });
      openButton.type = "button";
      openButton.addEventListener("click", () => {
        void this.service.openPatchTarget(tabId, proposal.id).catch((error: unknown) => {
          new Notice((error as Error).message);
        });
      });

      const rejectButton = actionsEl.createEl("button", {
        cls: "obsidian-codex__change-card-btn is-muted",
        text: copy.workspace.reject,
      });
      rejectButton.type = "button";
      rejectButton.addEventListener("click", () => {
        this.service.rejectPatchProposal(tabId, proposal.id);
      });

      const applyButton = actionsEl.createEl("button", {
        cls: "obsidian-codex__change-card-btn",
        text: proposal.status === "conflicted" || proposal.status === "stale" ? copy.workspace.retry : copy.workspace.apply,
      });
      applyButton.type = "button";
      applyButton.addEventListener("click", () => {
        void this.service.applyPatchProposal(tabId, proposal.id).catch((error: unknown) => {
          new Notice((error as Error).message);
        });
      });
    }
  }

  private renderWelcome(activeTab: WorkspaceState["tabs"][number] | null): void {
    const locale = this.getLocale();
    const copy = this.getCopy();
    const welcome = this.messagesEl.createDiv({ cls: "obsidian-codex__welcome" });
    const logo = welcome.createDiv({ cls: "obsidian-codex__welcome-logo" });
    setIcon(logo, "sparkles");
    welcome.createEl("h3", { text: copy.workspace.welcomeTitle });
    welcome.createEl("p", {
      text: copy.workspace.welcomeBody,
      cls: "obsidian-codex__welcome-desc",
    });

    const quickActions = welcome.createDiv({ cls: "obsidian-codex__quick-actions" });
    const suggestions = activeTab?.studyWorkflow
      ? [getStudyWorkflowQuickAction(activeTab.studyWorkflow, locale)]
      : copy.workspace.welcomeSuggestions;
    for (const suggestion of suggestions) {
      const chip = quickActions.createEl("button", { cls: "obsidian-codex__suggestion-chip", text: suggestion });
      chip.type = "button";
      chip.addEventListener("click", () => {
        this.inputEl.value = suggestion;
        const tabId = this.activeTabId ?? this.service.getActiveTab()?.id;
        if (tabId) {
          this.service.setDraft(tabId, suggestion);
        }
        void this.sendCurrentPrompt();
      });
    }
  }

  private renderStatusBar(
    activeTab: WorkspaceState["tabs"][number] | null,
    catalog: ModelCatalogEntry[],
  ): void {
    const locale = this.getLocale();
    const activeModel = activeTab?.model ?? DEFAULT_PRIMARY_MODEL;
    if (activeTab?.id) {
      this.service.ensureAccountUsage(activeTab.id);
    }
    const models = catalog.length > 0 ? catalog : this.service.getAvailableModels();
    const selectedModel =
      models.find((entry) => entry.slug === activeModel) ??
      models[0] ?? {
        slug: activeModel,
        displayName: activeModel,
        defaultReasoningLevel: "medium" as const,
        supportedReasoningLevels: ["low", "medium", "high", "xhigh"] as const,
      };

    this.modelValueEl.textContent = compactModelLabel(selectedModel.slug, selectedModel.displayName);
    this.thinkingValueEl.textContent = displayEffortLabel(activeTab?.reasoningEffort ?? selectedModel.defaultReasoningLevel, locale);
    this.renderUsageMeters(this.state?.accountUsage ?? null);

    const streaming = isTabStreaming(activeTab?.status);
    this.statusBarEl.classList.toggle("is-streaming", streaming);

    const yoloActive = this.service.getPermissionMode() === "full-auto";
    this.yoloControlEl.classList.toggle("is-active", yoloActive);

    const disabled = streaming;
    this.modelButtonEl.disabled = disabled;
    this.thinkingButtonEl.disabled = disabled;
    if (disabled && this.statusMenuAnchorEl && (this.statusMenuAnchorEl === this.modelButtonEl || this.statusMenuAnchorEl === this.thinkingButtonEl)) {
      this.closeStatusMenu();
    }
  }

  private renderUsageMeters(accountUsage: AccountUsageSummary | null): void {
    this.usageMetersEl.empty();
    const copy = this.getCopy();
    const meters = getVisibleUsageMeters(accountUsage);
    this.usageMetersEl.classList.add("is-visible");

    const headerEl = this.usageMetersEl.createDiv({ cls: "obsidian-codex__usage-header" });
    headerEl.createSpan({ cls: "obsidian-codex__usage-title", text: copy.workspace.usageTitle });
    const metaParts = [
      accountUsage?.limits.planType ? String(accountUsage.limits.planType).toUpperCase() : null,
      formatUsageSourceLabel(accountUsage?.source ?? null, copy.workspace),
    ].filter((part): part is string => Boolean(part));
    if (metaParts.length > 0) {
      headerEl.createSpan({ cls: "obsidian-codex__usage-meta", text: metaParts.join(" · ") });
    }

    if (!meters.length) {
      this.usageMetersEl.classList.add("is-empty");
      this.usageMetersEl.createDiv({
        cls: "obsidian-codex__usage-empty",
        text: copy.workspace.noUsageYet,
      });
      return;
    }

    this.usageMetersEl.classList.remove("is-empty");

    for (const meter of meters) {
      const rowEl = this.usageMetersEl.createDiv({ cls: "obsidian-codex__usage-meter" });
      rowEl.createSpan({ cls: "obsidian-codex__usage-meter-label", text: meter.label });
      const barEl = rowEl.createDiv({
        cls: "obsidian-codex__usage-meter-bar",
        attr: {
          role: "meter",
          "aria-label": copy.workspace.usageRemainingAria(meter.label),
          "aria-valuemin": "0",
          "aria-valuemax": "100",
          "aria-valuenow": String(meter.percent),
          title: copy.workspace.usageTitleTooltip(
            meter.displayPercent,
            meter.displayUsedPercent,
            accountUsage?.source ? formatUsageSourceLabel(accountUsage.source, copy.workspace) : null,
          ),
        },
      });
      barEl.createDiv({
        cls: "obsidian-codex__usage-meter-spent",
        attr: {
          style: `width:${meter.usedPercent}%`,
        },
      });
      barEl.createDiv({
        cls: "obsidian-codex__usage-meter-fill",
        attr: {
          style: `width:${meter.percent}%`,
        },
      });
      rowEl.createSpan({ cls: "obsidian-codex__usage-meter-value", text: `${meter.displayPercent}%` });
    }
  }

  private renderComposerSuggestions(): void {
    const locale = this.getLocale();
    const cursor = this.inputEl.selectionStart ?? this.inputEl.value.length;
    const mentionSuggestions: ComposerSuggestion[] = this.service.getMentionCandidates().map((entry) => ({
      kind: "mention",
      token: entry.token,
      label: entry.label,
      description: entry.description,
    }));
    const instructionSuggestions: ComposerSuggestion[] = this.service.getInstructionOptions().map((label) => ({
      kind: "instruction",
      token: `#${label}`,
      label: label,
      description: locale === "ja" ? `この turn に #${label} instruction を追加` : `Add #${label} instruction to this turn`,
    }));
    const suggestions = matchComposerSuggestions(
      this.inputEl.value,
      cursor,
      this.service.getSlashCommandCatalog(),
      this.service.getInstalledSkills(),
      mentionSuggestions,
      instructionSuggestions,
    );
    this.composerSuggestions = suggestions;
    if (suggestions.length === 0) {
      this.composerSelectedIndex = 0;
      this.slashMenuEl.empty();
      this.slashMenuEl.classList.remove("is-visible");
      return;
    }

    if (this.composerSelectedIndex >= suggestions.length) {
      this.composerSelectedIndex = 0;
    }

    this.slashMenuEl.empty();
    this.slashMenuEl.classList.add("is-visible");

    for (const [index, suggestion] of suggestions.entries()) {
      const itemEl = this.slashMenuEl.createDiv({
        cls: `obsidian-codex__slash-item${index === this.composerSelectedIndex ? " is-selected" : ""}`,
      });
      itemEl.addEventListener("mousedown", (event) => {
        event.preventDefault();
        this.applyComposerMenuSuggestion(suggestion);
      });

      const headEl = itemEl.createDiv({ cls: "obsidian-codex__slash-item-head" });
      headEl.createSpan({ cls: "obsidian-codex__slash-command", text: suggestion.token });
      headEl.createSpan({ cls: "obsidian-codex__slash-label", text: suggestion.label });
      itemEl.createDiv({ cls: "obsidian-codex__slash-desc", text: suggestion.description });
    }
  }

  private moveComposerSelection(delta: number): void {
    if (this.composerSuggestions.length === 0) {
      return;
    }
    this.composerSelectedIndex =
      (this.composerSelectedIndex + delta + this.composerSuggestions.length) % this.composerSuggestions.length;
    this.renderComposerSuggestions();
  }

  private applyComposerMenuSuggestion(suggestion: ComposerSuggestion | null): void {
    if (!suggestion) {
      return;
    }
    const cursor = this.inputEl.selectionStart ?? this.inputEl.value.length;
    const applied = applyComposerSuggestion(this.inputEl.value, cursor, suggestion);
    this.inputEl.value = applied.value;
    const tabId = this.activeTabId ?? this.service.getActiveTab()?.id;
    if (tabId) {
      this.service.setDraft(tabId, this.inputEl.value);
    }
    this.composerSuggestions = [];
    this.composerSelectedIndex = 0;
    this.renderComposerSuggestions();
    this.syncInputHeight();
    this.inputEl.focus();
    this.inputEl.setSelectionRange(applied.cursor, applied.cursor);
  }

  private showModelPicker(anchor: HTMLElement): void {
    const copy = this.getCopy();
    const activeTab = this.service.getActiveTab();
    if (!activeTab || isTabStreaming(activeTab.status)) {
      return;
    }

    const models = this.state?.availableModels?.length ? this.state.availableModels : this.service.getAvailableModels();
    const options = models.map((model) => ({
      label: compactModelLabel(model.slug, model.displayName),
      selected: model.slug === activeTab.model,
      onSelect: () => {
        void this.service.setTabModel(activeTab.id, model.slug);
      },
    }));
    this.showStatusMenu(anchor, copy.workspace.selectModel, options);
  }

  private showThinkingPicker(anchor: HTMLElement): void {
    const locale = this.getLocale();
    const copy = this.getCopy();
    const activeTab = this.service.getActiveTab();
    if (!activeTab || isTabStreaming(activeTab.status)) {
      return;
    }

    const models = this.state?.availableModels?.length ? this.state.availableModels : this.service.getAvailableModels();
    const selectedModel =
      models.find((entry) => entry.slug === activeTab.model) ??
      models[0] ?? {
        slug: activeTab.model,
        displayName: activeTab.model,
        defaultReasoningLevel: "medium" as const,
        supportedReasoningLevels: ["low", "medium", "high", "xhigh"] as const,
      };

    const options = sortReasoningEffortsDescending(selectedModel.supportedReasoningLevels).map((level) => ({
      label: displayEffortLabel(level, locale),
      selected: level === activeTab.reasoningEffort,
      iconText: "\u25CC",
      onSelect: () => {
        void this.service.setTabReasoningEffort(activeTab.id, level);
      },
    }));
    this.showStatusMenu(anchor, copy.workspace.selectThinkingLevel, options);
  }

  private showStatusMenu(anchor: HTMLElement, title: string, options: StatusMenuOption[]): void {
    if (!this.statusBarEl) {
      return;
    }

    if (this.statusMenuAnchorEl === anchor) {
      this.closeStatusMenu();
      return;
    }

    this.closeStatusMenu();
    anchor.classList.add("is-open");

    const menu = this.statusBarEl.createDiv({ cls: "obsidian-codex__status-menu" });
    menu.createDiv({ cls: "obsidian-codex__status-menu-title", text: title });

    for (const option of options) {
      const item = menu.createDiv({ cls: "obsidian-codex__status-menu-item" });
      item.tabIndex = 0;
      const leading = item.createSpan({ cls: "obsidian-codex__status-menu-leading", text: option.iconText ?? "" });
      if (!option.iconText) {
        leading.addClass("is-empty");
      }
      item.createSpan({ cls: "obsidian-codex__status-menu-label", text: option.label });
      const check = item.createSpan({ cls: "obsidian-codex__status-menu-check" });
      if (option.selected) {
        setIcon(check, "check");
      }
      item.addEventListener("click", (event) => {
        event.stopPropagation();
        option.onSelect();
        this.closeStatusMenu();
      });
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          option.onSelect();
          this.closeStatusMenu();
        }
      });
    }

    const statusRect = this.statusBarEl.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const menuWidth = 220;
    const left = Math.max(0, Math.min(anchorRect.left - statusRect.left, Math.max(0, statusRect.width - menuWidth)));
    menu.style.left = `${left}px`;

    this.statusMenuEl = menu;
    this.statusMenuAnchorEl = anchor;
    this.statusMenuCloseHandler = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && !menu.contains(target) && !anchor.contains(target)) {
        this.closeStatusMenu();
      }
    };

    window.setTimeout(() => {
      if (this.statusMenuCloseHandler) {
        document.addEventListener("click", this.statusMenuCloseHandler);
      }
    }, 0);
  }

  private closeStatusMenu(): void {
    this.statusMenuEl?.remove();
    this.statusMenuEl = null;
    this.statusMenuAnchorEl?.classList.remove("is-open");
    this.statusMenuAnchorEl = null;
    if (this.statusMenuCloseHandler) {
      document.removeEventListener("click", this.statusMenuCloseHandler);
      this.statusMenuCloseHandler = null;
    }
  }

  private syncInputHeight(reset = false): void {
    if (!this.inputEl) {
      return;
    }

    this.inputEl.style.height = "auto";
    const nextHeight =
      reset && !this.inputEl.value.trim()
        ? 60
        : Math.min(Math.max(this.inputEl.scrollHeight, 60), 200);
    this.inputEl.style.height = `${nextHeight}px`;
  }

  private togglePlanMode(): void {
    const tabId = this.activeTabId ?? this.service.getActiveTab()?.id;
    if (!tabId) {
      return;
    }
    this.service.toggleTabComposeMode(tabId);
  }

  private async sendCurrentPrompt(): Promise<void> {
    const tabId = this.activeTabId ?? this.service.getActiveTab()?.id;
    if (!tabId) {
      return;
    }

    try {
      const { editor, file } = this.resolvePromptContext();
      await this.service.sendPrompt(tabId, this.inputEl.value, {
        file,
        editor,
      });
      this.syncInputHeight(true);
    } catch (error) {
      new Notice((error as Error).message);
    }
  }

  private getRenderableMessageText(message: ChatMessage): string {
    if (message.kind === "user" || message.kind === "system") {
      return message.text;
    }
    const stripped = message.kind === "assistant" ? stripAssistantProposalBlocks(message.text) : message.text;
    const normalized = stripped.replace(/^(?:[ \t]*\r?\n)+/, "");
    if (message.kind === "assistant" && !normalized.trim() && message.text.trim()) {
      return this.getCopy().workspace.changesProposedBelow;
    }
    return normalized;
  }

  private async handleFileInputChange(): Promise<void> {
    const files = this.fileInputEl.files ? Array.from(this.fileInputEl.files) : [];
    this.fileInputEl.value = "";
    await this.attachBrowserFiles(files, "picker");
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
    await this.attachBrowserFiles(clipboardFiles, "clipboard");
  }

  private async attachBrowserFiles(files: File[], source: "clipboard" | "picker"): Promise<void> {
    const tabId = this.activeTabId ?? this.service.getActiveTab()?.id;
    if (!tabId || files.length === 0) {
      return;
    }

    try {
      const inputs = await Promise.all(
        files.map(async (file): Promise<ComposerAttachmentInput> => {
          const buffer = await file.arrayBuffer();
          const maybePath = "path" in file && typeof (file as File & { path?: string }).path === "string" ? (file as File & { path?: string }).path ?? null : null;
          return {
            name: file.name || (this.getLocale() === "ja" ? "添付ファイル" : "attachment"),
            mimeType: file.type || null,
            bytes: new Uint8Array(buffer),
            source,
            originalPath: maybePath,
          };
        }),
      );
      await this.service.addComposerAttachments(tabId, inputs);
    } catch (error) {
      new Notice((error as Error).message);
    }
  }

  private resolvePromptContext(): { file: TFile | null; editor: MarkdownView["editor"] | null } {
    const activeFile = this.app.workspace.getActiveFile();
    const activeEditor = this.app.workspace.activeEditor?.editor ?? null;
    if (activeEditor) {
      return { file: activeFile, editor: activeEditor };
    }

    if (activeFile) {
      for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
        if (leaf.view instanceof MarkdownView && leaf.view.file?.path === activeFile.path) {
          return {
            file: activeFile,
            editor: leaf.view.editor,
          };
        }
      }
    }

    const recentLeaf = this.app.workspace.getMostRecentLeaf();
    if (recentLeaf?.view instanceof MarkdownView) {
      return {
        file: recentLeaf.view.file ?? activeFile,
        editor: recentLeaf.view.editor,
      };
    }

    return { file: activeFile, editor: null };
  }

  private async openTargetNote(): Promise<void> {
    const tabId = this.activeTabId ?? this.service.getActiveTab()?.id;
    if (!tabId) {
      return;
    }

    const targetPath = this.service.getTabTargetNotePath(tabId);
    if (!targetPath) {
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(targetPath);
    if (!(file instanceof TFile)) {
      return;
    }

    await this.app.workspace.getLeaf(false).openFile(file);
  }

  focusComposer(): void {
    window.setTimeout(() => {
      this.inputEl?.focus();
      const length = this.inputEl?.value.length ?? 0;
      this.inputEl?.setSelectionRange(length, length);
    }, 0);
  }

  openAttachmentPicker(): void {
    this.fileInputEl?.click();
  }
}
