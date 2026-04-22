import { MarkdownRenderer, Notice, setIcon } from "obsidian";
import { basename } from "node:path";
import { CHAT_AVATAR_DATA_URL } from "../../generated/chatAvatar";
import type { ChatMessage, EditOutcome, PendingApproval, ToolCallRecord, WorkspaceState } from "../../model/types";
import { normalizeVisibleUserPromptText } from "../../util/assistantChatter";
import { extractAssistantProposals } from "../../util/assistantProposals";
import { TRANSCRIPT_SOFT_COLLAPSE_WINDOW } from "../../util/conversationCompaction";
import { clampTranscriptScrollTop, shouldStickTranscriptToBottom } from "../../util/transcriptScroll";
import { buildTranscriptEntries } from "../../util/transcriptEntries";
import type { WorkspaceRenderCallbacks, WorkspaceRenderContext } from "./types";
import { buildStatusBarDisplayState, buildTranscriptRenderState } from "./viewModels/workspaceViewModels";
import {
  formatActivityStatusLabel,
  formatCompactTimestamp,
  getActivityIcon,
  summarizePreviewText,
} from "./workspaceViewShared";

interface TranscriptScrollState {
  scrollTop: number;
  shouldAutoFollow: boolean;
}

export class TranscriptRenderer {
  private lastRenderedTabId: string | null = null;
  private readonly scrollStateByTab = new Map<string, TranscriptScrollState>();
  private readonly expandedSummaryTabs = new Set<string>();
  private ignoreProgrammaticScroll = false;
  private restoreScrollVersion = 0;
  private lastRenderSignature: string | null = null;

  constructor(
    private readonly root: HTMLDivElement,
    private readonly callbacks: Pick<WorkspaceRenderCallbacks, "markdownComponent" | "seedDraftAndSend" | "respondToChatSuggestion">,
  ) {
    this.root.addEventListener("scroll", () => {
      if (this.ignoreProgrammaticScroll) {
        return;
      }
      this.captureCurrentScrollState();
    });
  }

  render(context: WorkspaceRenderContext): void {
    const activeTab = context.activeTab;
    const activeTabId = activeTab?.id ?? null;
    const previousTabId = this.lastRenderedTabId;
    this.captureCurrentScrollState();

    const transcript = activeTab
      ? buildTranscriptEntries(
          activeTab.messages,
          context.service.getShowReasoning(),
          activeTab.toolLog,
          activeTab.pendingApprovals,
          activeTab.waitingState,
          activeTab.status,
          ["shell"],
        )
      : [];
    const renderState = buildTranscriptRenderState(activeTab, transcript.length);
    const showCollapsedTranscript = Boolean(activeTabId && renderState.showSummaryWindow && !this.expandedSummaryTabs.has(activeTabId));
    const renderSignature = this.createRenderSignature(context, activeTabId, transcript, renderState, showCollapsedTranscript);
    if (activeTabId === previousTabId && renderSignature === this.lastRenderSignature) {
      return;
    }
    this.lastRenderSignature = renderSignature;

    let shouldStickToBottom = true;
    let preservedScrollTop = 0;
    if (activeTabId) {
      const currentState =
        activeTabId === previousTabId
          ? this.scrollStateByTab.get(activeTabId) ?? {
              scrollTop: this.root.scrollTop,
              shouldAutoFollow: shouldStickTranscriptToBottom({
                activeTabId,
                previousTabId,
                scrollTop: this.root.scrollTop,
                scrollHeight: this.root.scrollHeight,
                clientHeight: this.root.clientHeight,
              }),
            }
          : this.scrollStateByTab.get(activeTabId) ?? null;
      shouldStickToBottom = currentState ? currentState.shouldAutoFollow : true;
      preservedScrollTop = currentState?.scrollTop ?? this.root.scrollTop;
      const autoScrollStreaming =
        typeof (context.service as { shouldAutoScrollStreaming?: () => boolean }).shouldAutoScrollStreaming === "function"
          ? (context.service as { shouldAutoScrollStreaming: () => boolean }).shouldAutoScrollStreaming()
          : true;
      if (activeTab?.status === "busy" && !autoScrollStreaming) {
        shouldStickToBottom = false;
      }
    }

    this.withProgrammaticScrollIgnored(() => {
      this.root.empty();
      this.root.addClass("obsidian-codex__messages");
    });

    if (renderState.showWelcome) {
      this.lastRenderedTabId = activeTabId;
      this.renderWelcome(context);
      return;
    }

    if (activeTab && renderState.hasConversationContext) {
      this.renderConversationSummary(
        context,
        activeTab,
        transcript.length,
        showCollapsedTranscript,
        Math.max(0, transcript.length - TRANSCRIPT_SOFT_COLLAPSE_WINDOW),
      );
    }
    if (activeTab && renderState.showApprovalBatchBar) {
      this.renderApprovalBatchBar(context, activeTab.id);
    }

    const visibleTranscript = showCollapsedTranscript ? transcript.slice(-TRANSCRIPT_SOFT_COLLAPSE_WINDOW) : transcript;
    for (const entry of visibleTranscript) {
      if (entry.type === "message") {
        this.renderTranscriptMessage(context, entry.message);
        continue;
      }
      if (entry.type === "activity") {
        this.renderActivityEntry(context, entry.activity);
        continue;
      }
      if (entry.type === "approval") {
        this.renderApprovalEntry(context, entry.approval);
        continue;
      }
      this.renderWaitingEntry(entry.waitingState);
    }

    this.lastRenderedTabId = activeTabId;
    const restoreVersion = ++this.restoreScrollVersion;
    this.restoreScrollPosition(activeTabId, shouldStickToBottom, preservedScrollTop);
    window.requestAnimationFrame(() => {
      if (restoreVersion !== this.restoreScrollVersion) {
        return;
      }
      this.restoreScrollPosition(activeTabId, shouldStickToBottom, preservedScrollTop);
      this.captureCurrentScrollState();
    });
  }

  private createRenderSignature(
    context: WorkspaceRenderContext,
    activeTabId: string | null,
    transcript: ReturnType<typeof buildTranscriptEntries>,
    renderState: ReturnType<typeof buildTranscriptRenderState>,
    showCollapsedTranscript: boolean,
  ): string {
    const activeTab = context.activeTab;
    const approvals = activeTab?.pendingApprovals ?? [];
    const summaryText = activeTab?.summary?.text ?? "";
    const waitingText = activeTab?.waitingState?.text ?? "";
    const suggestionSignature = createChatSuggestionSignature(activeTab?.chatSuggestion ?? null);
    const transcriptSignature = transcript
      .map((entry) => {
        if (entry.type === "message") {
          return [
            "m",
            entry.message.id,
            entry.message.kind,
            String(entry.message.createdAt),
            String(entry.message.text.length),
            entry.message.pending ? "1" : "0",
            createMessageMetaSignature(entry.message.meta),
          ].join(":");
        }
        if (entry.type === "activity") {
          return `a:${entry.activity.id}:${entry.activity.status}:${entry.activity.createdAt}:${entry.activity.title}:${entry.activity.summary}`;
        }
        if (entry.type === "approval") {
          return `p:${entry.approval.id}:${entry.approval.createdAt}:${entry.approval.title}:${entry.approval.toolName}`;
        }
        return `w:${entry.waitingState.phase}:${entry.waitingState.text}`;
      })
      .join("|");

    return [
      context.locale,
      activeTabId ?? "no-tab",
      activeTab?.status ?? "no-status",
      activeTab?.messages.length ?? 0,
      activeTab?.toolLog.length ?? 0,
      approvals.length,
      summaryText,
      activeTab?.lineage.forkedFromThreadId ?? "",
      activeTab?.lineage.resumedFromThreadId ?? "",
      String(activeTab?.lineage.compactedAt ?? ""),
      waitingText,
      String(renderState.showWelcome),
      String(renderState.showApprovalBatchBar),
      String(renderState.showSummaryWindow),
      String(showCollapsedTranscript),
      suggestionSignature,
      transcriptSignature,
    ].join("::");
  }

  private withProgrammaticScrollIgnored(callback: () => void): void {
    this.ignoreProgrammaticScroll = true;
    try {
      callback();
    } finally {
      this.ignoreProgrammaticScroll = false;
    }
  }

  private captureCurrentScrollState(): void {
    if (!this.lastRenderedTabId) {
      return;
    }
    this.scrollStateByTab.set(this.lastRenderedTabId, {
      scrollTop: this.root.scrollTop,
      shouldAutoFollow: shouldStickTranscriptToBottom({
        activeTabId: this.lastRenderedTabId,
        previousTabId: this.lastRenderedTabId,
        scrollTop: this.root.scrollTop,
        scrollHeight: this.root.scrollHeight,
        clientHeight: this.root.clientHeight,
      }),
    });
  }

  private restoreScrollPosition(
    activeTabId: string | null,
    fallbackShouldStickToBottom: boolean,
    fallbackScrollTop: number,
  ): void {
    const latestState = activeTabId ? this.scrollStateByTab.get(activeTabId) : null;
    const nextShouldStickToBottom = latestState?.shouldAutoFollow ?? fallbackShouldStickToBottom;
    const nextScrollTop = latestState?.scrollTop ?? fallbackScrollTop;
    this.withProgrammaticScrollIgnored(() => {
      if (nextShouldStickToBottom) {
        this.root.scrollTop = this.root.scrollHeight;
      } else {
        this.root.scrollTop = clampTranscriptScrollTop(nextScrollTop, this.root.scrollHeight, this.root.clientHeight);
      }
    });
  }

  private renderConversationSummary(
    context: WorkspaceRenderContext,
    activeTab: WorkspaceState["tabs"][number],
    transcriptLength: number,
    showCollapsedTranscript: boolean,
    hiddenEntryCount: number,
  ): void {
    const { copy, locale } = context;
    const cardEl = this.root.createDiv({ cls: "obsidian-codex__conversation-summary" });
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
    if (activeTab.summary && showCollapsedTranscript) {
      metaEl.createSpan({
        cls: "obsidian-codex__conversation-summary-chip",
        text: copy.workspace.showingLastItems(TRANSCRIPT_SOFT_COLLAPSE_WINDOW),
      });
    }
    if (activeTab.summary?.text.trim()) {
      cardEl.createDiv({
        cls: "obsidian-codex__conversation-summary-body",
        text: activeTab.summary.text,
      });
    }
    if (transcriptLength > TRANSCRIPT_SOFT_COLLAPSE_WINDOW) {
      const actionsEl = cardEl.createDiv({ cls: "obsidian-codex__conversation-summary-actions" });
      const toggleEl = actionsEl.createEl("button", {
        cls: "obsidian-codex__conversation-summary-toggle",
        text: this.getSummaryToggleLabel(locale, showCollapsedTranscript, hiddenEntryCount),
        attr: { type: "button" },
      });
      toggleEl.addEventListener("click", () => {
        if (showCollapsedTranscript) {
          this.expandedSummaryTabs.add(activeTab.id);
        } else {
          this.expandedSummaryTabs.delete(activeTab.id);
        }
        this.render(context);
      });
    }
  }

  private getSummaryToggleLabel(locale: "en" | "ja", collapsed: boolean, hiddenEntryCount: number): string {
    if (collapsed) {
      return locale === "ja" ? `以前の ${hiddenEntryCount} 件を表示` : `Show ${hiddenEntryCount} earlier messages`;
    }
    return locale === "ja" ? "以前のメッセージをたたむ" : "Collapse earlier messages";
  }

  private renderApprovalBatchBar(context: WorkspaceRenderContext, tabId: string): void {
    const wrapEl = this.root.createDiv({ cls: "obsidian-codex__approval-batch" });
    wrapEl.createSpan({ cls: "obsidian-codex__approval-batch-label", text: context.copy.workspace.pendingApprovals });
    const actionsEl = wrapEl.createDiv({ cls: "obsidian-codex__approval-batch-actions" });
    const pendingTargets = (context.activeTab?.pendingApprovals ?? [])
      .filter((approval) => approval.toolName === "vault_op" || approval.toolName === "skill_update")
      .map((approval) => approval.decisionTarget ?? approval.description)
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
    this.createApprovalBatchButton(
      context,
      actionsEl,
      tabId,
      context.copy.workspace.approveAll,
      "approve",
      false,
      context.copy.workspace.approveAllConfirm(pendingTargets.length, pendingTargets.join(", ")),
    );
    this.createApprovalBatchButton(context, actionsEl, tabId, context.copy.workspace.denyAll, "deny", true);
  }

  private renderTranscriptMessage(context: WorkspaceRenderContext, message: ChatMessage): void {
    const copy = context.copy;
    const isSelectionContext = message.meta?.selectionContext === true;
    const isAttachmentSummary = message.meta?.attachmentSummary === true;
    const isSuccessSystemMessage = message.kind === "system" && message.meta?.tone === "success";
    const msgEl = this.root.createDiv({
      cls: `obsidian-codex__message obsidian-codex__message-${message.kind}${isSelectionContext ? " obsidian-codex__message-selection" : ""}`,
    });

    if (message.kind !== "user" && message.kind !== "system") {
      const avatar = msgEl.createDiv({ cls: "obsidian-codex__avatar obsidian-codex__avatar-assistant" });
      this.applyAssistantAvatar(avatar);
    }

    const contentEl = msgEl.createDiv({
      cls:
        `obsidian-codex__message-content obsidian-codex__message-content--${message.kind}` +
        `${message.pending ? " is-pending" : ""}` +
        `${isSelectionContext ? " is-selection-context" : ""}` +
        `${isAttachmentSummary ? " is-attachment-summary" : ""}` +
        `${isSuccessSystemMessage ? " is-success" : ""}`,
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

    if (message.kind === "user") {
      this.renderCompactMetaChips(bodyEl, copy.workspace.panelSkills, message.meta?.effectiveSkillsCsv, "/");
    }

    const markdownEl = bodyEl.createDiv({ cls: "obsidian-codex__message-markdown" });
    void MarkdownRenderer.render(
      context.app,
      this.getRenderableMessageText(context, message),
      markdownEl,
      "",
      this.callbacks.markdownComponent,
    );

    if (
      message.kind === "assistant" &&
      activeTabSuggestion(context, message.id)?.status === "pending"
    ) {
      this.renderChatSuggestionActions(contentEl, context, activeTabSuggestion(context, message.id)!);
    }
  }

  private renderCompactMetaChips(
    parent: HTMLElement,
    label: string,
    valuesCsv: string | number | boolean | null | undefined,
    prefix: "/" | "#",
  ): void {
    if (typeof valuesCsv !== "string" || !valuesCsv.trim()) {
      return;
    }

    const values = valuesCsv
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (values.length === 0) {
      return;
    }

    const metaEl = parent.createDiv({ cls: "obsidian-codex__selection-message-header obsidian-codex__message-skill-meta" });
    metaEl.createSpan({ cls: "obsidian-codex__selection-message-label", text: label });
    const chipsEl = metaEl.createDiv({ cls: "obsidian-codex__message-skill-chips" });
    for (const value of values) {
      chipsEl.createSpan({
        cls: "obsidian-codex__message-skill-chip",
        text: `${prefix}${value}`,
      });
    }
  }

  private renderChatSuggestionActions(
    parent: HTMLElement,
    context: WorkspaceRenderContext,
    suggestion: NonNullable<WorkspaceState["tabs"][number]["chatSuggestion"]>,
  ): void {
    const activeTabId = context.activeTab?.id;
    if (!activeTabId) {
      return;
    }
    const actionsEl = parent.createDiv({ cls: "obsidian-codex__chat-suggestion-actions" });
    const createButton = (
      label: string,
      action: "update_panel" | "save_panel_copy" | "update_skill" | "dismiss" | "implement_now" | "rewrite_note",
      muted = false,
      options?: { disabled?: boolean; title?: string; confirmText?: string },
    ) => {
      const button = actionsEl.createEl("button", {
        cls: `obsidian-codex__suggestion-chip${muted ? " is-muted" : ""}`,
        text: label,
      });
      button.type = "button";
      if (options?.disabled) {
        button.disabled = true;
        button.classList.add("is-disabled");
      }
      if (options?.title) {
        button.title = options.title;
      }
      button.addEventListener("click", () => {
        if (button.disabled) {
          return;
        }
        if (options?.confirmText && typeof window !== "undefined" && !window.confirm(options.confirmText)) {
          return;
        }
        void this.callbacks.respondToChatSuggestion(action).catch((error: unknown) => {
          new Notice((error as Error).message);
        });
      });
    };

    if (suggestion.kind === "rewrite_followup") {
      createButton(context.copy.workspace.reflectInNote, "rewrite_note");
      createButton(context.copy.workspace.skipSuggestion, "dismiss", true);
      return;
    }

    if (suggestion.kind === "plan_execute") {
      const summary = suggestion.planSummary?.trim() ?? "";
      if (summary) {
        parent.createDiv({
          cls: "obsidian-codex__activity-details obsidian-codex__approval-details",
          text: summary,
        });
      }
      if (context.service.getPermissionMode() === "full-auto") {
        const statusState = buildStatusBarDisplayState(
          context.activeTab,
          context.state.availableModels,
          context.state.accountUsage ?? null,
          context.service.getPermissionMode(),
          context.locale,
          context.copy.workspace,
        );
        createButton(
          context.copy.workspace.implementNow,
          "implement_now",
          false,
          statusState.canImplementReadyPlan
            ? { confirmText: context.copy.workspace.implementNowConfirm(summary) }
            : { disabled: true, title: context.copy.workspace.implementNowNotReady },
        );
      }
      createButton(context.copy.workspace.skipSuggestion, "dismiss", true);
      return;
    }

    if (suggestion.canUpdatePanel) {
      createButton(context.copy.workspace.updatePanel, "update_panel");
    }
    if (suggestion.canSaveCopy) {
      createButton(context.copy.workspace.saveAsNewPanel, "save_panel_copy", true);
    }
    if (suggestion.matchedSkillName) {
      createButton(context.copy.workspace.updateSkill, "update_skill", true);
    }
    createButton(context.copy.workspace.skipSuggestion, "dismiss", true);
  }

  private renderActivityEntry(context: WorkspaceRenderContext, activity: ToolCallRecord): void {
    const msgEl = this.root.createDiv({
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
      text: formatActivityStatusLabel(activity.status, context.copy.workspace),
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

  private renderApprovalEntry(context: WorkspaceRenderContext, approval: PendingApproval): void {
    const msgEl = this.root.createDiv({ cls: "obsidian-codex__message obsidian-codex__message-approval" });
    const cardEl = msgEl.createDiv({ cls: "obsidian-codex__approval-card" });
    cardEl.dataset.approvalId = approval.id;

    const headEl = cardEl.createDiv({ cls: "obsidian-codex__activity-head" });
    const titleWrapEl = headEl.createDiv({ cls: "obsidian-codex__activity-title-wrap" });
    const iconEl = titleWrapEl.createSpan({ cls: "obsidian-codex__activity-icon" });
    setIcon(iconEl, "shield");
    titleWrapEl.createSpan({ cls: "obsidian-codex__activity-title", text: approval.title });
    headEl.createSpan({ cls: "obsidian-codex__approval-status", text: context.copy.workspace.approvalRequired });

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

    const vaultOpPayload = approval.toolName === "vault_op" ? approval.toolPayload : null;
    const impact = vaultOpPayload && "impact" in vaultOpPayload ? vaultOpPayload.impact : null;
    if (
      impact &&
      vaultOpPayload &&
      "kind" in vaultOpPayload &&
      (vaultOpPayload.kind === "rename" || vaultOpPayload.kind === "move")
    ) {
      const impactEl = cardEl.createDiv({ cls: "obsidian-codex__approval-impact" });
      impactEl.createDiv({
        cls: "obsidian-codex__approval-impact-item",
        text: context.copy.workspace.backlinks(impact.backlinksCount),
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
          text: context.copy.workspace.topSources(impact.backlinkSources.join(" · ")),
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
          text: context.copy.workspace.unresolvedSources(impact.unresolvedSources.join(" · ")),
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
    this.createApprovalButton(context, actionsEl, approval.id, context.copy.workspace.approve, "approve", false);
    this.createApprovalButton(context, actionsEl, approval.id, context.copy.workspace.deny, "deny", true);
    this.createApprovalButton(
      context,
      actionsEl,
      approval.id,
      context.copy.workspace.abort,
      "abort",
      true,
      `${context.copy.workspace.abort}: ${approval.title}`,
    );
  }

  private renderWaitingEntry(waitingState: WorkspaceState["tabs"][number]["waitingState"]): void {
    if (!waitingState) {
      return;
    }
    const msgEl = this.root.createDiv({ cls: "obsidian-codex__message obsidian-codex__message-waiting" });
    const avatar = msgEl.createDiv({ cls: "obsidian-codex__avatar obsidian-codex__avatar-assistant" });
    this.applyAssistantAvatar(avatar);
    const body = msgEl.createDiv({ cls: "obsidian-codex__message-content obsidian-codex__message-content--waiting" });
    body.createSpan({ cls: "obsidian-codex__waiting-copy", text: waitingState.text });
    const dotsEl = body.createSpan({ cls: "obsidian-codex__waiting-dots" });
    for (let index = 0; index < 3; index += 1) {
      dotsEl.createSpan({ cls: "obsidian-codex__waiting-dot" });
    }
  }

  private renderWelcome(context: WorkspaceRenderContext): void {
    const { copy } = context;
    const welcome = this.root.createDiv({ cls: "obsidian-codex__welcome" });
    const logo = welcome.createDiv({ cls: "obsidian-codex__welcome-logo" });
    this.applyAssistantAvatar(logo);
    welcome.createEl("h3", { text: copy.workspace.welcomeTitle });
    welcome.createEl("p", {
      text: copy.workspace.welcomeBody,
      cls: "obsidian-codex__welcome-desc",
    });
    const actionsEl = welcome.createDiv({ cls: "obsidian-codex__quick-actions" });
    for (const [index, prompt] of copy.workspace.welcomeSuggestions.slice(0, 3).entries()) {
      const button = actionsEl.createEl("button", {
        cls: "obsidian-codex__suggestion-chip",
        text: prompt,
      });
      button.type = "button";
      button.dataset.smoke = `welcome-suggestion-${index}`;
      button.addEventListener("click", () => {
        void this.callbacks.seedDraftAndSend(prompt).catch((error: unknown) => {
          new Notice((error as Error).message);
        });
      });
    }
  }

  private applyAssistantAvatar(parent: HTMLElement): void {
    parent.removeAttribute("data-has-image");
    const existingImage = parent.querySelector(".obsidian-codex__avatar-image");
    existingImage?.remove();
    setIcon(parent, "sparkles");
    try {
      if (!CHAT_AVATAR_DATA_URL) {
        return;
      }
      const imageEl = document.createElement("img");
      imageEl.className = "obsidian-codex__avatar-image";
      imageEl.alt = "Codex";
      imageEl.draggable = false;
      imageEl.addEventListener("load", () => {
        parent.dataset.hasImage = "true";
      });
      imageEl.addEventListener("error", () => {
        imageEl.remove();
        parent.removeAttribute("data-has-image");
      });
      imageEl.src = CHAT_AVATAR_DATA_URL;
      parent.appendChild(imageEl);
    } catch {
      parent.removeAttribute("data-has-image");
      const imageEl = parent.querySelector(".obsidian-codex__avatar-image");
      imageEl?.remove();
      setIcon(parent, "sparkles");
    }
  }

  private getRenderableMessageText(context: WorkspaceRenderContext, message: ChatMessage): string {
    if (message.kind === "user") {
      return normalizeVisibleUserPromptText(
        message.text,
        context.copy.workspace.reflectInNote,
        typeof message.meta?.internalPromptKind === "string" ? message.meta.internalPromptKind : null,
      );
    }
    if (message.kind === "system") {
      return message.text;
    }
    const parsed = extractAssistantProposals(message.text);
    const normalized = parsed.sanitizedDisplayText.replace(/^(?:[ \t]*\r?\n)+/, "");
    const editStatusLine = message.kind === "assistant" ? buildEditStatusLine(context, message.meta) : null;
    const suggestion = message.kind === "assistant" ? activeTabSuggestion(context, message.id) : null;
    const rewriteQuestion =
      suggestion?.kind === "rewrite_followup"
        ? suggestion.rewriteQuestion?.trim() || context.copy.workspace.reflectInNoteQuestion
        : null;
    const hasArtifacts =
      parsed.patches.length > 0 || parsed.ops.length > 0 || Boolean(parsed.plan || parsed.suggestion || parsed.studyCheckpoint);
    const body = !normalized.trim() && hasArtifacts ? context.copy.workspace.changesProposedBelow : normalized;
    const bodyWithQuestion =
      rewriteQuestion && body.trim() && !body.includes(rewriteQuestion)
        ? `${body}\n\n${rewriteQuestion}`
        : rewriteQuestion && !body.trim()
          ? rewriteQuestion
          : body;

    if (!editStatusLine) {
      return bodyWithQuestion;
    }
    if (!bodyWithQuestion.trim()) {
      return editStatusLine;
    }
    if (bodyWithQuestion.startsWith(editStatusLine)) {
      return bodyWithQuestion;
    }
    return `${editStatusLine}\n\n${bodyWithQuestion}`;
  }

  private createApprovalButton(
    context: WorkspaceRenderContext,
    parent: HTMLElement,
    approvalId: string,
    label: string,
    decision: "approve" | "approve_session" | "deny" | "abort",
    isMuted: boolean,
    confirmText?: string,
  ): void {
    const button = parent.createEl("button", {
      cls: `obsidian-codex__approval-btn${isMuted ? " is-muted" : ""}`,
      text: label,
    });
    button.type = "button";
    button.addEventListener("click", () => {
      if (confirmText && typeof window !== "undefined" && !window.confirm(confirmText)) {
        return;
      }
      void context.service.respondToApproval(approvalId, decision);
    });
  }

  private createApprovalBatchButton(
    context: WorkspaceRenderContext,
    parent: HTMLElement,
    tabId: string,
    label: string,
    decision: "approve" | "approve_session" | "deny",
    isMuted: boolean,
    confirmText?: string,
  ): void {
    const button = parent.createEl("button", {
      cls: `obsidian-codex__approval-btn${isMuted ? " is-muted" : ""}`,
      text: label,
    });
    button.type = "button";
    button.addEventListener("click", () => {
      if (confirmText && typeof window !== "undefined" && !window.confirm(confirmText)) {
        return;
      }
      void context.service.respondToAllApprovals(tabId, decision);
    });
  }
}

function activeTabSuggestion(
  context: WorkspaceRenderContext,
  messageId: string,
): NonNullable<WorkspaceState["tabs"][number]["chatSuggestion"]> | null {
  const suggestion = context.activeTab?.chatSuggestion ?? null;
  if (!suggestion || suggestion.messageId !== messageId) {
    return null;
  }
  return suggestion;
}

function createMessageMetaSignature(meta: ChatMessage["meta"] | null | undefined): string {
  if (!meta) {
    return "";
  }
  return JSON.stringify({
    tone: meta.tone ?? null,
    selectionContext: meta.selectionContext === true,
    attachmentSummary: meta.attachmentSummary === true,
    sourcePath: typeof meta.sourcePath === "string" ? meta.sourcePath : null,
    attachmentCount: typeof meta.attachmentCount === "number" ? meta.attachmentCount : null,
    effectiveSkillsCsv: typeof meta.effectiveSkillsCsv === "string" ? meta.effectiveSkillsCsv : null,
    editOutcome: typeof meta.editOutcome === "string" ? meta.editOutcome : null,
    editTargetPath: typeof meta.editTargetPath === "string" ? meta.editTargetPath : null,
    editReviewReason: typeof meta.editReviewReason === "string" ? meta.editReviewReason : null,
  });
}

function buildEditStatusLine(
  context: WorkspaceRenderContext,
  meta: ChatMessage["meta"] | null | undefined,
): string | null {
  const outcome = typeof meta?.editOutcome === "string" ? (meta.editOutcome as EditOutcome) : null;
  const reviewReason = typeof meta?.editReviewReason === "string" ? meta.editReviewReason : null;
  if (!outcome) {
    return null;
  }
  const targetPath = typeof meta?.editTargetPath === "string" ? meta.editTargetPath.trim() : "";
  const targetName = targetPath ? basename(targetPath) : null;
  switch (outcome) {
    case "applied":
      return context.copy.workspace.editAppliedStatus(targetName);
    case "review_required":
      if (reviewReason === "readability_risk") {
        return context.copy.workspace.editReadabilityReviewStatus(targetName);
      }
      if (reviewReason === "auto_healed") {
        return context.copy.workspace.editAutoHealedReviewStatus(targetName);
      }
      return context.copy.workspace.editReviewRequiredStatus(targetName);
    case "proposal_only":
      return context.copy.workspace.editProposalStatus(targetName);
    case "explanation_only":
      return context.copy.workspace.editExplanationOnlyStatus;
    case "failed":
      return context.copy.workspace.editFailedStatus(targetName);
    default:
      return null;
  }
}

function createChatSuggestionSignature(suggestion: WorkspaceState["tabs"][number]["chatSuggestion"] | null): string {
  if (!suggestion) {
    return "";
  }
  return JSON.stringify({
    id: suggestion.id,
    kind: suggestion.kind,
    status: suggestion.status,
    messageId: suggestion.messageId,
    panelId: suggestion.panelId,
    panelTitle: suggestion.panelTitle,
    promptSnapshot: suggestion.promptSnapshot,
    matchedSkillName: suggestion.matchedSkillName,
    canUpdatePanel: suggestion.canUpdatePanel,
    canSaveCopy: suggestion.canSaveCopy,
    planSummary: suggestion.planSummary,
    planStatus: suggestion.planStatus,
    rewriteSummary: suggestion.rewriteSummary ?? null,
    rewriteQuestion: suggestion.rewriteQuestion ?? null,
    createdAt: suggestion.createdAt,
  });
}
