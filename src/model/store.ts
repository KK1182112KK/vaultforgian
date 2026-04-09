import { makeId } from "../util/id";
import { getFallbackModelCatalog } from "../util/models";
import { createEmptyAccountUsageSummary, createEmptyUsageSummary } from "../util/usage";
import { DEFAULT_PRIMARY_MODEL } from "./types";
import type {
  AccountUsageSummary,
  ChatMessage,
  RefactorCampaign,
  RefactorRecipe,
  RecentStudySource,
  SmartSet,
  StudyHubState,
  StudyWorkflowKind,
  ConversationTabState,
  ModelCatalogEntry,
  PatchProposal,
  PendingApproval,
  PersistedWorkspaceState,
  ToolCallRecord,
  UsageSummary,
  WaitingState,
  WorkspaceState,
} from "./types";

type Listener = (state: WorkspaceState) => void;

function deriveActiveStudyWorkflow(tabs: ConversationTabState[], activeTabId: string | null): StudyWorkflowKind | null {
  return tabs.find((tab) => tab.id === activeTabId)?.studyWorkflow ?? null;
}

function cloneUsageSummary(usageSummary: ConversationTabState["usageSummary"]) {
  return {
    lastTurn: usageSummary.lastTurn ? { ...usageSummary.lastTurn } : null,
    total: usageSummary.total ? { ...usageSummary.total } : null,
    limits: { ...usageSummary.limits },
  };
}

function cloneAccountUsage(accountUsage: AccountUsageSummary): AccountUsageSummary {
  return {
    limits: { ...accountUsage.limits },
    source: accountUsage.source,
    updatedAt: accountUsage.updatedAt,
    threadId: accountUsage.threadId,
  };
}

function deriveRestoredAccountUsage(tabs: ConversationTabState[]): AccountUsageSummary {
  const firstWithLimits = tabs.find(
    (tab) =>
      tab.usageSummary.limits.fiveHourPercent !== null ||
      tab.usageSummary.limits.weekPercent !== null ||
      tab.usageSummary.limits.planType !== null,
  );
  if (!firstWithLimits) {
    return createEmptyAccountUsageSummary();
  }
  return {
    limits: { ...firstWithLimits.usageSummary.limits },
    source: "restored",
    updatedAt: null,
    threadId: firstWithLimits.codexThreadId ?? null,
  };
}

function cloneState(state: WorkspaceState): WorkspaceState {
  return {
    ...state,
    accountUsage: cloneAccountUsage(state.accountUsage),
    activeStudyWorkflow: deriveActiveStudyWorkflow(state.tabs, state.activeTabId),
    recentStudySources: state.recentStudySources.map((source) => ({ ...source })),
    studyHubState: { ...state.studyHubState },
    smartSets: state.smartSets.map((set) => structuredClone(set)),
    activeSmartSetId: state.activeSmartSetId,
    refactorRecipes: state.refactorRecipes.map((recipe) => structuredClone(recipe)),
    activeRefactorRecipeId: state.activeRefactorRecipeId,
    availableModels: state.availableModels.map((model) => ({
      ...model,
      supportedReasoningLevels: [...model.supportedReasoningLevels],
    })),
    tabs: state.tabs.map((tab) => ({
      ...tab,
      instructionChips: tab.instructionChips.map((chip) => ({ ...chip })),
      summary: tab.summary ? { ...tab.summary } : null,
      lineage: { ...tab.lineage },
      targetNotePath: tab.targetNotePath,
      selectionContext: tab.selectionContext ? { ...tab.selectionContext } : null,
      contextPaths: [...tab.contextPaths],
      sessionItems: tab.sessionItems.map((item) => structuredClone(item)),
      messages: tab.messages.map((message) => ({ ...message })),
      pendingApprovals: tab.pendingApprovals.map((approval) => ({ ...approval })),
      toolLog: tab.toolLog.map((entry) => ({ ...entry })),
      patchBasket: tab.patchBasket.map((proposal) => ({ ...proposal })),
      campaigns: tab.campaigns.map((campaign) => structuredClone(campaign)),
      sessionApprovals: { ...tab.sessionApprovals },
      usageSummary: cloneUsageSummary(tab.usageSummary),
      waitingState: tab.waitingState ? { ...tab.waitingState } : null,
    })),
  };
}

function createTab(cwd: string, partial?: Partial<ConversationTabState>): ConversationTabState {
  return {
    id: partial?.id ?? makeId("tab"),
    title: partial?.title ?? "New chat",
    draft: partial?.draft ?? "",
    cwd,
    studyWorkflow: partial?.studyWorkflow ?? null,
    instructionChips: partial?.instructionChips ?? [],
    summary: partial?.summary ?? null,
    lineage: partial?.lineage ?? {
      parentTabId: null,
      forkedFromThreadId: null,
      resumedFromThreadId: null,
      compactedAt: null,
    },
    targetNotePath: partial?.targetNotePath ?? null,
    selectionContext: partial?.selectionContext ? { ...partial.selectionContext } : null,
    composeMode: partial?.composeMode ?? "chat",
    contextPaths: partial?.contextPaths ?? [],
    lastResponseId: partial?.lastResponseId ?? null,
    sessionItems: partial?.sessionItems ?? [],
    codexThreadId: partial?.codexThreadId ?? null,
    model: partial?.model ?? DEFAULT_PRIMARY_MODEL,
    reasoningEffort: partial?.reasoningEffort ?? "xhigh",
    usageSummary: partial?.usageSummary ?? createEmptyUsageSummary(),
    messages: partial?.messages ?? [],
    diffText: partial?.diffText ?? "",
    toolLog: partial?.toolLog ?? [],
    patchBasket: partial?.patchBasket ?? [],
    campaigns: partial?.campaigns ?? [],
    status: partial?.status ?? "ready",
    runtimeMode: partial?.runtimeMode ?? "normal",
    lastError: partial?.lastError ?? null,
    pendingApprovals: partial?.pendingApprovals ?? [],
    sessionApprovals: partial?.sessionApprovals ?? { write: false, shell: false },
    waitingState: partial?.waitingState ?? null,
  };
}

export class AgentStore {
  private state: WorkspaceState;
  private listeners = new Set<Listener>();

  constructor(initial: PersistedWorkspaceState | null, fallbackCwd: string, hasLogin: boolean) {
    const tabs =
      initial?.tabs.length && initial.tabs.length > 0
        ? initial.tabs.map((tab) =>
            createTab(tab.cwd || fallbackCwd, {
              ...tab,
              status: hasLogin ? "ready" : "missing_login",
              pendingApprovals: [],
              sessionApprovals: { write: false, shell: false },
            }),
          )
        : [createTab(fallbackCwd, { title: "Study chat", status: hasLogin ? "ready" : "missing_login" })];
    const requestedActiveTabId = initial?.activeTabId ?? null;
    const activeTabId =
      requestedActiveTabId && tabs.some((tab) => tab.id === requestedActiveTabId) ? requestedActiveTabId : tabs[0]?.id ?? null;
    const accountUsage = initial?.accountUsage ? cloneAccountUsage(initial.accountUsage) : deriveRestoredAccountUsage(tabs);
    const recentStudySources = initial?.recentStudySources?.map((source) => ({ ...source })) ?? [];
    const studyHubState: StudyHubState = {
      lastOpenedAt: initial?.studyHubState?.lastOpenedAt ?? null,
      isCollapsed: initial?.studyHubState?.isCollapsed ?? false,
    };
    const smartSets = initial?.smartSets?.map((set) => structuredClone(set)) ?? [];
    const requestedActiveSmartSetId = initial?.activeSmartSetId ?? null;
    const activeSmartSetId =
      requestedActiveSmartSetId && smartSets.some((set) => set.id === requestedActiveSmartSetId) ? requestedActiveSmartSetId : smartSets[0]?.id ?? null;
    const refactorRecipes = initial?.refactorRecipes?.map((recipe) => structuredClone(recipe)) ?? [];
    const requestedActiveRefactorRecipeId = initial?.activeRefactorRecipeId ?? null;
    const activeRefactorRecipeId =
      requestedActiveRefactorRecipeId && refactorRecipes.some((recipe) => recipe.id === requestedActiveRefactorRecipeId)
        ? requestedActiveRefactorRecipeId
        : refactorRecipes[0]?.id ?? null;

    this.state = {
      tabs,
      activeTabId,
      accountUsage,
      activeStudyWorkflow: deriveActiveStudyWorkflow(tabs, activeTabId),
      recentStudySources,
      studyHubState,
      smartSets,
      activeSmartSetId,
      refactorRecipes,
      activeRefactorRecipeId,
      runtimeIssue: null,
      authState: hasLogin ? "ready" : "missing_login",
      availableModels: getFallbackModelCatalog(),
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): WorkspaceState {
    return cloneState(this.state);
  }

  getActiveTab(): ConversationTabState | null {
    return this.state.tabs.find((tab) => tab.id === this.state.activeTabId) ?? null;
  }

  serialize(): PersistedWorkspaceState {
    return {
      tabs: this.state.tabs.map((tab) => ({
        id: tab.id,
        title: tab.title,
        draft: tab.draft,
        cwd: tab.cwd,
        studyWorkflow: tab.studyWorkflow,
        instructionChips: tab.instructionChips.map((chip) => ({ ...chip })),
        summary: tab.summary ? { ...tab.summary } : null,
        lineage: { ...tab.lineage },
        targetNotePath: tab.targetNotePath,
        selectionContext: tab.selectionContext ? { ...tab.selectionContext } : null,
        composeMode: tab.composeMode,
        contextPaths: [...tab.contextPaths],
        lastResponseId: tab.lastResponseId,
        sessionItems: tab.sessionItems.map((item) => structuredClone(item)),
        codexThreadId: tab.codexThreadId,
        model: tab.model,
        reasoningEffort: tab.reasoningEffort,
        usageSummary: cloneUsageSummary(tab.usageSummary),
        messages: tab.messages.map((message) => ({
          id: message.id,
          kind: message.kind,
          text: message.text,
          createdAt: message.createdAt,
          meta: message.meta,
        })),
        diffText: tab.diffText,
        toolLog: tab.toolLog.map((entry) => ({ ...entry })),
        patchBasket: tab.patchBasket.map((proposal) => ({ ...proposal })),
        campaigns: tab.campaigns.map((campaign) => structuredClone(campaign)),
      })),
      activeTabId: this.state.activeTabId,
      accountUsage: cloneAccountUsage(this.state.accountUsage),
      activeStudyWorkflow: deriveActiveStudyWorkflow(this.state.tabs, this.state.activeTabId),
      recentStudySources: this.state.recentStudySources.map((source) => ({ ...source })),
      studyHubState: { ...this.state.studyHubState },
      smartSets: this.state.smartSets.map((set) => structuredClone(set)),
      activeSmartSetId: this.state.activeSmartSetId,
      refactorRecipes: this.state.refactorRecipes.map((recipe) => structuredClone(recipe)),
      activeRefactorRecipeId: this.state.activeRefactorRecipeId,
    };
  }

  createTab(cwd: string, title = "New study chat", partial?: Partial<ConversationTabState>): ConversationTabState {
    const status = this.state.authState === "ready" ? "ready" : "missing_login";
    const tab = createTab(cwd, { ...partial, title, status });
    this.mutate((state) => {
      state.tabs.push(tab);
      state.activeTabId = tab.id;
    });
    return tab;
  }

  closeTab(tabId: string, fallbackCwd: string): void {
    this.mutate((state) => {
      state.tabs = state.tabs.filter((tab) => tab.id !== tabId);
      if (state.tabs.length === 0) {
        state.tabs = [
          createTab(fallbackCwd, {
            title: "Study chat",
            status: state.authState === "ready" ? "ready" : "missing_login",
          }),
        ];
      }
      if (state.activeTabId === tabId) {
        state.activeTabId = state.tabs[0]?.id ?? null;
      }
    });
  }

  activateTab(tabId: string): void {
    this.mutate((state) => {
      state.activeTabId = tabId;
      state.activeStudyWorkflow = deriveActiveStudyWorkflow(state.tabs, state.activeTabId);
    });
  }

  setActiveStudyWorkflow(workflow: StudyWorkflowKind | null): void {
    const activeTabId = this.state.activeTabId;
    if (!activeTabId) {
      return;
    }
    this.setTabStudyWorkflow(activeTabId, workflow);
  }

  setTabStudyWorkflow(tabId: string, workflow: StudyWorkflowKind | null): void {
    this.mutate((state) => {
      const tab = state.tabs.find((entry) => entry.id === tabId);
      if (!tab) {
        return;
      }
      tab.studyWorkflow = workflow;
      state.activeStudyWorkflow = deriveActiveStudyWorkflow(state.tabs, state.activeTabId);
    });
  }

  setRecentStudySources(sources: RecentStudySource[]): void {
    this.mutate((state) => {
      state.recentStudySources = sources.map((source) => ({ ...source }));
    });
  }

  addRecentStudySource(source: RecentStudySource, maxItems = 8): void {
    this.mutate((state) => {
      const deduped = state.recentStudySources.filter(
        (entry) => !(entry.kind === source.kind && entry.path === source.path && entry.label === source.label),
      );
      state.recentStudySources = [{ ...source }, ...deduped].slice(0, maxItems);
    });
  }

  setStudyHubState(studyHubState: StudyHubState): void {
    this.mutate((state) => {
      state.studyHubState = { ...studyHubState };
    });
  }

  setAuthState(hasLogin: boolean): void {
    this.mutate((state) => {
      state.authState = hasLogin ? "ready" : "missing_login";
      if (!hasLogin) {
        state.runtimeIssue = "Codex login is not configured.";
      } else if (state.runtimeIssue === "Codex login is not configured.") {
        state.runtimeIssue = null;
      }
      for (const tab of state.tabs) {
        if (tab.status === "missing_login" || (!hasLogin && tab.status === "ready")) {
          tab.status = hasLogin ? "ready" : "missing_login";
        }
      }
    });
  }

  setRuntimeIssue(message: string | null): void {
    this.mutate((state) => {
      state.runtimeIssue = message;
    });
  }

  setAvailableModels(models: ModelCatalogEntry[]): void {
    this.mutate((state) => {
      state.availableModels = models.map((model) => ({
        ...model,
        supportedReasoningLevels: [...model.supportedReasoningLevels],
      }));
    });
  }

  setDraft(tabId: string, draft: string): void {
    this.updateTab(tabId, (tab) => {
      tab.draft = draft;
    });
  }

  setComposeMode(tabId: string, composeMode: ConversationTabState["composeMode"]): void {
    this.updateTab(tabId, (tab) => {
      tab.composeMode = composeMode;
    });
  }

  setActiveTabStudyWorkflow(workflow: StudyWorkflowKind | null): void {
    if (!this.state.activeTabId) {
      return;
    }
    this.setTabStudyWorkflow(this.state.activeTabId, workflow);
  }

  setTargetNotePath(tabId: string, targetNotePath: string | null): void {
    this.updateTab(tabId, (tab) => {
      tab.targetNotePath = targetNotePath;
    });
  }

  setInstructionChips(tabId: string, instructionChips: ConversationTabState["instructionChips"]): void {
    this.updateTab(tabId, (tab) => {
      tab.instructionChips = instructionChips.map((chip) => ({ ...chip }));
    });
  }

  setSummary(tabId: string, summary: ConversationTabState["summary"]): void {
    this.updateTab(tabId, (tab) => {
      tab.summary = summary ? { ...summary } : null;
    });
  }

  setLineage(tabId: string, lineage: ConversationTabState["lineage"]): void {
    this.updateTab(tabId, (tab) => {
      tab.lineage = { ...lineage };
    });
  }

  setSelectionContext(tabId: string, selectionContext: ConversationTabState["selectionContext"]): void {
    this.updateTab(tabId, (tab) => {
      tab.selectionContext = selectionContext ? { ...selectionContext } : null;
    });
  }

  setContextPaths(tabId: string, contextPaths: string[]): void {
    this.updateTab(tabId, (tab) => {
      tab.contextPaths = [...contextPaths];
    });
  }

  setStatus(tabId: string, status: ConversationTabState["status"], error: string | null = null): void {
    this.updateTab(tabId, (tab) => {
      tab.status = status;
      tab.lastError = error;
    });
  }

  setRuntimeMode(tabId: string, runtimeMode: ConversationTabState["runtimeMode"]): void {
    this.updateTab(tabId, (tab) => {
      tab.runtimeMode = runtimeMode;
    });
  }

  setTitle(tabId: string, title: string): void {
    this.updateTab(tabId, (tab) => {
      tab.title = title;
    });
  }

  setLastResponseId(tabId: string, responseId: string | null): void {
    this.updateTab(tabId, (tab) => {
      tab.lastResponseId = responseId;
    });
  }

  setSessionItems(tabId: string, sessionItems: ConversationTabState["sessionItems"]): void {
    this.updateTab(tabId, (tab) => {
      tab.sessionItems = sessionItems.map((item) => structuredClone(item));
    });
  }

  setCodexThreadId(tabId: string, codexThreadId: string | null): void {
    this.updateTab(tabId, (tab) => {
      tab.codexThreadId = codexThreadId;
    });
  }

  setTabModel(tabId: string, model: string): void {
    this.updateTab(tabId, (tab) => {
      tab.model = model;
    });
  }

  setTabReasoningEffort(tabId: string, reasoningEffort: ConversationTabState["reasoningEffort"]): void {
    this.updateTab(tabId, (tab) => {
      tab.reasoningEffort = reasoningEffort;
    });
  }

  setUsageSummary(tabId: string, usageSummary: UsageSummary): void {
    this.updateTab(tabId, (tab) => {
      tab.usageSummary = cloneUsageSummary(usageSummary);
    });
  }

  setAccountUsage(accountUsage: AccountUsageSummary): void {
    this.mutate((state) => {
      state.accountUsage = cloneAccountUsage(accountUsage);
    });
  }

  setSmartSets(smartSets: SmartSet[]): void {
    this.mutate((state) => {
      state.smartSets = smartSets.map((set) => structuredClone(set));
      if (state.activeSmartSetId && !state.smartSets.some((set) => set.id === state.activeSmartSetId)) {
        state.activeSmartSetId = state.smartSets[0]?.id ?? null;
      }
    });
  }

  activateSmartSet(smartSetId: string | null): void {
    this.mutate((state) => {
      state.activeSmartSetId = smartSetId;
    });
  }

  setRefactorRecipes(refactorRecipes: RefactorRecipe[]): void {
    this.mutate((state) => {
      state.refactorRecipes = refactorRecipes.map((recipe) => structuredClone(recipe));
      if (state.activeRefactorRecipeId && !state.refactorRecipes.some((recipe) => recipe.id === state.activeRefactorRecipeId)) {
        state.activeRefactorRecipeId = state.refactorRecipes[0]?.id ?? null;
      }
    });
  }

  activateRefactorRecipe(recipeId: string | null): void {
    this.mutate((state) => {
      state.activeRefactorRecipeId = recipeId;
    });
  }

  upsertRefactorRecipe(recipe: RefactorRecipe): void {
    this.mutate((state) => {
      const index = state.refactorRecipes.findIndex((entry) => entry.id === recipe.id);
      if (index >= 0) {
        state.refactorRecipes[index] = structuredClone(recipe);
      } else {
        state.refactorRecipes.push(structuredClone(recipe));
      }
      state.activeRefactorRecipeId = recipe.id;
    });
  }

  removeRefactorRecipe(recipeId: string): void {
    this.mutate((state) => {
      state.refactorRecipes = state.refactorRecipes.filter((recipe) => recipe.id !== recipeId);
      if (state.activeRefactorRecipeId === recipeId) {
        state.activeRefactorRecipeId = state.refactorRecipes[0]?.id ?? null;
      }
    });
  }

  upsertSmartSet(smartSet: SmartSet): void {
    this.mutate((state) => {
      const index = state.smartSets.findIndex((entry) => entry.id === smartSet.id);
      if (index >= 0) {
        state.smartSets[index] = structuredClone(smartSet);
      } else {
        state.smartSets.push(structuredClone(smartSet));
      }
      state.activeSmartSetId = smartSet.id;
    });
  }

  removeSmartSet(smartSetId: string): void {
    this.mutate((state) => {
      state.smartSets = state.smartSets.filter((set) => set.id !== smartSetId);
      if (state.activeSmartSetId === smartSetId) {
        state.activeSmartSetId = state.smartSets[0]?.id ?? null;
      }
    });
  }

  setWaitingState(tabId: string, waitingState: WaitingState | null): void {
    this.updateTab(tabId, (tab) => {
      tab.waitingState = waitingState ? { ...waitingState } : null;
    });
  }

  resetTab(tabId: string, partial: Partial<ConversationTabState>): void {
    this.mutate((state) => {
      const index = state.tabs.findIndex((entry) => entry.id === tabId);
      if (index < 0) {
        return;
      }
      const current = state.tabs[index];
      if (!current) {
        return;
      }
      state.tabs[index] = createTab(current.cwd, {
        ...current,
        ...partial,
        id: current.id,
        cwd: partial.cwd ?? current.cwd,
      });
    });
  }

  setDiff(tabId: string, diffText: string): void {
    this.updateTab(tabId, (tab) => {
      tab.diffText = diffText;
    });
  }

  setPatchBasket(tabId: string, patchBasket: PatchProposal[]): void {
    this.updateTab(tabId, (tab) => {
      tab.patchBasket = patchBasket.map((proposal) => ({ ...proposal }));
    });
  }

  setCampaigns(tabId: string, campaigns: RefactorCampaign[]): void {
    this.updateTab(tabId, (tab) => {
      tab.campaigns = campaigns.map((campaign) => structuredClone(campaign));
    });
  }

  addMessage(tabId: string, message: ChatMessage): void {
    this.updateTab(tabId, (tab) => {
      tab.messages.push({ ...message });
    });
  }

  upsertMessage(tabId: string, messageId: string, updater: (current: ChatMessage | null) => ChatMessage): void {
    this.updateTab(tabId, (tab) => {
      const index = tab.messages.findIndex((message) => message.id === messageId);
      const current = index >= 0 ? tab.messages[index] ?? null : null;
      const next = updater(current);
      if (index >= 0) {
        tab.messages[index] = next;
      } else {
        tab.messages.push(next);
      }
    });
  }

  addApproval(tabId: string, approval: PendingApproval): void {
    this.updateTab(tabId, (tab) => {
      tab.pendingApprovals.push({ ...approval });
    });
  }

  setApprovals(tabId: string, approvals: PendingApproval[]): void {
    this.updateTab(tabId, (tab) => {
      tab.pendingApprovals = approvals.map((approval) => ({ ...approval }));
    });
  }

  removeApproval(approvalId: string): void {
    this.mutate((state) => {
      for (const tab of state.tabs) {
        tab.pendingApprovals = tab.pendingApprovals.filter((approval) => approval.id !== approvalId);
      }
    });
  }

  clearApprovals(tabId: string): void {
    this.updateTab(tabId, (tab) => {
      tab.pendingApprovals = [];
    });
  }

  replaceProposalApprovals(tabId: string, sourceMessageId: string, approvals: PendingApproval[]): void {
    this.updateTab(tabId, (tab) => {
      const retained = tab.pendingApprovals.filter(
        (approval) => !(approval.transport === "plugin_proposal" && approval.sourceMessageId === sourceMessageId),
      );
      tab.pendingApprovals = [...retained, ...approvals.map((approval) => ({ ...approval }))];
    });
  }

  addToolLog(tabId: string, entry: ToolCallRecord): void {
    this.updateTab(tabId, (tab) => {
      tab.toolLog.push({ ...entry });
    });
  }

  upsertToolLog(tabId: string, callId: string, updater: (current: ToolCallRecord | null) => ToolCallRecord): void {
    this.updateTab(tabId, (tab) => {
      const index = tab.toolLog.findIndex((entry) => entry.callId === callId);
      const current = index >= 0 ? (tab.toolLog[index] ?? null) : null;
      const next = updater(current);
      if (index >= 0) {
        tab.toolLog[index] = { ...next };
      } else {
        tab.toolLog.push({ ...next });
      }
    });
  }

  updateRunningToolLogs(tabId: string, updater: (current: ToolCallRecord) => ToolCallRecord): void {
    this.updateTab(tabId, (tab) => {
      tab.toolLog = tab.toolLog.map((entry) => (entry.status === "running" ? { ...updater(entry) } : entry));
    });
  }

  setSessionApproval(tabId: string, kind: "write" | "shell", allowed: boolean): void {
    this.updateTab(tabId, (tab) => {
      tab.sessionApprovals[kind] = allowed;
    });
  }

  resetSessionApprovals(tabId: string): void {
    this.updateTab(tabId, (tab) => {
      tab.sessionApprovals = { write: false, shell: false };
    });
  }

  replacePatchProposals(tabId: string, sourceMessageId: string, proposals: PatchProposal[]): void {
    this.updateTab(tabId, (tab) => {
      const retained = tab.patchBasket.filter((proposal) => proposal.sourceMessageId !== sourceMessageId);
      tab.patchBasket = [...retained, ...proposals.map((proposal) => ({ ...proposal }))].sort(
        (left, right) => left.createdAt - right.createdAt,
      );
    });
  }

  updatePatchProposal(tabId: string, patchId: string, updater: (proposal: PatchProposal) => PatchProposal): void {
    this.updateTab(tabId, (tab) => {
      tab.patchBasket = tab.patchBasket.map((proposal) => (proposal.id === patchId ? { ...updater(proposal) } : proposal));
    });
  }

  replaceCampaign(tabId: string, sourceMessageId: string, campaign: RefactorCampaign | null): void {
    this.updateTab(tabId, (tab) => {
      const retained = tab.campaigns.filter((entry) => entry.sourceMessageId !== sourceMessageId);
      tab.campaigns = campaign ? [...retained, structuredClone(campaign)] : retained;
    });
  }

  updateCampaign(tabId: string, campaignId: string, updater: (campaign: RefactorCampaign) => RefactorCampaign): void {
    this.updateTab(tabId, (tab) => {
      tab.campaigns = tab.campaigns.map((campaign) => (campaign.id === campaignId ? structuredClone(updater(campaign)) : campaign));
    });
  }

  removeCampaign(tabId: string, campaignId: string): void {
    this.updateTab(tabId, (tab) => {
      tab.campaigns = tab.campaigns.filter((campaign) => campaign.id !== campaignId);
    });
  }

  private updateTab(tabId: string, updater: (tab: ConversationTabState) => void): void {
    this.mutate((state) => {
      const tab = state.tabs.find((entry) => entry.id === tabId);
      if (!tab) {
        return;
      }
      updater(tab);
    });
  }

  private mutate(mutator: (state: WorkspaceState) => void): void {
    const next = cloneState(this.state);
    mutator(next);
    next.activeStudyWorkflow = deriveActiveStudyWorkflow(next.tabs, next.activeTabId);
    this.state = next;
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
