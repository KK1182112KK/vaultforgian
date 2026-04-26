import { promises as fs } from "node:fs";
import { basename, dirname, extname } from "node:path";
import type { App, TFile } from "obsidian";
import { AgentStore } from "../model/store";
import type {
  PendingApproval,
  SkillImprovementProposal,
  ToolActivityKind,
  ToolActivityStatus,
  ToolCallRecord,
  VaultOpProposal,
} from "../model/types";
import type { ConversationTabState } from "../model/types";
import type { LocalizedCopy } from "../util/i18n";
import { makeId } from "../util/id";
import type { ParsedAssistantOp } from "../util/assistantProposals";
import { applyAnchorReplacements, normalizeForComparison } from "../util/patchApply";
import { hashPatchContent, PatchConflictError, type PatchConflictReason } from "../util/patchConflicts";
import type { InstalledSkillDefinition } from "../util/skillCatalog";
import {
  assessPatchReadability,
  PatchReadabilityError,
} from "../util/patchReadability";
import { buildUnifiedDiff } from "../util/unifiedDiff";
import { validateManagedFolderPath, validateManagedNotePath } from "../util/vaultPathPolicy";

export type ToolDecision = "approve" | "approve_session" | "deny" | "abort";
export type ApprovalResult = "applied" | "denied" | "aborted" | "failed" | "ignored";
type AbortReason = "user_interrupt" | "approval_abort" | "tab_close" | "plugin_unload" | "runtime_abort";
export type PatchOverwriteResult = "applied" | "changed";

interface VaultTaskMatchResult {
  lineIndex: number;
  lineText: string;
}

export interface ApprovalCoordinatorDeps {
  app: App;
  store: AgentStore;
  findTab: (tabId: string) => ConversationTabState | null;
  getLocalizedCopy: () => LocalizedCopy;
  getUserOwnedInstalledSkills: () => readonly InstalledSkillDefinition[];
  abortTabRun: (tabId: string, addMessage: boolean, reason?: AbortReason) => boolean;
  hasCodexLogin: () => boolean;
  getMissingLoginMessage: () => string;
  isTabRunning: (tabId: string) => boolean;
  onApprovedEditApplied?: (event: {
    tabId: string;
    targetPath: string;
    sourceMessageId: string | null;
    originTurnId: string | null;
    summary: string;
    kind: "patch" | "vault_op";
  }) => Promise<void> | void;
}

function getErrorMessage(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && value !== null && "message" in value && typeof (value as { message?: unknown }).message === "string") {
    return (value as { message: string }).message;
  }
  return "Unknown Codex error.";
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "{}";
  }
}

function asFileLike(value: unknown): TFile | null {
  return value && typeof value === "object" && "path" in value ? (value as TFile) : null;
}

function normalizeSkillPath(path: string): string {
  return path.replace(/\\/g, "/").trim();
}

function buildActivityRecord(
  current: ToolCallRecord | null,
  callId: string,
  kind: ToolActivityKind,
  name: string,
  title: string,
  summary: string,
  argsJson: string,
  status: ToolActivityStatus,
  resultText?: string,
): ToolCallRecord {
  return {
    id: current?.id ?? makeId("activity"),
    callId,
    kind,
    name,
    title,
    summary,
    argsJson,
    createdAt: current?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    status,
    resultText: resultText ?? current?.resultText,
  };
}

function buildApprovalId(messageId: string, sourceIndex: number, index: number): string {
  return `approval-${messageId}-${sourceIndex}-${index}`;
}

function buildApprovalTitle(op: VaultOpProposal): string {
  if (op.kind === "rename") {
    return "Rename note";
  }
  if (op.kind === "move") {
    return "Move note";
  }
  if (op.kind === "property_set") {
    return "Set note property";
  }
  if (op.kind === "property_remove") {
    return "Remove note property";
  }
  return "Update task";
}

function buildApprovalDescription(op: VaultOpProposal): string {
  if ((op.kind === "rename" || op.kind === "move") && op.destinationPath) {
    return `${op.targetPath} -> ${op.destinationPath}`;
  }
  if (op.kind === "property_set") {
    return `${op.targetPath} · ${op.propertyKey ?? "property"} = ${op.propertyValue ?? ""}`.trim();
  }
  if (op.kind === "property_remove") {
    return `${op.targetPath} · remove ${op.propertyKey ?? "property"}`;
  }
  if (op.kind === "task_update") {
    const statusLabel = op.checked === true ? "checked" : op.checked === false ? "unchecked" : "updated";
    return `${op.targetPath} · task ${statusLabel}`;
  }
  return op.targetPath;
}

function normalizeProposalText(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function getPathStem(path: string): string {
  const fileName = basename(path);
  const extension = extname(fileName);
  return extension ? fileName.slice(0, -extension.length) : fileName;
}

function buildPatchActionKey(tabId: string, patchId: string): string {
  return `${tabId}:${patchId}`;
}

function isVaultOpProposal(payload: PendingApproval["toolPayload"]): payload is VaultOpProposal {
  return Boolean(
    payload &&
      typeof payload === "object" &&
      "kind" in payload &&
      typeof (payload as { kind?: unknown }).kind === "string" &&
      "targetPath" in payload,
  );
}

function isSkillImprovementProposal(payload: PendingApproval["toolPayload"]): payload is SkillImprovementProposal {
  return Boolean(
    payload &&
      typeof payload === "object" &&
      "skillPath" in payload &&
      "nextContent" in payload &&
      typeof (payload as { skillPath?: unknown }).skillPath === "string",
  );
}

export class ApprovalCoordinator {
  private readonly approvalTabsInFlight = new Set<string>();
  private readonly approvalIdsInFlight = new Set<string>();
  private readonly approvalBatchTabsInFlight = new Set<string>();
  private readonly patchApplyActionsInFlight = new Set<string>();

  constructor(private readonly deps: ApprovalCoordinatorDeps) {}

  private getUnsafeNotePathMessage(path: string): string {
    return this.deps.getLocalizedCopy().service.unsafeNotePathBlocked(path);
  }

  private getUnsafeVaultOpMessage(path: string): string {
    return this.deps.getLocalizedCopy().service.unsafeVaultOpBlocked(path);
  }

  private assertManagedNotePath(path: string, messageFactory: (path: string) => string): string {
    const result = validateManagedNotePath(this.deps.app, path);
    if (!result.ok) {
      throw new Error(messageFactory(path));
    }
    return result.normalizedPath;
  }

  private assertManagedFolderPath(path: string): string {
    const result = validateManagedFolderPath(this.deps.app, path);
    if (!result.ok) {
      throw new Error(this.getUnsafeVaultOpMessage(path));
    }
    return result.normalizedPath;
  }

  private requireUserOwnedInstalledSkillDefinition(skillName: string, skillPath: string): InstalledSkillDefinition {
    const normalizedSkillName = skillName.trim();
    const normalizedSkillPath = normalizeSkillPath(skillPath);
    const installedSkill =
      this.deps
        .getUserOwnedInstalledSkills()
        .find((definition) => definition.name === normalizedSkillName && normalizeSkillPath(definition.path) === normalizedSkillPath) ??
      null;
    if (!installedSkill) {
      throw new Error(`Skill update blocked for ${normalizedSkillName}: ${normalizedSkillPath}`);
    }
    return installedSkill;
  }

  private reportBlockedVaultOp(tabId: string, path: string): void {
    this.deps.store.addMessage(tabId, {
      id: makeId("unsafe-vault-op"),
      kind: "system",
      text: this.getUnsafeVaultOpMessage(path),
      createdAt: Date.now(),
    });
  }

  private ensureReadablePatchBeforeWrite(
    tabId: string,
    patchId: string,
    proposal: ConversationTabState["patchBasket"][number],
    nextText: string,
  ): string {
    const normalizedText = normalizeProposalText(nextText);
    const readability = assessPatchReadability(normalizedText);
    this.deps.store.updatePatchProposal(tabId, patchId, (current) => ({
      ...current,
      proposedText: readability.text,
      unifiedDiff: buildUnifiedDiff(current.targetPath, current.baseSnapshot, readability.text),
      qualityState: readability.qualityState,
      qualityIssues: readability.qualityIssues.map((issue) => ({ ...issue })),
      healedByPlugin: readability.healedByPlugin,
    }));
    if (readability.qualityState === "review_required") {
      const message = this.deps.getLocalizedCopy().service.patchNeedsReview(proposal.targetPath);
      this.deps.store.addMessage(tabId, {
        id: makeId("patch-readability-review-needed"),
        kind: "system",
        text: message,
        createdAt: Date.now(),
      });
      throw new PatchReadabilityError(message, proposal.targetPath);
    }
    return readability.text;
  }

  async buildVaultOpApprovals(
    tabId: string,
    messageId: string,
    ops: readonly ParsedAssistantOp[],
    _allowSessionAutoApproval = true,
    originTurnId: string | null = null,
  ): Promise<PendingApproval[]> {
    const tab = this.deps.findTab(tabId);
    if (!tab) {
      return [];
    }

    const approvals: PendingApproval[] = [];
    for (const [index, op] of ops.entries()) {
      const payload = await this.buildVaultOpPayload(op);
      if (!payload) {
        this.reportBlockedVaultOp(tabId, op.destinationPath?.trim() || op.targetPath.trim());
        continue;
      }

      const approval: PendingApproval = {
        id: buildApprovalId(messageId, op.sourceIndex, index),
        tabId,
        callId: `vault-op-${messageId}-${op.sourceIndex}-${index}`,
        toolName: "vault_op",
        title: buildApprovalTitle(payload),
        description: buildApprovalDescription(payload),
        details: payload.preflightSummary ?? op.summary,
        createdAt: Date.now(),
        sourceMessageId: messageId,
        originTurnId,
        transport: "plugin_proposal",
        decisionTarget: payload.targetPath,
        scopeEligible: false,
        scope: "write",
        toolPayload: payload,
      };

      approvals.push(approval);
    }
    return approvals;
  }

  async respondToApproval(approvalId: string, decision: ToolDecision): Promise<ApprovalResult> {
    const state = this.deps.store.getState();
    const tab = state.tabs.find((entry) => entry.pendingApprovals.some((approval) => approval.id === approvalId)) ?? null;
    if (!tab) {
      return "ignored";
    }
    const approval = tab.pendingApprovals.find((entry) => entry.id === approvalId) ?? null;
    if (!approval) {
      return "ignored";
    }

    if (this.approvalBatchTabsInFlight.has(tab.id) || this.approvalIdsInFlight.has(approvalId) || this.approvalTabsInFlight.has(tab.id)) {
      return "ignored";
    }

    this.approvalIdsInFlight.add(approvalId);
    this.approvalTabsInFlight.add(tab.id);
    try {
      return await this.executeApprovalDecision(tab.id, approval, decision);
    } finally {
      this.approvalTabsInFlight.delete(tab.id);
      this.approvalIdsInFlight.delete(approvalId);
    }
  }

  private async executeApprovalDecision(tabId: string, approval: PendingApproval, decision: ToolDecision): Promise<ApprovalResult> {
    const approvalId = approval.id;
    if (decision === "abort") {
      const copy = this.deps.getLocalizedCopy();
      this.deps.abortTabRun(tabId, false, "approval_abort");
      this.deps.store.removeApproval(approvalId);
      this.deps.store.addMessage(tabId, {
        id: makeId("approval-abort"),
        kind: "system",
        text: copy.service.approvalAborted(approval.title),
        createdAt: Date.now(),
      });
      this.reconcileApprovalStatus(tabId);
      return "aborted";
    }

    if (decision === "deny") {
      const copy = this.deps.getLocalizedCopy();
      this.deps.store.removeApproval(approvalId);
      this.deps.store.addMessage(tabId, {
        id: makeId("approval-deny"),
        kind: "system",
        text: copy.service.approvalDenied(approval.title),
        createdAt: Date.now(),
      });
      this.reconcileApprovalStatus(tabId);
      return "denied";
    }

    if (approval.transport === "plugin_proposal" && approval.toolPayload) {
      this.deps.store.setStatus(tabId, "waiting_approval");
      try {
        if (approval.toolName === "vault_op" && isVaultOpProposal(approval.toolPayload)) {
          await this.executeVaultOpApproval(tabId, approval);
        } else if (approval.toolName === "skill_update" && isSkillImprovementProposal(approval.toolPayload)) {
          await this.executeSkillUpdateApproval(tabId, approval);
        } else {
          throw new Error("Unsupported approval payload.");
        }
        this.deps.store.removeApproval(approvalId);
        this.deps.store.addMessage(tabId, {
          id: makeId("approval-ok"),
          kind: "system",
          text: this.deps.getLocalizedCopy().service.approvalApplied(approval.title),
          createdAt: Date.now(),
        });
        this.reconcileApprovalStatus(tabId);
        return "applied";
      } catch (error) {
        const message = getErrorMessage(error);
        this.deps.store.upsertToolLog(tabId, `approval-${approval.id}`, (current) =>
          buildActivityRecord(
            current,
            `approval-${approval.id}`,
            approval.toolName === "vault_op" || approval.toolName === "skill_update" ? "file" : "tool",
            approval.toolName,
            approval.title,
            approval.description,
            safeJson(approval.toolPayload),
            "failed",
            message,
          ),
        );
        this.deps.store.addMessage(tabId, {
          id: makeId("approval-error"),
          kind: "system",
          text: `${approval.title} failed: ${message}`,
          createdAt: Date.now(),
        });
        this.deps.store.removeApproval(approvalId);
        this.reconcileApprovalStatus(tabId);
        return "failed";
      }
    }

    this.deps.store.removeApproval(approvalId);
    this.reconcileApprovalStatus(tabId);
    return "ignored";
  }

  async respondToAllApprovals(tabId: string, decision: "approve" | "approve_session" | "deny"): Promise<void> {
    const tab = this.deps.findTab(tabId);
    if (!tab) {
      return;
    }
    if (this.approvalBatchTabsInFlight.has(tabId) || this.approvalTabsInFlight.has(tabId)) {
      return;
    }
    const approvals = tab.pendingApprovals.filter(
      (approval) => approval.toolName === "vault_op" || approval.toolName === "skill_update",
    );
    if (approvals.length === 0) {
      return;
    }

    this.approvalBatchTabsInFlight.add(tabId);
    this.approvalTabsInFlight.add(tabId);
    try {
      let applied = 0;
      let denied = 0;
      let failed = 0;
      const effectiveDecision = decision === "approve_session" ? "approve" : decision;
      this.deps.store.setStatus(tabId, "waiting_approval");
      for (const approval of approvals) {
        const currentApproval = this.deps.findTab(tabId)?.pendingApprovals.find((entry) => entry.id === approval.id) ?? null;
        if (!currentApproval) {
          continue;
        }
        const result = await this.executeApprovalDecision(tabId, currentApproval, effectiveDecision);
        if (result === "applied") {
          applied += 1;
        } else if (result === "denied") {
          denied += 1;
        } else if (result === "failed") {
          failed += 1;
        }
      }

      this.deps.store.addMessage(tabId, {
        id: makeId("approval-batch"),
        kind: "system",
        text: this.deps.getLocalizedCopy().service.batchApprovalFinished(applied, denied, failed),
        createdAt: Date.now(),
      });
      this.reconcileApprovalStatus(tabId);
    } finally {
      this.approvalTabsInFlight.delete(tabId);
      this.approvalBatchTabsInFlight.delete(tabId);
    }
  }

  async applyPatchProposal(tabId: string, patchId: string): Promise<void> {
    const patchActionKey = buildPatchActionKey(tabId, patchId);
    if (this.patchApplyActionsInFlight.has(patchActionKey)) {
      return;
    }
    const tab = this.deps.findTab(tabId);
    const proposal = tab?.patchBasket.find((entry) => entry.id === patchId) ?? null;
    if (!tab || !proposal) {
      return;
    }
    if (proposal.status === "blocked") {
      throw new Error(this.deps.getLocalizedCopy().workspace.patchSafetyBlocked);
    }
    this.patchApplyActionsInFlight.add(patchActionKey);
    try {
      const targetPath = this.assertManagedNotePath(proposal.targetPath, (path) => this.getUnsafeNotePathMessage(path));
      const abstractFile = asFileLike(this.deps.app.vault.getAbstractFileByPath(targetPath));
      const file = abstractFile;
      const currentContent = file ? await this.deps.app.vault.cachedRead(file) : null;
      let textToWrite = proposal.proposedText;

      if (proposal.kind === "create") {
        if (file && currentContent !== proposal.proposedText) {
          this.markPatchConflict(tabId, patchId);
          throw this.buildPatchConflictError(tabId, proposal, "target_exists", currentContent, currentContent);
        }
        textToWrite = this.ensureReadablePatchBeforeWrite(tabId, patchId, proposal, proposal.proposedText);
        if (!file) {
          await this.ensureParentFolder(targetPath);
          await this.deps.app.vault.create(targetPath, textToWrite);
        }
      } else {
        if (!file) {
          this.deps.store.updatePatchProposal(tabId, patchId, (current) => ({ ...current, status: "stale" }));
          throw new Error(`${targetPath} no longer exists.`);
        }
        const normalizedCurrent = normalizeForComparison(currentContent);
        const normalizedBase = normalizeForComparison(proposal.baseSnapshot);
        if (normalizedCurrent !== normalizedBase) {
          if (proposal.anchors && proposal.anchors.length > 0 && currentContent !== null) {
            const rebased = applyAnchorReplacements(currentContent, proposal.anchors);
            if (rebased.ok) {
              console.info("[obsidian-codex-study] rebased anchor patch against current content", {
                targetPath: proposal.targetPath,
              });
              textToWrite = rebased.text;
            } else {
              this.markPatchConflict(tabId, patchId);
              throw this.buildPatchConflictError(
                tabId,
                proposal,
                rebased.failure.reason,
                currentContent,
                currentContent,
              );
            }
          } else if (normalizeForComparison(proposal.proposedText) === normalizedCurrent) {
            console.info("[obsidian-codex-study] proposal already applied (no-op)", {
              targetPath: proposal.targetPath,
            });
          } else {
            this.markPatchConflict(tabId, patchId);
            throw this.buildPatchConflictError(tabId, proposal, "content_changed", currentContent, currentContent);
          }
        }
        textToWrite = this.ensureReadablePatchBeforeWrite(tabId, patchId, proposal, textToWrite);
        await this.deps.app.vault.modify(file, textToWrite);
      }

      const finalizedProposal = this.deps.findTab(tabId)?.patchBasket.find((entry) => entry.id === patchId) ?? proposal;
      await this.finalizeAppliedPatch(tabId, patchId, finalizedProposal);
    } finally {
      this.patchApplyActionsInFlight.delete(patchActionKey);
    }
  }

  async overwritePatchProposal(
    tabId: string,
    patchId: string,
    expectedCurrentContentHash: string | null,
    force = false,
  ): Promise<PatchOverwriteResult> {
    const tab = this.deps.findTab(tabId);
    const proposal = tab?.patchBasket.find((entry) => entry.id === patchId) ?? null;
    if (!tab || !proposal) {
      return "applied";
    }
    const targetPath = this.assertManagedNotePath(proposal.targetPath, (path) => this.getUnsafeNotePathMessage(path));
    const abstractFile = asFileLike(this.deps.app.vault.getAbstractFileByPath(targetPath));
    const file = abstractFile;
    const currentContent = file ? await this.deps.app.vault.cachedRead(file) : null;
    if (!force && expectedCurrentContentHash !== null && expectedCurrentContentHash !== hashPatchContent(currentContent)) {
      return "changed";
    }
    const textToWrite = this.ensureReadablePatchBeforeWrite(tabId, patchId, proposal, proposal.proposedText);

    if (proposal.kind === "create") {
      if (!file) {
        await this.ensureParentFolder(targetPath);
        await this.deps.app.vault.create(targetPath, textToWrite);
      } else {
        await this.deps.app.vault.modify(file, textToWrite);
      }
    } else {
      if (!file) {
        this.deps.store.updatePatchProposal(tabId, patchId, (current) => ({ ...current, status: "stale" }));
        throw new Error(`${targetPath} no longer exists.`);
      }
      await this.deps.app.vault.modify(file, textToWrite);
    }

    const finalizedProposal = this.deps.findTab(tabId)?.patchBasket.find((entry) => entry.id === patchId) ?? proposal;
    await this.finalizeAppliedPatch(tabId, patchId, finalizedProposal);
    return "applied";
  }

  rejectPatchProposal(tabId: string, patchId: string): void {
    if (this.patchApplyActionsInFlight.has(buildPatchActionKey(tabId, patchId))) {
      return;
    }
    const proposal = this.deps.findTab(tabId)?.patchBasket.find((entry) => entry.id === patchId) ?? null;
    if (!proposal) {
      return;
    }
    this.deps.store.updatePatchProposal(tabId, patchId, (current) => ({ ...current, status: "rejected" }));
    this.deps.store.addMessage(tabId, {
      id: makeId("patch-rejected"),
      kind: "system",
      text: this.deps.getLocalizedCopy().service.patchRejected(proposal.targetPath),
      createdAt: Date.now(),
    });
  }

  async openPatchTarget(tabId: string, patchId: string): Promise<void> {
    const proposal = this.deps.findTab(tabId)?.patchBasket.find((entry) => entry.id === patchId) ?? null;
    if (!proposal) {
      return;
    }
    const targetPath = this.assertManagedNotePath(proposal.targetPath, (path) => this.getUnsafeNotePathMessage(path));
    const abstractFile = asFileLike(this.deps.app.vault.getAbstractFileByPath(targetPath));
    if (!abstractFile) {
      throw new Error(this.deps.getLocalizedCopy().service.patchTargetMissing(targetPath));
    }
    await this.deps.app.workspace.getLeaf(false).openFile(abstractFile);
  }

  private async finalizeAppliedPatch(
    tabId: string,
    patchId: string,
    proposal: ConversationTabState["patchBasket"][number],
  ): Promise<void> {
    this.deps.store.updatePatchProposal(tabId, patchId, (current) => ({ ...current, status: "applied" }));
    this.deps.store.upsertToolLog(tabId, `patch-${patchId}`, (current) =>
      buildActivityRecord(
        current,
        `patch-${patchId}`,
        "file",
        "write_note",
        proposal.kind === "create" ? "Create note" : "Apply note patch",
        proposal.summary,
        proposal.unifiedDiff,
        "completed",
        proposal.targetPath,
      ),
    );
    this.deps.store.addMessage(tabId, {
      id: makeId("patch-applied"),
      kind: "system",
      text:
        proposal.kind === "create"
          ? this.deps.getLocalizedCopy().service.patchCreated(proposal.targetPath)
          : this.deps.getLocalizedCopy().service.patchApplied(proposal.targetPath),
      meta: {
        tone: "success",
        patchTargetPath: proposal.targetPath,
        patchOperation: proposal.kind,
      },
      createdAt: Date.now(),
    });
    if (proposal.healedByPlugin) {
      this.deps.store.addMessage(tabId, {
        id: makeId("patch-auto-heal-audit"),
        kind: "system",
        text: this.deps.getLocalizedCopy().workspace.patchReadabilityAppliedAfterHeal(getPathStem(proposal.targetPath)),
        createdAt: Date.now(),
      });
    }
    await this.deps.onApprovedEditApplied?.({
      tabId,
      targetPath: proposal.targetPath,
      sourceMessageId: proposal.sourceMessageId,
      originTurnId: proposal.originTurnId,
      summary: proposal.summary,
      kind: "patch",
    });
  }

  private markPatchConflict(tabId: string, patchId: string): void {
    this.deps.store.updatePatchProposal(tabId, patchId, (current) => ({ ...current, status: "conflicted" }));
  }

  private buildPatchConflictError(
    tabId: string,
    proposal: ConversationTabState["patchBasket"][number],
    reason: PatchConflictReason,
    currentContent: string | null,
    conflictSourceText: string | null,
  ): PatchConflictError {
    const message =
      reason === "target_exists"
        ? `${proposal.targetPath} already exists with different content.`
        : reason === "content_changed"
          ? `${proposal.targetPath} changed since Codex proposed this patch.`
          : `${proposal.targetPath} changed since Codex proposed this patch (${reason}).`;
    return new PatchConflictError(
      {
        tabId,
        patchId: proposal.id,
        targetPath: proposal.targetPath,
        reason,
        baseSnapshot: proposal.baseSnapshot,
        currentContent: conflictSourceText,
        proposedText: proposal.proposedText,
        unifiedDiff: proposal.unifiedDiff,
        openedCurrentContentHash: hashPatchContent(currentContent),
      },
      message,
    );
  }

  reconcileApprovalStatus(tabId: string): void {
    const tab = this.deps.findTab(tabId);
    if (!tab) {
      return;
    }
    if (this.deps.isTabRunning(tabId)) {
      return;
    }
    if (tab.pendingApprovals.length > 0) {
      this.deps.store.setStatus(tabId, "waiting_approval");
      return;
    }
    if (!this.deps.hasCodexLogin()) {
      this.deps.store.setStatus(tabId, "missing_login", this.deps.getMissingLoginMessage());
      return;
    }
    if (tab.status !== "error") {
      this.deps.store.setStatus(tabId, "ready");
    }
  }

  collectBacklinkSources(targetPath: string): Array<{ path: string; count: number }> {
    const resolvedLinks = this.deps.app.metadataCache.resolvedLinks ?? {};
    const sources: Array<{ path: string; count: number }> = [];
    for (const sourcePath of Object.keys(resolvedLinks)) {
      const count = resolvedLinks[sourcePath]?.[targetPath] ?? 0;
      if (count > 0) {
        sources.push({ path: sourcePath, count });
      }
    }
    return sources.sort((left, right) => right.count - left.count);
  }

  async ensureParentFolder(filePath: string): Promise<void> {
    const folderPath = this.assertManagedFolderPath(dirname(filePath).replace(/\\/g, "/"));
    if (!folderPath || folderPath === ".") {
      return;
    }
    let currentPath = "";
    for (const segment of folderPath.split("/").filter(Boolean)) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      if (!this.deps.app.vault.getAbstractFileByPath(currentPath)) {
        await this.deps.app.vault.createFolder(currentPath);
      }
    }
  }

  repointFilePathReferences(oldPath: string, nextPath: string): void {
    for (const tab of this.deps.store.getState().tabs) {
      if (tab.targetNotePath === oldPath) {
        this.deps.store.setTargetNotePath(tab.id, nextPath);
      }
      if (tab.selectionContext?.sourcePath === oldPath) {
        this.deps.store.setSelectionContext(tab.id, {
          ...tab.selectionContext,
          sourcePath: nextPath,
        });
      }
      if (tab.contextPaths.includes(oldPath)) {
        this.deps.store.setContextPaths(
          tab.id,
          tab.contextPaths.map((path) => (path === oldPath ? nextPath : path)),
        );
      }

      const patchBasket = tab.patchBasket.map((proposal) =>
        proposal.targetPath === oldPath ? { ...proposal, targetPath: nextPath } : proposal,
      );
      if (patchBasket.some((proposal, index) => proposal.targetPath !== (tab.patchBasket[index]?.targetPath ?? null))) {
        this.deps.store.setPatchBasket(tab.id, patchBasket);
      }

      const approvals = tab.pendingApprovals.map((approval) => {
        const payload = approval.toolPayload;
        if (!isVaultOpProposal(payload) || payload.kind === "rename" || payload.kind === "move") {
          return approval;
        }
        if (payload.targetPath !== oldPath) {
          return approval;
        }
        return {
          ...approval,
          decisionTarget: nextPath,
          description: approval.description.replace(oldPath, nextPath),
          details: approval.details.replace(oldPath, nextPath),
          toolPayload: {
            ...payload,
            targetPath: nextPath,
          },
        };
      });
      if (
        approvals.some((approval, index) => {
          const nextPayload = isVaultOpProposal(approval.toolPayload) ? approval.toolPayload.targetPath : null;
          const currentPayload = isVaultOpProposal(tab.pendingApprovals[index]?.toolPayload)
            ? tab.pendingApprovals[index]?.toolPayload.targetPath
            : null;
          return nextPayload !== currentPayload;
        })
      ) {
        this.deps.store.setApprovals(tab.id, approvals);
      }
    }
  }

  private async buildVaultOpPayload(op: ParsedAssistantOp): Promise<VaultOpProposal | null> {
    const rawTargetPath = op.targetPath.trim();
    if (!rawTargetPath) {
      return null;
    }
    const targetPathResult = validateManagedNotePath(this.deps.app, rawTargetPath);
    if (!targetPathResult.ok) {
      return null;
    }
    const destinationPath = op.destinationPath?.trim() ? op.destinationPath.trim() : undefined;
    const destinationPathResult =
      destinationPath && (op.kind === "rename" || op.kind === "move")
        ? validateManagedNotePath(this.deps.app, destinationPath)
        : null;
    if (destinationPathResult && !destinationPathResult.ok) {
      return null;
    }
    const normalizedTargetPath = targetPathResult.normalizedPath;
    const normalizedDestinationPath = destinationPathResult?.normalizedPath;
    return {
      kind: op.kind,
      targetPath: normalizedTargetPath,
      destinationPath: normalizedDestinationPath,
      propertyKey: op.propertyKey?.trim() ? op.propertyKey.trim() : undefined,
      propertyValue: op.propertyValue ?? null,
      taskLine: typeof op.taskLine === "number" ? op.taskLine : null,
      taskText: op.taskText?.trim() ? op.taskText.trim() : null,
      checked: typeof op.checked === "boolean" ? op.checked : null,
      preflightSummary: await this.buildVaultOpPreflightSummary(op.kind, normalizedTargetPath, normalizedDestinationPath, op),
      impact: await this.buildVaultOpImpact(op.kind, normalizedTargetPath, normalizedDestinationPath),
    };
  }

  private async buildVaultOpImpact(
    kind: VaultOpProposal["kind"],
    targetPath: string,
    destinationPath: string | undefined,
  ): Promise<VaultOpProposal["impact"]> {
    const file = asFileLike(this.deps.app.vault.getAbstractFileByPath(targetPath));
    if (!file || (kind !== "rename" && kind !== "move")) {
      return null;
    }

    const backlinkSources = this.collectBacklinkSources(file.path);
    const destinationState = destinationPath
      ? asFileLike(this.deps.app.vault.getAbstractFileByPath(destinationPath))
        ? `Destination already exists: ${destinationPath}`
        : `Destination clear: ${destinationPath}`
      : "Destination path missing.";
    const unresolved =
      kind === "rename" && destinationPath ? this.collectUnresolvedStemSources(getPathStem(file.path)) : { total: 0, sources: [] };
    return {
      backlinksCount: backlinkSources.reduce((total, entry) => total + entry.count, 0),
      backlinkSources: backlinkSources.slice(0, 5).map((entry) => `${entry.path} (${entry.count})`),
      unresolvedWarning:
        unresolved.total > 0
          ? `Unresolved references to ${getPathStem(file.path)} will remain unresolved after the rename.`
          : null,
      unresolvedSources: unresolved.sources.slice(0, 5),
      destinationState,
      recoveryNote: "Use Obsidian File Recovery if you need to roll this back.",
    };
  }

  private async buildVaultOpPreflightSummary(
    kind: VaultOpProposal["kind"],
    targetPath: string,
    destinationPath: string | undefined,
    op: ParsedAssistantOp,
  ): Promise<string> {
    const details: string[] = [];
    const file = asFileLike(this.deps.app.vault.getAbstractFileByPath(targetPath));

    if (!file) {
      details.push(`Target note not found: ${targetPath}`);
      return details.join("\n");
    }

    if (kind === "rename" || kind === "move") {
      const impact = await this.buildVaultOpImpact(kind, file.path, destinationPath);
      details.push(`Backlinks detected: ${impact?.backlinksCount ?? 0}`);
      if (impact?.destinationState) {
        details.push(impact.destinationState);
      }
      if (impact?.unresolvedWarning) {
        details.push(impact.unresolvedWarning);
      }
      details.push("Obsidian FileManager will rewrite wikilinks when the rename or move succeeds.");
      details.push("Use Obsidian File Recovery if you need to roll this back.");
      return details.join("\n");
    }

    if (kind === "property_set" || kind === "property_remove") {
      details.push(`Frontmatter target: ${file.path}`);
      if (op.propertyKey?.trim()) {
        details.push(`Property key: ${op.propertyKey.trim()}`);
      }
      details.push("Frontmatter will be updated in-place.");
      return details.join("\n");
    }

    const content = await this.deps.app.vault.cachedRead(file);
    const taskMatch = this.findTaskMatch(content, op.taskLine ?? null, op.taskText ?? null);
    details.push(taskMatch ? `Matched task: ${taskMatch.lineText.trim()}` : "No matching task found.");
    if (typeof op.checked === "boolean") {
      details.push(`Requested state: ${op.checked ? "checked" : "unchecked"}`);
    }
    return details.join("\n");
  }

  private async executeVaultOpApproval(tabId: string, approval: PendingApproval): Promise<void> {
    const op = approval.toolPayload;
    if (!isVaultOpProposal(op)) {
      throw new Error("Approval payload is missing.");
    }

    if (op.kind === "rename" || op.kind === "move") {
      await this.executeRenameOrMove(op);
    } else if (op.kind === "property_set") {
      await this.executePropertySet(op);
    } else if (op.kind === "property_remove") {
      await this.executePropertyRemove(op);
    } else {
      await this.executeTaskUpdate(op);
    }

    this.deps.store.upsertToolLog(tabId, `approval-${approval.id}`, (current) =>
      buildActivityRecord(
        current,
        `approval-${approval.id}`,
        op.kind === "rename" || op.kind === "move" ? "file" : "tool",
        approval.toolName,
        approval.title,
        approval.description,
        safeJson(op),
        "completed",
        op.preflightSummary ?? approval.details,
      ),
    );
    await this.deps.onApprovedEditApplied?.({
      tabId,
      targetPath: approval.decisionTarget ?? op.targetPath,
      sourceMessageId: approval.sourceMessageId ?? null,
      originTurnId: approval.originTurnId ?? null,
      summary: op.preflightSummary ?? approval.details,
      kind: "vault_op",
    });
  }

  private async executeSkillUpdateApproval(tabId: string, approval: PendingApproval): Promise<void> {
    const proposal = approval.toolPayload;
    if (!isSkillImprovementProposal(proposal)) {
      throw new Error("Skill-update payload is missing.");
    }
    const installedSkill = this.requireUserOwnedInstalledSkillDefinition(proposal.skillName, proposal.skillPath);
    const currentContent = await fs.readFile(installedSkill.path, "utf8");
    if (hashPatchContent(currentContent) !== proposal.baseContentHash) {
      throw new Error(`Skill file changed since review started: ${installedSkill.path}`);
    }
    await fs.writeFile(installedSkill.path, proposal.nextContent, "utf8");
    this.deps.store.upsertToolLog(tabId, `approval-${approval.id}`, (current) =>
      buildActivityRecord(
        current,
        `approval-${approval.id}`,
        "file",
        approval.toolName,
        approval.title,
        approval.description,
        safeJson(proposal),
        "completed",
        installedSkill.path,
      ),
    );
  }

  private async executeRenameOrMove(op: VaultOpProposal): Promise<void> {
    if (!op.destinationPath) {
      throw new Error("Destination path is required.");
    }
    const targetPath = this.assertManagedNotePath(op.targetPath, (path) => this.getUnsafeVaultOpMessage(path));
    const destinationPath = this.assertManagedNotePath(op.destinationPath, (path) => this.getUnsafeVaultOpMessage(path));
    const abstractFile = asFileLike(this.deps.app.vault.getAbstractFileByPath(targetPath));
    if (!abstractFile) {
      throw new Error(`${targetPath} does not exist.`);
    }
    if (asFileLike(this.deps.app.vault.getAbstractFileByPath(destinationPath))) {
      throw new Error(`${destinationPath} already exists.`);
    }
    await this.ensureParentFolder(destinationPath);
    await this.deps.app.fileManager.renameFile(abstractFile, destinationPath);
    this.repointFilePathReferences(targetPath, destinationPath);
  }

  private async executePropertySet(op: VaultOpProposal): Promise<void> {
    if (!op.propertyKey) {
      throw new Error("Property key is required.");
    }
    const targetPath = this.assertManagedNotePath(op.targetPath, (path) => this.getUnsafeVaultOpMessage(path));
    const abstractFile = asFileLike(this.deps.app.vault.getAbstractFileByPath(targetPath));
    if (!abstractFile) {
      throw new Error(`${targetPath} does not exist.`);
    }
    await this.deps.app.fileManager.processFrontMatter(abstractFile, (frontmatter) => {
      frontmatter[op.propertyKey as string] = op.propertyValue ?? "";
    });
  }

  private async executePropertyRemove(op: VaultOpProposal): Promise<void> {
    if (!op.propertyKey) {
      throw new Error("Property key is required.");
    }
    const targetPath = this.assertManagedNotePath(op.targetPath, (path) => this.getUnsafeVaultOpMessage(path));
    const abstractFile = asFileLike(this.deps.app.vault.getAbstractFileByPath(targetPath));
    if (!abstractFile) {
      throw new Error(`${targetPath} does not exist.`);
    }
    await this.deps.app.fileManager.processFrontMatter(abstractFile, (frontmatter) => {
      delete frontmatter[op.propertyKey as string];
    });
  }

  private async executeTaskUpdate(op: VaultOpProposal): Promise<void> {
    if (typeof op.checked !== "boolean") {
      throw new Error("Task update requires a checked boolean.");
    }
    const targetPath = this.assertManagedNotePath(op.targetPath, (path) => this.getUnsafeVaultOpMessage(path));
    const abstractFile = asFileLike(this.deps.app.vault.getAbstractFileByPath(targetPath));
    if (!abstractFile) {
      throw new Error(`${targetPath} does not exist.`);
    }
    const content = await this.deps.app.vault.cachedRead(abstractFile);
    const match = this.findTaskMatch(content, op.taskLine ?? null, op.taskText ?? null);
    if (!match) {
      throw new Error("No matching task line was found.");
    }
    const lines = normalizeProposalText(content).split("\n");
    const currentLine = lines[match.lineIndex] ?? "";
    lines[match.lineIndex] = currentLine.replace(/^(\s*[-*]\s+\[)( |x|X)(\]\s.*)$/, `$1${op.checked ? "x" : " "}$3`);
    await this.deps.app.vault.modify(abstractFile, lines.join("\n"));
  }

  private findTaskMatch(content: string, requestedLine: number | null, taskText: string | null): VaultTaskMatchResult | null {
    const lines = normalizeProposalText(content).split("\n");
    const checkboxPattern = /^\s*[-*]\s+\[(?: |x|X)\]\s.+$/;
    if (typeof requestedLine === "number" && requestedLine > 0) {
      const lineIndex = requestedLine - 1;
      const lineText = lines[lineIndex] ?? "";
      if (checkboxPattern.test(lineText)) {
        return { lineIndex, lineText };
      }
    }
    if (taskText?.trim()) {
      const lineIndex = lines.findIndex((line) => checkboxPattern.test(line) && line.includes(taskText));
      if (lineIndex >= 0) {
        return {
          lineIndex,
          lineText: lines[lineIndex] ?? "",
        };
      }
    }
    return null;
  }

  private collectUnresolvedStemSources(stem: string): { total: number; sources: string[] } {
    const unresolvedLinks = this.deps.app.metadataCache.unresolvedLinks ?? {};
    const sources: string[] = [];
    for (const [sourcePath, targets] of Object.entries(unresolvedLinks)) {
      const matches = Object.keys(targets ?? {}).some((target) => target === stem || target === `${stem}.md`);
      if (matches) {
        sources.push(sourcePath);
      }
    }
    return {
      total: sources.length,
      sources,
    };
  }

}
