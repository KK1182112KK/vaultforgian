import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { AgentStore } from "../model/store";
import type { PatchProposal, PendingApproval } from "../model/types";
import { getLocalizedCopy } from "../util/i18n";
import { ApprovalCoordinator, type ApprovalCoordinatorDeps } from "../app/approvalCoordinator";
import type { ParsedAssistantOp } from "../util/assistantProposals";
import { PatchConflictError, hashPatchContent } from "../util/patchConflicts";

function createApp(initialFiles: Record<string, string> = {}) {
  const files = new Map(Object.entries(initialFiles));
  const folders = new Set<string>();
  const openFile = vi.fn(async () => {});

  const app = {
    vault: {
      getAbstractFileByPath(path: string) {
        if (files.has(path) || folders.has(path)) {
          return { path };
        }
        return null;
      },
      cachedRead: vi.fn(async (file: { path: string }) => files.get(file.path) ?? ""),
      create: vi.fn(async (path: string, content: string) => {
        files.set(path, content);
        return { path };
      }),
      modify: vi.fn(async (file: { path: string }, content: string) => {
        files.set(file.path, content);
      }),
      createFolder: vi.fn(async (path: string) => {
        folders.add(path);
      }),
    },
    fileManager: {
      renameFile: vi.fn(async (file: { path: string }, nextPath: string) => {
        const content = files.get(file.path);
        files.delete(file.path);
        files.set(nextPath, content ?? "");
      }),
      processFrontMatter: vi.fn(async (_file: { path: string }, updater: (frontmatter: Record<string, unknown>) => void) => {
        updater({});
      }),
    },
    workspace: {
      getLeaf: vi.fn(() => ({
        openFile,
      })),
    },
    metadataCache: {
      resolvedLinks: {},
      unresolvedLinks: {},
    },
  } as unknown as App;

  return { app, files, openFile };
}

function createDeps(overrides: Partial<ApprovalCoordinatorDeps> = {}, initialFiles: Record<string, string> = {}) {
  const store = new AgentStore(null, "/vault", true);
  const { app, files, openFile } = createApp(initialFiles);
  const deps: ApprovalCoordinatorDeps = {
    app,
    store,
    findTab: (tabId) => store.getState().tabs.find((tab) => tab.id === tabId) ?? null,
    getLocalizedCopy: () => getLocalizedCopy("en"),
    abortTabRun: vi.fn(() => true),
    hasCodexLogin: () => true,
    getMissingLoginMessage: () => "Missing login",
    isTabRunning: () => false,
    ...overrides,
  };
  return {
    store,
    files,
    openFile,
    coordinator: new ApprovalCoordinator(deps),
  };
}

describe("ApprovalCoordinator", () => {
  it("keeps vault operations pending even when session write approval was previously enabled", async () => {
    const { store, files, coordinator } = createDeps({}, { "notes/source.md": "# Source" });
    const tabId = store.getActiveTab()!.id;
    store.setSessionApproval(tabId, "write", true);
    store.setTargetNotePath(tabId, "notes/source.md");

    const ops: ParsedAssistantOp[] = [
      {
        sourceIndex: 0,
        kind: "rename",
        targetPath: "notes/source.md",
        destinationPath: "archive/source-renamed.md",
        summary: "Rename note",
      },
    ];

    const approvals = await coordinator.buildVaultOpApprovals(tabId, "assistant-1", ops, true);
    const tab = store.getActiveTab();

    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.scopeEligible).toBe(false);
    expect(files.has("archive/source-renamed.md")).toBe(false);
    expect(tab?.targetNotePath).toBe("notes/source.md");
    expect(tab?.toolLog).toHaveLength(0);
  });

  it("applies a patch proposal", async () => {
    const { store, files, coordinator } = createDeps({}, { "notes/source.md": "old" });
    const tabId = store.getActiveTab()!.id;
    const patch: PatchProposal = {
      id: "patch-1",
      threadId: null,
      sourceMessageId: "assistant-1",
      originTurnId: "turn-1",
      targetPath: "notes/source.md",
      kind: "update",
      baseSnapshot: "old",
      proposedText: "new",
      unifiedDiff: "@@",
      summary: "Update note",
      status: "pending",
      createdAt: 1,
    };
    store.setPatchBasket(tabId, [patch]);

    await coordinator.applyPatchProposal(tabId, "patch-1");

    const tab = store.getActiveTab();
    expect(files.get("notes/source.md")).toBe("new");
    expect(tab?.patchBasket[0]?.status).toBe("applied");
    expect(tab?.toolLog.at(-1)?.callId).toBe("patch-patch-1");
    expect(tab?.messages.at(-1)?.text).toBe("Successfully patched notes/source.md.");
    expect(tab?.messages.at(-1)?.meta?.tone).toBe("success");
  });

  it("denies a pending approval", async () => {
    const { store, coordinator } = createDeps({}, { "notes/source.md": "# Source" });
    const tabId = store.getActiveTab()!.id;
    const approval: PendingApproval = {
      id: "approval-1",
      tabId,
      callId: "call-1",
      toolName: "vault_op",
      title: "Rename note",
      description: "notes/source.md -> archive/source-renamed.md",
      details: "Backlinks detected: 0",
      createdAt: 1,
      sourceMessageId: "assistant-1",
      originTurnId: "turn-1",
      transport: "plugin_proposal",
      decisionTarget: "notes/source.md",
      scopeEligible: true,
      scope: "write",
      toolPayload: {
        kind: "rename",
        targetPath: "notes/source.md",
        destinationPath: "archive/source-renamed.md",
        impact: null,
      },
    };
    store.setApprovals(tabId, [approval]);

    const result = await coordinator.respondToApproval("approval-1", "deny");
    const tab = store.getActiveTab();

    expect(result).toBe("denied");
    expect(tab?.pendingApprovals).toHaveLength(0);
    expect(tab?.messages.at(-1)?.text).toContain("Denied");
  });

  it("throws PatchConflictError for stale full-rewrite patches", async () => {
    const { store, coordinator } = createDeps({}, { "notes/source.md": "current" });
    const tabId = store.getActiveTab()!.id;
    store.setPatchBasket(tabId, [
      {
        id: "patch-1",
        threadId: null,
        sourceMessageId: "assistant-1",
        originTurnId: "turn-1",
        targetPath: "notes/source.md",
        kind: "update",
        baseSnapshot: "old",
        proposedText: "replacement",
        unifiedDiff: "@@",
        summary: "Rewrite note",
        status: "pending",
        createdAt: 1,
      },
    ]);

    await expect(coordinator.applyPatchProposal(tabId, "patch-1")).rejects.toBeInstanceOf(PatchConflictError);
    expect(store.getActiveTab()?.patchBasket[0]?.status).toBe("conflicted");
  });

  it("overwrites a conflicted patch after confirmation", async () => {
    const { store, files, coordinator } = createDeps({}, { "notes/source.md": "current" });
    const tabId = store.getActiveTab()!.id;
    store.setPatchBasket(tabId, [
      {
        id: "patch-1",
        threadId: null,
        sourceMessageId: "assistant-1",
        originTurnId: "turn-1",
        targetPath: "notes/source.md",
        kind: "update",
        baseSnapshot: "old",
        proposedText: "replacement",
        unifiedDiff: "@@",
        summary: "Rewrite note",
        status: "conflicted",
        createdAt: 1,
      },
    ]);

    const firstAttempt = await coordinator.overwritePatchProposal(tabId, "patch-1", hashPatchContent("old"));
    expect(firstAttempt).toBe("changed");

    const forcedAttempt = await coordinator.overwritePatchProposal(tabId, "patch-1", hashPatchContent("old"), true);
    expect(forcedAttempt).toBe("applied");
    expect(files.get("notes/source.md")).toBe("replacement");
    expect(store.getActiveTab()?.patchBasket[0]?.status).toBe("applied");
  });
});
