import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { AgentStore } from "../model/store";
import type { PatchProposal, PendingApproval } from "../model/types";
import { getLocalizedCopy } from "../util/i18n";
import { ApprovalCoordinator, type ApprovalCoordinatorDeps } from "../app/approvalCoordinator";
import type { ParsedAssistantOp } from "../util/assistantProposals";
import { PatchConflictError, hashPatchContent } from "../util/patchConflicts";
import {
  CALLOUT_MATH_COLLISION_SAMPLE,
  CALLOUT_MATH_HEALED_SAMPLE,
  CALLOUT_MATH_MIXED_CONTEXT_SAMPLE,
  CALLOUT_MATH_SAMPLE,
} from "./fixtures/calloutMathFixture";
import type { InstalledSkillDefinition } from "../util/skillCatalog";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function createApp(initialFiles: Record<string, string> = {}) {
  const files = new Map(Object.entries(initialFiles));
  const folders = new Set<string>();
  const openFile = vi.fn(async () => {});

  const app = {
    vault: {
      adapter: {
        basePath: "/vault",
      },
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
    getUserOwnedInstalledSkills: () => [],
    abortTabRun: vi.fn(() => true),
    hasCodexLogin: () => true,
    getMissingLoginMessage: () => "Missing login",
    isTabRunning: () => false,
    ...overrides,
  };
  return {
    app,
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
    expect(tab?.messages.at(-1)?.text).toBe("Applied: notes/source.md.");
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

  it("ignores a duplicate approval action while the same approval is already in flight", async () => {
    const { app, store, files, coordinator } = createDeps({}, { "notes/source.md": "# Source" });
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
      scopeEligible: false,
      scope: "write",
      toolPayload: {
        kind: "rename",
        targetPath: "notes/source.md",
        destinationPath: "archive/source-renamed.md",
        impact: null,
      },
    };
    const renameGate = createDeferred<void>();
    (app.fileManager.renameFile as ReturnType<typeof vi.fn>).mockImplementation(async (file: { path: string }, nextPath: string) => {
      await renameGate.promise;
      const content = files.get(file.path);
      files.delete(file.path);
      files.set(nextPath, content ?? "");
    });
    store.setApprovals(tabId, [approval]);

    const firstAttempt = coordinator.respondToApproval("approval-1", "approve");
    await Promise.resolve();
    const secondAttempt = await coordinator.respondToApproval("approval-1", "approve");

    expect(secondAttempt).toBe("ignored");

    renameGate.resolve();
    expect(await firstAttempt).toBe("applied");
    expect(app.fileManager.renameFile).toHaveBeenCalledTimes(1);
    expect(files.has("archive/source-renamed.md")).toBe(true);
  });

  it("ignores single approval actions while a batch approval is in flight for the same tab", async () => {
    const { app, store, files, coordinator } = createDeps({}, { "notes/source.md": "# Source" });
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
      scopeEligible: false,
      scope: "write",
      toolPayload: {
        kind: "rename",
        targetPath: "notes/source.md",
        destinationPath: "archive/source-renamed.md",
        impact: null,
      },
    };
    const renameGate = createDeferred<void>();
    (app.fileManager.renameFile as ReturnType<typeof vi.fn>).mockImplementation(async (file: { path: string }, nextPath: string) => {
      await renameGate.promise;
      const content = files.get(file.path);
      files.delete(file.path);
      files.set(nextPath, content ?? "");
    });
    store.setApprovals(tabId, [approval]);

    const batchAttempt = coordinator.respondToAllApprovals(tabId, "approve");
    await Promise.resolve();
    const singleResult = await coordinator.respondToApproval("approval-1", "approve");

    expect(singleResult).toBe("ignored");

    renameGate.resolve();
    await batchAttempt;
    expect(app.fileManager.renameFile).toHaveBeenCalledTimes(1);
    expect(files.has("archive/source-renamed.md")).toBe(true);
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

  it("re-checks rebased anchor patches before write and keeps readability-risk patches pending", async () => {
    const { store, files, coordinator } = createDeps({}, { "notes/source.md": "Preface\nIntroTail" });
    const tabId = store.getActiveTab()!.id;
    store.setPatchBasket(tabId, [
      {
        id: "patch-1",
        threadId: null,
        sourceMessageId: "assistant-1",
        originTurnId: "turn-1",
        targetPath: "notes/source.md",
        kind: "update",
        baseSnapshot: "IntroTail",
        proposedText: `Intro\n${CALLOUT_MATH_COLLISION_SAMPLE}\nTail`,
        unifiedDiff: "@@",
        summary: "Insert malformed math",
        status: "pending",
        createdAt: 1,
        anchors: [
          {
            anchorBefore: "Intro",
            anchorAfter: "Tail",
            replacement: `\n${CALLOUT_MATH_COLLISION_SAMPLE}\n`,
          },
        ],
      },
    ]);

    await expect(coordinator.applyPatchProposal(tabId, "patch-1")).rejects.toThrow("Review needed: notes/source.md.");
    expect(files.get("notes/source.md")).toBe("Preface\nIntroTail");
    expect(store.getActiveTab()?.patchBasket[0]).toEqual(
      expect.objectContaining({
        status: "pending",
        qualityState: "review_required",
      }),
    );
  });

  it("applies readability-risk patches when the user explicitly confirms apply", async () => {
    const { store, files, coordinator } = createDeps({}, { "notes/source.md": "Intro\nTail" });
    const tabId = store.getActiveTab()!.id;
    store.setPatchBasket(tabId, [
      {
        id: "patch-readable-explicit",
        threadId: null,
        sourceMessageId: "assistant-1",
        originTurnId: "turn-1",
        targetPath: "notes/source.md",
        kind: "update",
        baseSnapshot: "Intro\nTail",
        proposedText: `Intro\n${CALLOUT_MATH_MIXED_CONTEXT_SAMPLE}\nTail`,
        unifiedDiff: "@@",
        summary: "Insert mixed-context math",
        status: "pending",
        qualityState: "review_required",
        createdAt: 1,
      },
    ]);

    await coordinator.applyPatchProposal(tabId, "patch-readable-explicit", { allowReadabilityRisk: true });

    expect(files.get("notes/source.md")).toContain("Outside the callout");
    expect(store.getActiveTab()?.patchBasket[0]?.status).toBe("applied");
  });

  it("keeps protected safety-risk patches blocked even when explicit apply allows readability risk", async () => {
    const { store, files, coordinator } = createDeps({}, { "notes/source.md": "# Source\n\nOriginal" });
    const tabId = store.getActiveTab()!.id;
    store.setPatchBasket(tabId, [
      {
        id: "patch-protected-full-replace",
        threadId: null,
        sourceMessageId: "assistant-1",
        originTurnId: "turn-1",
        targetPath: "notes/source.md",
        kind: "update",
        intent: "full_replace",
        baseSnapshot: "# Source\n\nOriginal",
        proposedText: "# Rewritten",
        unifiedDiff: "@@",
        summary: "Rewrite the whole note",
        status: "pending",
        safetyIssues: [{ code: "full_replace_requires_review", detail: "explicit_full_replace" }],
        createdAt: 1,
      },
    ]);

    await expect(
      coordinator.applyPatchProposal(tabId, "patch-protected-full-replace", { allowReadabilityRisk: true }),
    ).rejects.toThrow("Blocked: this patch could remove existing note content.");
    expect(files.get("notes/source.md")).toBe("# Source\n\nOriginal");
    expect(store.getActiveTab()?.patchBasket[0]?.status).toBe("pending");
  });

  it("adds an audit breadcrumb after applying an auto-healed patch", async () => {
    const { store, files, coordinator } = createDeps({}, { "notes/source.md": "Intro\nTail" });
    const tabId = store.getActiveTab()!.id;
    store.setPatchBasket(tabId, [
      {
        id: "patch-2",
        threadId: null,
        sourceMessageId: "assistant-1",
        originTurnId: "turn-2",
        targetPath: "notes/source.md",
        kind: "update",
        baseSnapshot: "Intro\nTail",
        proposedText: `Intro\n${CALLOUT_MATH_SAMPLE}\nTail`,
        unifiedDiff: "@@",
        summary: "Normalize callout math",
        status: "pending",
        createdAt: 2,
      },
    ]);

    await coordinator.applyPatchProposal(tabId, "patch-2");

    expect(files.get("notes/source.md")).toBe(`Intro\n${CALLOUT_MATH_HEALED_SAMPLE}\nTail`);
    expect(store.getActiveTab()?.messages.map((message) => message.text)).toEqual(
      expect.arrayContaining([
        "Applied: notes/source.md.",
        "Applied after the plugin normalized Markdown structure: source.",
      ]),
    );
    expect(store.getActiveTab()?.messages.find((message) => message.id.startsWith("patch-auto-heal-audit"))?.meta).toEqual(
      expect.objectContaining({ tone: "success" }),
    );
  });

  it("ignores patch rejection while the same patch is being applied", async () => {
    const { app, store, files, coordinator } = createDeps({}, { "notes/source.md": "old" });
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
    const modifyGate = createDeferred<void>();
    (app.vault.modify as ReturnType<typeof vi.fn>).mockImplementation(async (file: { path: string }, content: string) => {
      await modifyGate.promise;
      files.set(file.path, content);
    });
    store.setPatchBasket(tabId, [patch]);

    const applyAttempt = coordinator.applyPatchProposal(tabId, "patch-1");
    await Promise.resolve();
    coordinator.rejectPatchProposal(tabId, "patch-1");

    expect(store.getActiveTab()?.patchBasket[0]?.status).toBe("pending");

    modifyGate.resolve();
    await applyAttempt;
    expect(store.getActiveTab()?.patchBasket[0]?.status).toBe("applied");
    expect(files.get("notes/source.md")).toBe("new");
  });

  it("applies a skill-update approval by writing back to the original SKILL.md", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-skill-update-"));
    tempRoots.push(tempRoot);
    const skillPath = join(tempRoot, "skills", "note-refiner", "SKILL.md");
    await mkdir(join(tempRoot, "skills", "note-refiner"), { recursive: true });
    await writeFile(skillPath, "# Note Refiner\n\nOriginal body.\n", "utf8");

    const installedSkill: InstalledSkillDefinition = {
      name: "note-refiner",
      description: "Refine note rewrites.",
      path: skillPath,
    };
    const { store, coordinator } = createDeps({
      getUserOwnedInstalledSkills: () => [installedSkill],
    });
    const tabId = store.getActiveTab()!.id;
    const approval: PendingApproval = {
      id: "approval-skill-1",
      tabId,
      callId: "call-skill-1",
      toolName: "skill_update" as never,
      title: "Update skill: note-refiner",
      description: skillPath,
      details: "Apply a learned refinement to the user-owned skill.",
      diffText: "@@",
      createdAt: 1,
      sourceMessageId: "assistant-1",
      originTurnId: "turn-1",
      transport: "plugin_proposal",
      decisionTarget: skillPath,
      scopeEligible: false,
      scope: "write",
      toolPayload: {
        skillName: "note-refiner",
        skillPath,
        baseContent: "# Note Refiner\n\nOriginal body.\n",
        baseContentHash: hashPatchContent("# Note Refiner\n\nOriginal body.\n"),
        nextContent: "# Note Refiner\n\nOriginal body.\n\n## Learned execution refinements\n- Keep structural edits concise.\n",
        feedbackSummary: "Keep structural edits concise.",
        attribution: {
          prompt: "Rewrite the note clearly.",
          summary: "Applied a cleaned-up note rewrite.",
          targetNotePath: "notes/source.md",
          panelId: "panel-1",
        },
      } as never,
    };
    store.setApprovals(tabId, [approval]);

    const result = await coordinator.respondToApproval("approval-skill-1", "approve");
    const updated = await readFile(skillPath, "utf8");

    expect(result).toBe("applied");
    expect(updated).toContain("## Learned execution refinements");
    expect(updated).toContain("Keep structural edits concise.");
    expect(store.getActiveTab()?.pendingApprovals).toHaveLength(0);
  });

  it("includes skill-update approvals in batch approval actions", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-skill-update-batch-"));
    tempRoots.push(tempRoot);
    const skillPath = join(tempRoot, "skills", "deep-read", "SKILL.md");
    await mkdir(join(tempRoot, "skills", "deep-read"), { recursive: true });
    await writeFile(skillPath, "# Deep Read\n\nOriginal body.\n", "utf8");

    const installedSkill: InstalledSkillDefinition = {
      name: "deep-read",
      description: "Read deeply.",
      path: skillPath,
    };
    const { store, coordinator } = createDeps({
      getUserOwnedInstalledSkills: () => [installedSkill],
    });
    const tabId = store.getActiveTab()!.id;
    store.setApprovals(tabId, [
      {
        id: "approval-skill-1",
        tabId,
        callId: "call-skill-1",
        toolName: "skill_update" as never,
        title: "Update skill: deep-read",
        description: skillPath,
        details: "Learned refinement",
        diffText: "@@",
        createdAt: 1,
        sourceMessageId: "assistant-1",
        originTurnId: "turn-1",
        transport: "plugin_proposal",
        decisionTarget: skillPath,
        scopeEligible: false,
        scope: "write",
        toolPayload: {
          skillName: "deep-read",
          skillPath,
          baseContent: "# Deep Read\n\nOriginal body.\n",
          baseContentHash: hashPatchContent("# Deep Read\n\nOriginal body.\n"),
          nextContent: "# Deep Read\n\nOriginal body.\n\n## Learned execution refinements\n- Prefer precise evidence.\n",
          feedbackSummary: "Prefer precise evidence.",
          attribution: {
            prompt: "Improve this note.",
            summary: "Applied a note cleanup.",
            targetNotePath: "notes/source.md",
            panelId: null,
          },
        } as never,
      },
    ]);

    await coordinator.respondToAllApprovals(tabId, "approve");

    expect(await readFile(skillPath, "utf8")).toContain("Prefer precise evidence.");
    expect(store.getActiveTab()?.pendingApprovals).toHaveLength(0);
  });

  it("rejects skill-update approvals for paths outside the current user-owned skill catalog", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-skill-update-outside-"));
    tempRoots.push(tempRoot);
    const skillPath = join(tempRoot, "skills", "deep-read", "SKILL.md");
    await mkdir(join(tempRoot, "skills", "deep-read"), { recursive: true });
    await writeFile(skillPath, "# Deep Read\n\nOriginal body.\n", "utf8");

    const { store, coordinator } = createDeps({
      getUserOwnedInstalledSkills: () => [],
    });
    const tabId = store.getActiveTab()!.id;
    store.setApprovals(tabId, [
      {
        id: "approval-skill-outside",
        tabId,
        callId: "call-skill-outside",
        toolName: "skill_update" as never,
        title: "Update skill: deep-read",
        description: skillPath,
        details: "Learned refinement",
        diffText: "@@",
        createdAt: 1,
        sourceMessageId: "assistant-1",
        originTurnId: "turn-1",
        transport: "plugin_proposal",
        decisionTarget: skillPath,
        scopeEligible: false,
        scope: "write",
        toolPayload: {
          skillName: "deep-read",
          skillPath,
          baseContent: "# Deep Read\n\nOriginal body.\n",
          baseContentHash: hashPatchContent("# Deep Read\n\nOriginal body.\n"),
          nextContent: "# Deep Read\n\nUpdated body.\n",
          feedbackSummary: "Learned refinement",
          attribution: {
            prompt: "Improve this note.",
            summary: "Applied a note cleanup.",
            targetNotePath: "notes/source.md",
            panelId: null,
          },
        } as never,
      },
    ]);

    const result = await coordinator.respondToApproval("approval-skill-outside", "approve");

    expect(result).toBe("failed");
    expect(await readFile(skillPath, "utf8")).toBe("# Deep Read\n\nOriginal body.\n");
    expect(store.getActiveTab()?.messages.at(-1)?.text).toContain("Skill update blocked");
  });

  it("rejects skill-update approvals when the skill name/path pair no longer matches the current catalog", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "obsidian-codex-skill-update-mismatch-"));
    tempRoots.push(tempRoot);
    const actualSkillPath = join(tempRoot, "skills", "deep-read", "SKILL.md");
    const mismatchedSkillPath = join(tempRoot, "skills", "other", "SKILL.md");
    await mkdir(join(tempRoot, "skills", "deep-read"), { recursive: true });
    await mkdir(join(tempRoot, "skills", "other"), { recursive: true });
    await writeFile(actualSkillPath, "# Deep Read\n\nOriginal body.\n", "utf8");
    await writeFile(mismatchedSkillPath, "# Other\n\nOriginal body.\n", "utf8");

    const { store, coordinator } = createDeps({
      getUserOwnedInstalledSkills: () => [
        {
          name: "deep-read",
          description: "Read deeply.",
          path: actualSkillPath,
        },
      ],
    });
    const tabId = store.getActiveTab()!.id;
    store.setApprovals(tabId, [
      {
        id: "approval-skill-mismatch",
        tabId,
        callId: "call-skill-mismatch",
        toolName: "skill_update" as never,
        title: "Update skill: deep-read",
        description: mismatchedSkillPath,
        details: "Learned refinement",
        diffText: "@@",
        createdAt: 1,
        sourceMessageId: "assistant-1",
        originTurnId: "turn-1",
        transport: "plugin_proposal",
        decisionTarget: mismatchedSkillPath,
        scopeEligible: false,
        scope: "write",
        toolPayload: {
          skillName: "deep-read",
          skillPath: mismatchedSkillPath,
          baseContent: "# Other\n\nOriginal body.\n",
          baseContentHash: hashPatchContent("# Other\n\nOriginal body.\n"),
          nextContent: "# Other\n\nUpdated body.\n",
          feedbackSummary: "Learned refinement",
          attribution: {
            prompt: "Improve this note.",
            summary: "Applied a note cleanup.",
            targetNotePath: "notes/source.md",
            panelId: null,
          },
        } as never,
      },
    ]);

    const result = await coordinator.respondToApproval("approval-skill-mismatch", "approve");

    expect(result).toBe("failed");
    expect(await readFile(actualSkillPath, "utf8")).toBe("# Deep Read\n\nOriginal body.\n");
    expect(await readFile(mismatchedSkillPath, "utf8")).toBe("# Other\n\nOriginal body.\n");
  });
});
