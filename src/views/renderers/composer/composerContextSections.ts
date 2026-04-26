import { Notice, setIcon } from "obsidian";
import { basename } from "node:path";
import type { PatchQualityIssue, PatchSafetyIssue } from "../../../model/types";
import type { LocalizedCopy } from "../../../util/i18n";
import { PatchConflictError } from "../../../util/patchConflicts";
import { shouldBlockExplicitPatchApply } from "../../../util/patchSafety";
import { openPatchConflictModal } from "../../patchConflictUi";
import type { ComposerContextSectionDeps, ComposerSectionRenderState } from "./types";

const MAX_VISIBLE_QUALITY_ISSUE_ROWS = 2;
const MAX_VISIBLE_SAFETY_ISSUE_ROWS = 4;
const MAX_ISSUE_LINE_LABELS = 3;

export class ComposerContextSections {
  constructor(private readonly deps: ComposerContextSectionDeps) {}

  render(displayState: ComposerSectionRenderState): void {
    this.renderReferenceDoc();
    this.renderSelectionPreview();
    this.renderAttachments();
    this.renderPatchBasket();
    this.renderPlanMode(displayState.planModeActive);
    this.renderWorkflowBrief(displayState);
    this.hideLegacyInstructionRow();
  }

  private get context() {
    return this.deps.state.context;
  }

  private renderReferenceDoc(): void {
    const context = this.context;
    const { contextRowEl, referenceDocEl } = this.deps.elements;
    referenceDocEl.empty();
    if (!context?.activeTab?.id) {
      contextRowEl.classList.remove("has-content");
      referenceDocEl.classList.add("is-empty");
      referenceDocEl.onclick = null;
      referenceDocEl.onkeydown = null;
      referenceDocEl.tabIndex = -1;
      referenceDocEl.title = "";
      return;
    }

    const targetPath = context.service.getTabTargetNotePath(context.activeTab.id);
    if (!targetPath) {
      contextRowEl.classList.remove("has-content");
      referenceDocEl.classList.add("is-empty");
      referenceDocEl.onclick = null;
      referenceDocEl.onkeydown = null;
      referenceDocEl.tabIndex = -1;
      referenceDocEl.title = "";
      return;
    }

    contextRowEl.classList.add("has-content");
    referenceDocEl.classList.remove("is-empty");
    referenceDocEl.title = targetPath;
    referenceDocEl.onclick = () => {
      void this.deps.callbacks.openTargetNote();
    };
    referenceDocEl.tabIndex = 0;
    referenceDocEl.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void this.deps.callbacks.openTargetNote();
      }
    };

    const iconEl = referenceDocEl.createDiv({ cls: "obsidian-codex__reference-doc-icon" });
    setIcon(iconEl, "file-text");
    const bodyEl = referenceDocEl.createDiv({ cls: "obsidian-codex__reference-doc-body" });
    bodyEl.createSpan({ cls: "obsidian-codex__reference-doc-label", text: context.copy.workspace.referenceNote });
    bodyEl.createSpan({ cls: "obsidian-codex__reference-doc-value", text: basename(targetPath) });

    const removeButton = referenceDocEl.createEl("button", {
      cls: "obsidian-codex__reference-doc-remove",
      attr: {
        type: "button",
        "aria-label": context.copy.workspace.removeReferenceNote,
      },
    });
    setIcon(removeButton, "x");
    removeButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      context.service.setTabTargetNote(context.activeTab!.id, null);
    });
  }

  private hideLegacyInstructionRow(): void {
    const { instructionRowEl } = this.deps.elements;
    instructionRowEl.empty();
    instructionRowEl.classList.remove("is-visible");
  }

  private renderSelectionPreview(): void {
    const context = this.context;
    const { selectionPreviewEl } = this.deps.elements;
    selectionPreviewEl.empty();
    if (!context?.activeTab?.id) {
      selectionPreviewEl.classList.remove("is-visible");
      return;
    }

    const selectionContext = context.service.getTabSelectionContext(context.activeTab.id);
    if (!selectionContext) {
      selectionPreviewEl.classList.remove("is-visible");
      return;
    }

    selectionPreviewEl.classList.add("is-visible");
    const headerEl = selectionPreviewEl.createDiv({ cls: "obsidian-codex__selection-preview-header" });
    headerEl.createSpan({ cls: "obsidian-codex__selection-preview-label", text: context.copy.workspace.selection });
    headerEl.createSpan({
      cls: "obsidian-codex__selection-preview-source",
      text: selectionContext.sourcePath ? basename(selectionContext.sourcePath) : context.copy.workspace.currentNote,
    });
    const removeButton = headerEl.createEl("button", {
      cls: "obsidian-codex__selection-preview-remove",
      attr: { type: "button", "aria-label": context.copy.workspace.removeSelectedText },
    });
    setIcon(removeButton, "x");
    removeButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      context.service.setTabSelectionContext(context.activeTab!.id, null);
    });

    selectionPreviewEl.createDiv({
      cls: "obsidian-codex__selection-preview-copy",
      text: selectionContext.text,
    });
  }

  private renderAttachments(): void {
    const context = this.context;
    const { attachmentsRowEl } = this.deps.elements;
    attachmentsRowEl.empty();
    if (!context?.activeTab?.id) {
      attachmentsRowEl.classList.remove("is-visible");
      return;
    }
    const attachments = context.service.getTabAttachments(context.activeTab.id);
    if (attachments.length === 0) {
      attachmentsRowEl.classList.remove("is-visible");
      return;
    }

    attachmentsRowEl.classList.add("is-visible");
    for (const attachment of attachments) {
      const chipEl = attachmentsRowEl.createDiv({ cls: "obsidian-codex__attachment-chip" });
      const iconEl = chipEl.createSpan({ cls: "obsidian-codex__attachment-chip-icon" });
      setIcon(iconEl, attachment.kind === "image" ? "image" : "file-text");
      chipEl.createSpan({ cls: "obsidian-codex__attachment-chip-label", text: attachment.displayName });
      const removeButton = chipEl.createEl("button", {
        cls: "obsidian-codex__attachment-chip-remove",
        attr: { type: "button", "aria-label": context.copy.workspace.removeAttachment(attachment.displayName) },
      });
      setIcon(removeButton, "x");
      removeButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void context.service.removeComposerAttachment(context.activeTab!.id, attachment.id);
      });
    }
  }

  private renderPatchBasket(): void {
    const context = this.context;
    const { changesTrayEl } = this.deps.elements;
    changesTrayEl.empty();
    if (!context?.activeTab?.id) {
      changesTrayEl.classList.remove("is-visible");
      return;
    }
    const proposals = context.service
      .getTabPatchBasket(context.activeTab.id)
      .filter(
        (proposal) =>
          proposal.status === "pending" ||
          proposal.status === "conflicted" ||
          proposal.status === "stale" ||
          proposal.status === "blocked",
      );
    if (proposals.length === 0) {
      changesTrayEl.classList.remove("is-visible");
      return;
    }

    const currentNotePath = context.activeTab.targetNotePath ?? null;
    const currentNotePreview = Boolean(currentNotePath && proposals.length === 1 && proposals[0]?.targetPath === currentNotePath);
    changesTrayEl.classList.add("is-visible");
    changesTrayEl.classList.toggle("is-current-note-preview", currentNotePreview);
    const headingEl = changesTrayEl.createDiv({ cls: "obsidian-codex__changes-tray-header" });
    headingEl.createSpan({
      cls: "obsidian-codex__changes-tray-title",
      text: currentNotePreview ? context.copy.workspace.currentNote : context.copy.workspace.changes,
    });
    headingEl.createSpan({ cls: "obsidian-codex__changes-tray-count", text: String(proposals.length) });

    for (const proposal of proposals) {
      const visibleEvidence = proposal.evidence?.slice(0, 3) ?? [];
      const qualityIssueRows = summarizeQualityIssues(context.copy, proposal.qualityIssues ?? []);
      const safetyIssueRows = summarizeSafetyIssues(context.copy, proposal.safetyIssues ?? []);
      const rawIssueCount = (proposal.qualityIssues?.length ?? 0) + (proposal.safetyIssues?.length ?? 0);
      const cardEl = changesTrayEl.createDiv({
        cls: [
          "obsidian-codex__change-card",
          currentNotePreview ? "is-current-note" : "",
          rawIssueCount > 0 ? "has-issues" : "",
          rawIssueCount > MAX_VISIBLE_QUALITY_ISSUE_ROWS ? "has-many-issues" : "",
        ].filter(Boolean).join(" "),
      });
      const headEl = cardEl.createDiv({ cls: "obsidian-codex__change-card-head" });
      headEl.createSpan({
        cls: "obsidian-codex__change-card-path",
        text: currentNotePreview ? context.copy.workspace.currentNote : basename(proposal.targetPath),
      });
      if (visibleEvidence.some((entry) => entry.kind === "web")) {
        headEl.createSpan({ cls: "obsidian-codex__change-card-badge", text: context.copy.workspace.webBackedPatch });
      }
      headEl.createSpan({ cls: `obsidian-codex__change-card-status is-${proposal.status}`, text: proposal.status });
      const summaryEl = cardEl.createDiv({ cls: "obsidian-codex__change-card-summary" });
      summaryEl.createSpan({ text: proposal.summary });
      for (const index of visibleEvidence.keys()) {
        summaryEl.createSpan({
          cls: "obsidian-codex__change-card-evidence-ref",
          text: `[${index + 1}]`,
        });
      }
      if (visibleEvidence.length > 0) {
        const evidenceEl = cardEl.createDiv({ cls: "obsidian-codex__change-card-evidence" });
        visibleEvidence.forEach((evidence, index) => {
          const itemEl = evidenceEl.createDiv({ cls: "obsidian-codex__change-card-evidence-item" });
          itemEl.createSpan({
            cls: "obsidian-codex__change-card-evidence-index",
            text: `[${index + 1}]`,
          });
          const parts = [evidence.label];
          if (evidence.snippet) {
            parts.push(`"${evidence.snippet}"`);
          } else if (evidence.sourceRef) {
            parts.push(evidence.sourceRef);
          }
          itemEl.createSpan({
            cls: "obsidian-codex__change-card-evidence-text",
            text: parts.join(": "),
          });
        });
      }
      if (proposal.qualityState === "review_required" || proposal.qualityState === "auto_healed") {
        cardEl.createDiv({
          cls: `obsidian-codex__change-card-warning is-${proposal.qualityState}`,
          text:
            proposal.qualityState === "review_required"
              ? context.copy.workspace.patchReadabilityReview
              : context.copy.workspace.patchReadabilityAutoHealed,
        });
      }
      if (qualityIssueRows.length > 0) {
        const issuesEl = cardEl.createDiv({ cls: "obsidian-codex__change-card-issues" });
        for (const issue of qualityIssueRows) {
          issuesEl.createDiv({
            cls: "obsidian-codex__change-card-issue",
            text: issue.text,
            attr: issue.title ? { title: issue.title } : undefined,
          });
        }
      }
      if (proposal.status === "blocked" || (proposal.safetyIssues?.length ?? 0) > 0) {
        cardEl.createDiv({
          cls: `obsidian-codex__change-card-warning is-${proposal.status === "blocked" ? "blocked" : "safety"}`,
          text:
            proposal.status === "blocked"
              ? context.copy.workspace.patchSafetyBlocked
              : context.copy.workspace.patchSafetyReview,
        });
      }
      if (safetyIssueRows.length > 0) {
        const safetyIssuesEl = cardEl.createDiv({ cls: "obsidian-codex__change-card-issues" });
        for (const issue of safetyIssueRows) {
          safetyIssuesEl.createDiv({
            cls: "obsidian-codex__change-card-issue",
            text: issue.text,
            attr: issue.title ? { title: issue.title } : undefined,
          });
        }
      }
      cardEl.createEl("pre", {
        cls: "obsidian-codex__change-card-diff",
        text: summarizePreviewText(proposal.unifiedDiff, 8, 520),
      });

      const actionsEl = cardEl.createDiv({ cls: "obsidian-codex__change-card-actions" });
      const patchActionInFlight = this.deps.state.applyingPatchIds.has(proposal.id);
      const openButton = actionsEl.createEl("button", {
        cls: "obsidian-codex__change-card-btn is-muted",
        text: context.copy.workspace.open,
      });
      openButton.type = "button";
      openButton.addEventListener("click", () => {
        void context.service.openPatchTarget(context.activeTab!.id, proposal.id).catch((error: unknown) => {
          new Notice((error as Error).message);
        });
      });

      const rejectButton = actionsEl.createEl("button", {
        cls: "obsidian-codex__change-card-btn is-muted",
        text: context.copy.workspace.reject,
      });
      rejectButton.type = "button";
      rejectButton.disabled = patchActionInFlight;
      rejectButton.addEventListener("click", () => {
        if (this.deps.state.applyingPatchIds.has(proposal.id)) {
          return;
        }
        context.service.rejectPatchProposal(context.activeTab!.id, proposal.id);
        this.deps.callbacks.requestRender();
      });

      const applyButton = actionsEl.createEl("button", {
        cls: "obsidian-codex__change-card-btn",
        text: proposal.status === "conflicted" || proposal.status === "stale" ? context.copy.workspace.retry : context.copy.workspace.apply,
      });
      applyButton.type = "button";
      const explicitApplyBlocked = shouldBlockExplicitPatchApply(proposal);
      applyButton.disabled = patchActionInFlight || explicitApplyBlocked;
      if (explicitApplyBlocked) {
        applyButton.title = context.copy.workspace.patchSafetyBlocked;
      }
      applyButton.addEventListener("click", () => {
        if (this.deps.state.applyingPatchIds.has(proposal.id) || explicitApplyBlocked) {
          return;
        }
        this.deps.state.applyingPatchIds.add(proposal.id);
        applyButton.disabled = true;
        this.deps.callbacks.requestRender();
        void context.service.applyPatchProposal(context.activeTab!.id, proposal.id).catch((error: unknown) => {
          if (error instanceof PatchConflictError) {
            openPatchConflictModal(context.app, context.service, context.copy.workspace, error);
            return;
          }
          new Notice((error as Error).message);
        }).finally(() => {
          this.deps.state.applyingPatchIds.delete(proposal.id);
          this.deps.callbacks.requestRender();
        });
      });
    }
  }

  private renderPlanMode(planModeActive: boolean): void {
    const { root, composerFlagsEl, planModeTextEl } = this.deps.elements;
    root.classList.toggle("is-plan-mode", planModeActive);
    composerFlagsEl.classList.toggle("is-visible", planModeActive);
    planModeTextEl.classList.toggle("is-visible", planModeActive);
  }

  private renderWorkflowBrief(displayState: ComposerSectionRenderState): void {
    const context = this.context;
    const { workflowBriefEl } = this.deps.elements;
    if (
      this.deps.state.statusMenuAnchorEl &&
      (workflowBriefEl.contains(this.deps.state.statusMenuAnchorEl) ||
        (this.deps.state.statusMenuEl ? workflowBriefEl.contains(this.deps.state.statusMenuEl) : false))
    ) {
      this.deps.closeStatusMenu();
    }
    workflowBriefEl.empty();
    if (!context?.activeTab) {
      workflowBriefEl.classList.remove("is-visible");
      delete workflowBriefEl.dataset.workflow;
      return;
    }

    const showPanelRow = Boolean(displayState.panelLabel) || displayState.activeSkillLabels.length > 0;
    if (!showPanelRow) {
      workflowBriefEl.classList.remove("is-visible");
      delete workflowBriefEl.dataset.workflow;
      return;
    }

    workflowBriefEl.classList.add("is-visible");
    workflowBriefEl.dataset.workflow = context.activeTab.studyWorkflow ?? "";
    if (showPanelRow) {
      const headerEl = workflowBriefEl.createDiv({ cls: "obsidian-codex__workflow-brief-header" });
      if (displayState.panelLabel) {
        const panelEl = headerEl.createDiv({ cls: "obsidian-codex__workflow-brief-panel" });
        panelEl.createSpan({ cls: "obsidian-codex__workflow-brief-badge", text: displayState.panelLabel });
        if (displayState.canClearPanelContext) {
          const clearButton = panelEl.createEl("button", {
            cls: "obsidian-codex__workflow-brief-panel-remove",
            attr: {
              type: "button",
              "aria-label": context.copy.workspace.clearPanelContext(displayState.panelLabel),
            },
          });
          setIcon(clearButton, "x");
          clearButton.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            context.service.clearActivePanelContext(context.activeTab!.id);
          });
        }
      }
      for (const skillLabel of displayState.activeSkillLabels) {
        headerEl.createSpan({ cls: "obsidian-codex__workflow-brief-skill", text: skillLabel });
      }
    }
  }
}

interface CompactIssueRow {
  text: string;
  title: string;
}

interface QualityIssueGroup {
  code: PatchQualityIssue["code"];
  detail: string | null;
  issues: PatchQualityIssue[];
}

function summarizeQualityIssues(copy: LocalizedCopy, issues: readonly PatchQualityIssue[]): CompactIssueRow[] {
  const grouped = new Map<string, QualityIssueGroup>();
  for (const issue of issues) {
    const detail = issue.detail?.trim() || null;
    const key = `${issue.code}:${detail ?? ""}`;
    const group = grouped.get(key) ?? {
      code: issue.code,
      detail,
      issues: [],
    };
    group.issues.push(issue);
    grouped.set(key, group);
  }
  const rows = [...grouped.values()].map((group) => {
    const lineLabel = formatIssueLineLabel(group.issues.flatMap((issue) => issue.line ?? []));
    return {
      text: `${lineLabel}: ${copy.workspace.patchQualityIssueGroup(group.code, group.detail)}`,
      title: group.issues
        .map((issue) => copy.workspace.patchQualityIssue(issue.code, issue.line, issue.detail ?? null))
        .join("\n"),
    };
  });
  return limitIssueRows(rows, MAX_VISIBLE_QUALITY_ISSUE_ROWS);
}

function summarizeSafetyIssues(copy: LocalizedCopy, issues: readonly PatchSafetyIssue[]): CompactIssueRow[] {
  const rows = issues.map((issue) => ({
    text: copy.workspace.patchSafetyIssue(issue.code, issue.detail ?? null, issue.deletedPercent ?? null),
    title: copy.workspace.patchSafetyIssue(issue.code, issue.detail ?? null, issue.deletedPercent ?? null),
  }));
  return limitIssueRows(rows, MAX_VISIBLE_SAFETY_ISSUE_ROWS);
}

function limitIssueRows(rows: CompactIssueRow[], maxVisibleRows: number): CompactIssueRow[] {
  if (rows.length <= maxVisibleRows) {
    return rows;
  }
  const visibleRows = rows.slice(0, Math.max(1, maxVisibleRows - 1));
  return [
    ...visibleRows,
    {
      text: `+${rows.length - visibleRows.length} more issues`,
      title: rows.slice(visibleRows.length).map((row) => row.title || row.text).join("\n"),
    },
  ];
}

function formatIssueLineLabel(lines: readonly number[]): string {
  const uniqueLines = [...new Set(lines.filter((line) => Number.isFinite(line)))].sort((left, right) => left - right);
  if (uniqueLines.length === 0) {
    return "Issue";
  }
  const visibleLines = uniqueLines.slice(0, MAX_ISSUE_LINE_LABELS).join(", ");
  const overflow = uniqueLines.length - MAX_ISSUE_LINE_LABELS;
  return uniqueLines.length === 1
    ? `Line ${visibleLines}`
    : `Lines ${visibleLines}${overflow > 0 ? ` +${overflow}` : ""}`;
}

function summarizePreviewText(text: string, lines: number, maxLength: number): string {
  const compact = text.replace(/\r\n/g, "\n").trim();
  if (!compact) {
    return "";
  }
  const limitedLines = compact.split("\n").slice(0, lines).join("\n");
  return limitedLines.length > maxLength ? `${limitedLines.slice(0, maxLength - 1)}…` : limitedLines;
}
