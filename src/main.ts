import { getLanguage, Notice, Plugin, type Command, type Editor, type TFile } from "obsidian";
import { CodexService } from "./app/codexService";
import {
  DEFAULT_PRIMARY_MODEL,
  DEFAULT_SETTINGS,
  type PersistedWorkspaceState,
  type PluginSettings,
  type RecentStudySource,
  type StudyWorkflowKind,
} from "./model/types";
import { coerceModelForPicker, getFallbackModelCatalog } from "./util/models";
import { normalizeComposerAttachments } from "./util/composerAttachments";
import { getLocalizedCopy, normalizeUiLanguageSetting, resolveUiLocale, type SupportedLocale } from "./util/i18n";
import { normalizePermissionMode } from "./util/permissionMode";
import { getCompatibleReasoningEffort, normalizeReasoningEffort } from "./util/reasoning";
import { normalizeConfiguredSkillRoots } from "./util/skillRoots";
import { createEmptyAccountUsageSummary, createEmptyUsageSummary } from "./util/usage";
import { CODEX_VIEW_TYPE, CodexWorkspaceView, LEGACY_CODEX_VIEW_TYPE } from "./views/codexWorkspaceView";
import { PromptModal } from "./views/promptModal";
import { CodexSettingTab } from "./views/settingsTab";

interface PluginDataShape {
  settings?: Partial<PluginSettings>;
  workspace?: PersistedWorkspaceState | null;
}

interface LegacySettingsShape {
  codexCommand?: string;
  defaultModel?: string;
  defaultReasoningEffort?: string;
  permissionMode?: string;
  uiLanguage?: string;
  showReasoning?: boolean;
  autoRestoreTabs?: boolean;
  openAIApiKey?: string;
  approvalPolicy?: string;
  wslShellCommand?: string;
}

interface LegacyTabShape {
  id?: string;
  title?: string;
  draft?: string;
  cwd?: string;
  threadId?: string | null;
  diff?: string;
}

interface LegacyWorkspaceShape {
  tabs?: LegacyTabShape[];
  activeTabId?: string | null;
}

export default class ObsidianCodexPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  private workspaceState: PersistedWorkspaceState | null = null;
  private service!: CodexService;
  private settingTab!: CodexSettingTab;
  private ribbonIconEl: HTMLElement | null = null;
  private readonly localizedCommandIds = new Set<string>();

  override async onload(): Promise<void> {
    await this.loadPluginState();
    this.service = new CodexService(
      this.app,
      () => this.settings,
      () => this.getResolvedLocale(),
      this.workspaceState,
      async (workspace) => {
        this.workspaceState = workspace;
        await this.savePluginState();
      },
      async (nextSettings) => {
        this.settings = nextSettings;
        await this.savePluginState();
        this.refreshRuntimeSettings();
      },
    );

    this.registerView(CODEX_VIEW_TYPE, (leaf) => new CodexWorkspaceView(leaf, this.service, CODEX_VIEW_TYPE));
    this.registerView(LEGACY_CODEX_VIEW_TYPE, (leaf) => new CodexWorkspaceView(leaf, this.service, LEGACY_CODEX_VIEW_TYPE));
    void this.migrateLegacyLeaves();
    this.settingTab = new CodexSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
    this.registerLocalizedUi();

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        if (!editor.getSelection().trim()) {
          return;
        }
        menu.addItem((item) => {
          item
            .setTitle(this.getLocalizedCopy().commands.askAboutSelection)
            .setIcon("sparkles")
            .onClick(() => {
              const file = this.app.workspace.getActiveFile();
              void this.attachSelectionToChat(editor, file);
            });
        });
      }),
    );
  }

  override async onunload(): Promise<void> {
    this.app.workspace.detachLeavesOfType(CODEX_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(LEGACY_CODEX_VIEW_TYPE);
    await this.service?.dispose();
  }

  getResolvedLocale(): SupportedLocale {
    return resolveUiLocale(this.settings.uiLanguage, getLanguage());
  }

  getLocalizedCopy() {
    return getLocalizedCopy(this.getResolvedLocale());
  }

  private getPromptModalCopy() {
    const copy = this.getLocalizedCopy();
    return {
      fieldLabel: copy.prompts.fieldLabel,
      cancel: copy.prompts.cancel,
      send: copy.prompts.send,
    };
  }

  private addLocalizedCommand(command: Command): void {
    this.localizedCommandIds.add(command.id);
    this.addCommand(command);
  }

  private clearLocalizedCommands(): void {
    for (const commandId of this.localizedCommandIds) {
      this.removeCommand(commandId);
    }
    this.localizedCommandIds.clear();
  }

  private registerLocalizedUi(): void {
    const copy = this.getLocalizedCopy();
    const modalCopy = this.getPromptModalCopy();

    this.clearLocalizedCommands();
    this.ribbonIconEl?.remove();
    this.ribbonIconEl = this.addRibbonIcon("sparkles", copy.ribbon.openWorkspace, () => {
      void this.activateView();
    });

    this.addLocalizedCommand({
      id: "open-study-workspace",
      name: copy.commands.openWorkspace,
      callback: () => {
        void this.activateView();
      },
    });

    this.addLocalizedCommand({
      id: "open-ingest-hub",
      name: copy.commands.openIngestHub,
      callback: () => {
        void this.activateView().then((view) => {
          view?.showIngestHubPanel();
        });
      },
    });

    this.addLocalizedCommand({
      id: "new-codex-tab",
      name: copy.commands.newTab,
      callback: () => {
        void this.activateView().then(() => {
          this.service.createTab();
        });
      },
    });

    this.addLocalizedCommand({
      id: "start-lecture-workflow",
      name: copy.commands.startLectureWorkflow,
      callback: () => {
        void this.startStudyWorkflow("lecture");
      },
    });

    this.addLocalizedCommand({
      id: "start-review-workflow",
      name: copy.commands.startReviewWorkflow,
      callback: () => {
        void this.startStudyWorkflow("review");
      },
    });

    this.addLocalizedCommand({
      id: "start-paper-workflow",
      name: copy.commands.startPaperWorkflow,
      callback: () => {
        void this.startStudyWorkflow("paper");
      },
    });

    this.addLocalizedCommand({
      id: "start-homework-workflow",
      name: copy.commands.startHomeworkWorkflow,
      callback: () => {
        void this.startStudyWorkflow("homework");
      },
    });

    this.addLocalizedCommand({
      id: "ask-about-current-note",
      name: copy.commands.askAboutCurrentNote,
      callback: () => {
        void this.activateView().then(() => {
          const tab = this.service.getActiveTab() ?? this.service.createTab();
          if (!tab) {
            return;
          }
          new PromptModal(
            this.app,
            copy.prompts.askAboutThisNoteTitle,
            copy.prompts.askAboutThisNotePlaceholder,
            (value) => {
              const editor = this.app.workspace.activeEditor?.editor ?? null;
              const file = this.app.workspace.getActiveFile();
              void this.service.askAboutCurrentNote(tab.id, value, file, editor);
            },
            copy.prompts.askAboutThisNoteDescription,
            modalCopy,
          ).open();
        });
      },
    });

    this.addLocalizedCommand({
      id: "ask-about-selection",
      name: copy.commands.askAboutSelection,
      callback: () => {
        const editor = this.app.workspace.activeEditor?.editor ?? null;
        const file = this.app.workspace.getActiveFile();
        if (!editor?.getSelection().trim()) {
          new Notice(copy.notices.selectTextFirst);
          return;
        }
        void this.attachSelectionToChat(editor, file);
      },
    });

    this.addLocalizedCommand({
      id: "attach-local-file",
      name: copy.commands.attachLocalFile,
      callback: () => {
        void this.activateView().then((view) => {
          view?.openAttachmentPicker();
        });
      },
    });

    this.addLocalizedCommand({
      id: "apply-latest-codex-patch",
      name: copy.commands.applyLatestPatch,
      callback: () => {
        const tab = this.service.getActiveTab();
        const latest = tab?.patchBasket.filter((entry) => entry.status === "pending" || entry.status === "conflicted").at(-1) ?? null;
        if (!tab || !latest) {
          new Notice(copy.notices.noPendingPatch);
          return;
        }
        void this.service.applyPatchProposal(tab.id, latest.id).catch((error: unknown) => {
          new Notice((error as Error).message);
        });
      },
    });

    this.addLocalizedCommand({
      id: "reject-latest-codex-patch",
      name: copy.commands.rejectLatestPatch,
      callback: () => {
        const tab = this.service.getActiveTab();
        const latest = tab?.patchBasket.filter((entry) => entry.status === "pending" || entry.status === "conflicted").at(-1) ?? null;
        if (!tab || !latest) {
          new Notice(copy.notices.noPendingPatch);
          return;
        }
        this.service.rejectPatchProposal(tab.id, latest.id);
      },
    });

    this.addLocalizedCommand({
      id: "open-latest-codex-patch-target",
      name: copy.commands.openLatestPatchTarget,
      callback: () => {
        const tab = this.service.getActiveTab();
        const latest = tab?.patchBasket.at(-1) ?? null;
        if (!tab || !latest) {
          new Notice(copy.notices.noPatchTarget);
          return;
        }
        void this.service.openPatchTarget(tab.id, latest.id).catch((error: unknown) => {
          new Notice((error as Error).message);
        });
      },
    });

    this.addLocalizedCommand({
      id: "interrupt-active-turn",
      name: copy.commands.interruptActiveTurn,
      callback: () => {
        const tab = this.service.getActiveTab();
        if (tab) {
          void this.service.interruptActiveTurn(tab.id);
        }
      },
    });

    this.addLocalizedCommand({
      id: "toggle-plan-mode",
      name: copy.commands.togglePlanMode,
      callback: () => {
        void this.activateView().then(() => {
          const tab = this.service.getActiveTab() ?? this.service.createTab();
          if (!tab) {
            return;
          }
          this.service.toggleTabComposeMode(tab.id);
        });
      },
    });

    this.addLocalizedCommand({
      id: "fork-codex-conversation",
      name: copy.commands.forkConversation,
      callback: () => {
        void this.activateView().then(() => {
          const tab = this.service.getActiveTab();
          if (!tab) {
            return;
          }
          if (!this.service.forkTab(tab.id)) {
            new Notice(copy.notices.cannotForkConversation);
          }
        });
      },
    });

    this.addLocalizedCommand({
      id: "resume-codex-thread",
      name: copy.commands.resumeThread,
      callback: () => {
        void this.activateView().then(() => {
          const tab = this.service.getActiveTab();
          if (!tab) {
            return;
          }
          if (!this.service.resumeTab(tab.id)) {
            new Notice(copy.notices.noResumableThread);
          }
        });
      },
    });

    this.addLocalizedCommand({
      id: "compact-codex-conversation",
      name: copy.commands.compactConversation,
      callback: () => {
        void this.activateView().then(() => {
          const tab = this.service.getActiveTab();
          if (!tab) {
            return;
          }
          this.service.compactTab(tab.id);
        });
      },
    });

    this.addLocalizedCommand({
      id: "create-smart-set",
      name: copy.commands.createSmartSet,
      callback: () => {
        void this.activateView().then((view) => {
          new PromptModal(
            this.app,
            copy.prompts.createSmartSetTitle,
            copy.prompts.createSmartSetPlaceholder,
            (value) => {
              const tabId = this.service.getActiveTab()?.id ?? null;
              void this.service
                .createSmartSetFromPrompt(value, tabId)
                .then(() => view?.showSmartSetPanel())
                .catch((error: unknown) => {
                  new Notice((error as Error).message);
                });
            },
            copy.prompts.createSmartSetDescription,
            modalCopy,
          ).open();
        });
      },
    });

    this.addLocalizedCommand({
      id: "open-smart-set-panel",
      name: copy.commands.openSmartSetPanel,
      callback: () => {
        void this.activateView().then((view) => {
          view?.showSmartSetPanel();
        });
      },
    });

    this.addLocalizedCommand({
      id: "run-active-smart-set",
      name: copy.commands.runActiveSmartSet,
      callback: () => {
        const smartSetId = this.service.getActiveSmartSetId();
        if (!smartSetId) {
          new Notice(copy.notices.noActiveSmartSet);
          return;
        }
        const tabId = this.service.getActiveTab()?.id ?? null;
        void this.service.runSmartSet(smartSetId, tabId).catch((error: unknown) => {
          new Notice((error as Error).message);
        });
      },
    });

    this.addLocalizedCommand({
      id: "pin-current-note-to-codex-context",
      name: copy.commands.pinCurrentNote,
      callback: () => {
        const tab = this.service.getActiveTab() ?? this.service.createTab();
        if (!tab) {
          return;
        }
        const file = this.app.workspace.getActiveFile();
        void this.service.addCurrentNoteToContext(tab.id, file).catch((error: unknown) => {
          new Notice((error as Error).message);
        });
      },
    });

    this.addLocalizedCommand({
      id: "pin-daily-note-to-codex-context",
      name: copy.commands.pinDailyNote,
      callback: () => {
        const tab = this.service.getActiveTab() ?? this.service.createTab();
        if (!tab) {
          return;
        }
        void this.service.addDailyNoteToContext(tab.id).catch((error: unknown) => {
          new Notice((error as Error).message);
        });
      },
    });

    this.addLocalizedCommand({
      id: "clear-codex-context-pack",
      name: copy.commands.clearContextPack,
      callback: () => {
        const tab = this.service.getActiveTab();
        if (!tab) {
          return;
        }
        this.service.clearContextPack(tab.id);
      },
    });
  }

  refreshRuntimeSettings(): void {
    this.service?.refreshSettings();
    this.registerLocalizedUi();
    this.settingTab?.display();
    for (const leaf of [...this.app.workspace.getLeavesOfType(CODEX_VIEW_TYPE), ...this.app.workspace.getLeavesOfType(LEGACY_CODEX_VIEW_TYPE)]) {
      if (leaf.view instanceof CodexWorkspaceView) {
        leaf.view.refreshLocalization();
      }
    }
  }

  async savePluginState(): Promise<void> {
    this.workspaceState = this.service?.store.serialize() ?? this.workspaceState;
    await this.saveData({
      settings: this.settings,
      workspace: this.workspaceState,
    } satisfies PluginDataShape);
  }

  private async loadPluginState(): Promise<void> {
    const data = (await this.loadData()) as (PluginDataShape & {
      settings?: Partial<PluginSettings> & LegacySettingsShape;
      workspace?: PersistedWorkspaceState | LegacyWorkspaceShape | null;
    }) | null;
    const legacySettings = data?.settings ?? {};
    const legacyCommand = legacySettings.codexCommand?.trim() ?? "";
    const modelCatalog = getFallbackModelCatalog();
    const configuredDefaultModel = data?.settings?.defaultModel?.trim() || legacySettings.defaultModel?.trim() || DEFAULT_SETTINGS.defaultModel;
    const configuredCodexModel = data?.settings?.codex?.model?.trim() || legacySettings.defaultModel?.trim() || DEFAULT_SETTINGS.codex.model;
    const usesLegacyDefaultPair = configuredDefaultModel === "gpt-5" && configuredCodexModel === "gpt-5.1-codex";
    const rawModel = usesLegacyDefaultPair ? DEFAULT_SETTINGS.codex.model : configuredCodexModel;
    const model = coerceModelForPicker(modelCatalog, rawModel || DEFAULT_PRIMARY_MODEL);
    const command =
      data?.settings?.codex?.command?.trim() ||
      legacyCommand ||
      DEFAULT_SETTINGS.codex.command;
    const configuredDefaultReasoningEffort =
      normalizeReasoningEffort(
        typeof data?.settings?.defaultReasoningEffort === "string"
          ? data?.settings?.defaultReasoningEffort
          : legacySettings.defaultReasoningEffort,
      ) ?? DEFAULT_SETTINGS.defaultReasoningEffort;
    const configuredPermissionMode = normalizePermissionMode(
      typeof data?.settings?.permissionMode === "string"
        ? data.settings.permissionMode
        : legacySettings.permissionMode,
    );
    const configuredUiLanguage =
      normalizeUiLanguageSetting(typeof data?.settings?.uiLanguage === "string" ? data.settings.uiLanguage : legacySettings.uiLanguage) ??
      DEFAULT_SETTINGS.uiLanguage;
    const settings = data?.settings ?? {};

    this.settings = {
      defaultModel: coerceModelForPicker(modelCatalog, usesLegacyDefaultPair ? DEFAULT_SETTINGS.defaultModel : configuredDefaultModel),
      defaultReasoningEffort: getCompatibleReasoningEffort(model, configuredDefaultReasoningEffort) ?? configuredDefaultReasoningEffort,
      permissionMode: configuredPermissionMode ?? (data ? "full-auto" : DEFAULT_SETTINGS.permissionMode),
      uiLanguage: configuredUiLanguage,
      extraSkillRoots: normalizeConfiguredSkillRoots(Array.isArray(settings.extraSkillRoots) ? settings.extraSkillRoots : []),
      showReasoning: settings.showReasoning ?? legacySettings.showReasoning ?? DEFAULT_SETTINGS.showReasoning,
      autoRestoreTabs: settings.autoRestoreTabs ?? legacySettings.autoRestoreTabs ?? DEFAULT_SETTINGS.autoRestoreTabs,
      codex: {
        ...DEFAULT_SETTINGS.codex,
        model,
        command,
      },
    };
    this.workspaceState = this.migrateWorkspace(data?.workspace ?? null);
  }

  private migrateWorkspace(input: PersistedWorkspaceState | LegacyWorkspaceShape | null): PersistedWorkspaceState | null {
    if (!input || !Array.isArray(input.tabs)) {
      return null;
    }

    const persistedWorkspace = input as Partial<PersistedWorkspaceState>;
    const modelCatalog = getFallbackModelCatalog();
    const fallbackModel = coerceModelForPicker(
      modelCatalog,
      this.settings.codex.model.trim() || this.settings.defaultModel.trim() || DEFAULT_SETTINGS.codex.model,
    );
    const fallbackReasoningEffort =
      getCompatibleReasoningEffort(fallbackModel, this.settings.defaultReasoningEffort) ?? this.settings.defaultReasoningEffort;

    return {
      tabs: input.tabs
        .filter((tab): tab is PersistedWorkspaceState["tabs"][number] | LegacyTabShape => Boolean(tab && typeof tab === "object"))
        .map((tab) => {
          const persisted = tab as PersistedWorkspaceState["tabs"][number];
          const model = coerceModelForPicker(
            modelCatalog,
            ("model" in tab && typeof persisted.model === "string" && persisted.model.trim()) || fallbackModel,
          );
          const reasoningEffort =
            getCompatibleReasoningEffort(
              model,
              "reasoningEffort" in tab ? normalizeReasoningEffort(String(persisted.reasoningEffort)) : fallbackReasoningEffort,
            ) ?? fallbackReasoningEffort;

          return {
            id: typeof tab.id === "string" ? tab.id : `tab-${Date.now()}`,
            title: typeof tab.title === "string" ? tab.title : "Study",
            draft: typeof tab.draft === "string" ? tab.draft : "",
            cwd: typeof tab.cwd === "string" ? tab.cwd : "",
            studyWorkflow:
              "studyWorkflow" in tab
                ? this.coerceStudyWorkflow(persisted.studyWorkflow)
                : null,
            instructionChips: Array.isArray("instructionChips" in tab ? persisted.instructionChips : undefined)
              ? persisted.instructionChips
                  .filter((chip): chip is NonNullable<typeof persisted.instructionChips>[number] => Boolean(chip && typeof chip === "object"))
                  .map((chip) => ({
                    id: typeof chip.id === "string" ? chip.id : `instruction-${Date.now()}`,
                    label: typeof chip.label === "string" ? chip.label : "",
                    createdAt: typeof chip.createdAt === "number" ? chip.createdAt : Date.now(),
                  }))
              : [],
            summary:
              "summary" in tab && persisted.summary && typeof persisted.summary === "object" && typeof persisted.summary.text === "string"
                ? {
                    id: typeof persisted.summary.id === "string" ? persisted.summary.id : `summary-${Date.now()}`,
                    text: persisted.summary.text,
                    createdAt: typeof persisted.summary.createdAt === "number" ? persisted.summary.createdAt : Date.now(),
                  }
                : null,
            lineage:
              "lineage" in tab && persisted.lineage && typeof persisted.lineage === "object"
                ? {
                    parentTabId: typeof persisted.lineage.parentTabId === "string" ? persisted.lineage.parentTabId : null,
                    forkedFromThreadId:
                      typeof persisted.lineage.forkedFromThreadId === "string" ? persisted.lineage.forkedFromThreadId : null,
                    resumedFromThreadId:
                      typeof persisted.lineage.resumedFromThreadId === "string" ? persisted.lineage.resumedFromThreadId : null,
                    compactedAt: typeof persisted.lineage.compactedAt === "number" ? persisted.lineage.compactedAt : null,
                  }
                : {
                    parentTabId: null,
                    forkedFromThreadId: null,
                    resumedFromThreadId: null,
                    compactedAt: null,
                  },
            targetNotePath:
              "targetNotePath" in tab && typeof persisted.targetNotePath === "string" && persisted.targetNotePath.trim()
                ? persisted.targetNotePath
                : null,
            selectionContext:
              "selectionContext" in tab &&
              persisted.selectionContext &&
              typeof persisted.selectionContext === "object" &&
              typeof persisted.selectionContext.text === "string" &&
              persisted.selectionContext.text.trim()
                ? {
                    text: persisted.selectionContext.text,
                    sourcePath: typeof persisted.selectionContext.sourcePath === "string" ? persisted.selectionContext.sourcePath : null,
                    createdAt:
                      typeof persisted.selectionContext.createdAt === "number" ? persisted.selectionContext.createdAt : Date.now(),
                  }
                : null,
            composeMode: ("composeMode" in tab && persisted.composeMode === "plan" ? "plan" : "chat") as "plan" | "chat",
            contextPaths: Array.isArray("contextPaths" in tab ? persisted.contextPaths : undefined) ? [...persisted.contextPaths] : [],
            lastResponseId: "lastResponseId" in tab && typeof persisted.lastResponseId === "string" ? persisted.lastResponseId : null,
            sessionItems: normalizeComposerAttachments("sessionItems" in tab ? persisted.sessionItems : undefined),
            codexThreadId:
              "codexThreadId" in tab && typeof persisted.codexThreadId === "string"
                ? persisted.codexThreadId
                : "threadId" in tab && typeof tab.threadId === "string"
                  ? tab.threadId
                  : null,
            model,
            reasoningEffort,
            usageSummary:
              "usageSummary" in tab && persisted.usageSummary
                ? {
                    lastTurn: persisted.usageSummary.lastTurn ? { ...persisted.usageSummary.lastTurn } : null,
                    total: persisted.usageSummary.total ? { ...persisted.usageSummary.total } : null,
                    limits: {
                      fiveHourPercent: persisted.usageSummary.limits?.fiveHourPercent ?? null,
                      weekPercent: persisted.usageSummary.limits?.weekPercent ?? null,
                      planType: persisted.usageSummary.limits?.planType ?? null,
                    },
                  }
                : createEmptyUsageSummary(),
            messages: Array.isArray(("messages" in tab ? persisted.messages : undefined)) ? [...persisted.messages] : [],
            diffText:
              "diffText" in tab && typeof persisted.diffText === "string"
                ? persisted.diffText
                : "diff" in tab && typeof tab.diff === "string"
                  ? tab.diff
                  : "",
            toolLog: Array.isArray("toolLog" in tab ? persisted.toolLog : undefined) ? [...persisted.toolLog] : [],
            patchBasket: Array.isArray("patchBasket" in tab ? persisted.patchBasket : undefined) ? [...persisted.patchBasket] : [],
            campaigns: Array.isArray("campaigns" in tab ? persisted.campaigns : undefined) ? [...persisted.campaigns] : [],
          };
        })
        .map((tab, index, tabs) => {
          if (tab.studyWorkflow) {
            return tab;
          }
          const legacyActiveWorkflow = this.coerceStudyWorkflow((persistedWorkspace as Partial<PersistedWorkspaceState>).activeStudyWorkflow);
          if (!legacyActiveWorkflow) {
            return tab;
          }
          const activeTabId = typeof input.activeTabId === "string" ? input.activeTabId : null;
          const hasAnyWorkflow = tabs.some((entry) => Boolean(entry.studyWorkflow));
          if (hasAnyWorkflow) {
            return tab;
          }
          const isActiveTab = activeTabId ? tab.id === activeTabId : index === 0;
          return isActiveTab ? { ...tab, studyWorkflow: legacyActiveWorkflow } : tab;
        }),
      activeTabId: typeof input.activeTabId === "string" ? input.activeTabId : null,
      accountUsage:
        "accountUsage" in input &&
        input.accountUsage &&
        typeof input.accountUsage === "object" &&
        "limits" in input.accountUsage
          ? {
              limits: {
                fiveHourPercent:
                  typeof input.accountUsage.limits?.fiveHourPercent === "number" ? input.accountUsage.limits.fiveHourPercent : null,
                weekPercent: typeof input.accountUsage.limits?.weekPercent === "number" ? input.accountUsage.limits.weekPercent : null,
                planType: typeof input.accountUsage.limits?.planType === "string" ? input.accountUsage.limits.planType : null,
              },
              source:
                input.accountUsage.source === "live" ||
                input.accountUsage.source === "session_backfill" ||
                input.accountUsage.source === "restored"
                  ? input.accountUsage.source
                  : "restored",
              updatedAt: typeof input.accountUsage.updatedAt === "number" ? input.accountUsage.updatedAt : null,
              threadId: typeof input.accountUsage.threadId === "string" ? input.accountUsage.threadId : null,
            }
          : createEmptyAccountUsageSummary(),
      smartSets: ((Array.isArray(persistedWorkspace.smartSets) ? persistedWorkspace.smartSets : []) as unknown as Array<Record<string, unknown>>)
        .filter((entry: Record<string, unknown>) => Boolean(entry && typeof entry === "object"))
        .map((entry: Record<string, unknown>) => ({
          id: typeof entry.id === "string" ? entry.id : `smart-set-${Date.now()}`,
          title: typeof entry.title === "string" ? entry.title : "Smart Set",
          naturalQuery: typeof entry.naturalQuery === "string" ? entry.naturalQuery : "",
          normalizedQuery:
            typeof entry.normalizedQuery === "string"
              ? entry.normalizedQuery
              : "{\n  \"includeText\": [],\n  \"excludeText\": [],\n  \"pathIncludes\": [],\n  \"pathExcludes\": [],\n  \"tags\": [],\n  \"properties\": []\n}",
          savedNotePath: typeof entry.savedNotePath === "string" ? entry.savedNotePath : null,
          liveResult:
            entry.liveResult && typeof entry.liveResult === "object"
              ? {
                  items: Array.isArray((entry.liveResult as { items?: unknown[] }).items)
                    ? ((entry.liveResult as { items: unknown[] }).items)
                        .filter((item: unknown): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
                        .map((item: Record<string, unknown>) => ({
                          path: typeof item.path === "string" ? item.path : "",
                          title: typeof item.title === "string" ? item.title : "",
                          excerpt: typeof item.excerpt === "string" ? item.excerpt : "",
                          mtime: typeof item.mtime === "number" ? item.mtime : null,
                          size: typeof item.size === "number" ? item.size : null,
                          score: typeof item.score === "number" ? item.score : 0,
                        }))
                    : [],
                  count: typeof (entry.liveResult as { count?: unknown }).count === "number" ? (entry.liveResult as { count: number }).count : 0,
                  generatedAt:
                    typeof (entry.liveResult as { generatedAt?: unknown }).generatedAt === "number"
                      ? (entry.liveResult as { generatedAt: number }).generatedAt
                      : Date.now(),
                }
              : null,
          lastSnapshot:
            entry.lastSnapshot && typeof entry.lastSnapshot === "object" && (entry.lastSnapshot as { result?: unknown }).result
              ? {
                  result: {
                    items: Array.isArray(((entry.lastSnapshot as { result: { items?: unknown[] } }).result).items)
                      ? (((entry.lastSnapshot as { result: { items: unknown[] } }).result).items)
                          .filter((item: unknown): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
                          .map((item: Record<string, unknown>) => ({
                            path: typeof item.path === "string" ? item.path : "",
                            title: typeof item.title === "string" ? item.title : "",
                            excerpt: typeof item.excerpt === "string" ? item.excerpt : "",
                            mtime: typeof item.mtime === "number" ? item.mtime : null,
                            size: typeof item.size === "number" ? item.size : null,
                            score: typeof item.score === "number" ? item.score : 0,
                          }))
                      : [],
                    count:
                      typeof (((entry.lastSnapshot as { result: { count?: unknown } }).result).count) === "number"
                        ? (((entry.lastSnapshot as { result: { count: number } }).result).count)
                        : 0,
                    generatedAt:
                      typeof (((entry.lastSnapshot as { result: { generatedAt?: unknown } }).result).generatedAt) === "number"
                        ? (((entry.lastSnapshot as { result: { generatedAt: number } }).result).generatedAt)
                        : Date.now(),
                  },
                  createdAt:
                    typeof (entry.lastSnapshot as { createdAt?: unknown }).createdAt === "number"
                      ? (entry.lastSnapshot as { createdAt: number }).createdAt
                      : Date.now(),
                  reason:
                    (entry.lastSnapshot as { reason?: unknown }).reason === "manual" ||
                    (entry.lastSnapshot as { reason?: unknown }).reason === "drift" ||
                    (entry.lastSnapshot as { reason?: unknown }).reason === "campaign"
                      ? ((entry.lastSnapshot as { reason: "manual" | "drift" | "campaign" }).reason)
                      : "manual",
                }
              : null,
          lastDrift:
            entry.lastDrift && typeof entry.lastDrift === "object"
              ? {
                  added: Array.isArray((entry.lastDrift as { added?: unknown[] }).added) ? [...((entry.lastDrift as { added: [] }).added)] : [],
                  removed: Array.isArray((entry.lastDrift as { removed?: unknown[] }).removed)
                    ? [...((entry.lastDrift as { removed: [] }).removed)]
                    : [],
                  changed: Array.isArray((entry.lastDrift as { changed?: unknown[] }).changed)
                    ? [...((entry.lastDrift as { changed: [] }).changed)]
                    : [],
                  comparedAt:
                    typeof (entry.lastDrift as { comparedAt?: unknown }).comparedAt === "number"
                      ? (entry.lastDrift as { comparedAt: number }).comparedAt
                      : Date.now(),
                }
              : null,
          lastRunAt: typeof entry.lastRunAt === "number" ? entry.lastRunAt : null,
          createdAt: typeof entry.createdAt === "number" ? entry.createdAt : Date.now(),
          updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : Date.now(),
        })),
      activeSmartSetId: typeof persistedWorkspace.activeSmartSetId === "string" ? persistedWorkspace.activeSmartSetId : null,
      activeStudyWorkflow: this.coerceStudyWorkflow((persistedWorkspace as Partial<PersistedWorkspaceState>).activeStudyWorkflow),
      recentStudySources: this.normalizeRecentStudySources((persistedWorkspace as Partial<PersistedWorkspaceState>).recentStudySources),
      studyHubState: {
        lastOpenedAt:
          typeof (persistedWorkspace as Partial<PersistedWorkspaceState>).studyHubState?.lastOpenedAt === "number"
            ? ((persistedWorkspace as Partial<PersistedWorkspaceState>).studyHubState?.lastOpenedAt as number)
            : null,
        isCollapsed: Boolean((persistedWorkspace as Partial<PersistedWorkspaceState>).studyHubState?.isCollapsed),
      },
      refactorRecipes: ((Array.isArray((persistedWorkspace as Partial<PersistedWorkspaceState>).refactorRecipes)
        ? (persistedWorkspace as Partial<PersistedWorkspaceState>).refactorRecipes
        : []) as unknown as Array<Record<string, unknown>>)
        .filter((entry: Record<string, unknown>) => Boolean(entry && typeof entry === "object"))
        .map((entry: Record<string, unknown>) => ({
          id: typeof entry.id === "string" ? entry.id : `recipe-${Date.now()}`,
          title: typeof entry.title === "string" ? entry.title : "Refactor Recipe",
          description: typeof entry.description === "string" ? entry.description : "",
          sourceCampaignId: typeof entry.sourceCampaignId === "string" ? entry.sourceCampaignId : "",
          sourceCampaignTitle: typeof entry.sourceCampaignTitle === "string" ? entry.sourceCampaignTitle : "Refactor Campaign",
          sourceQuery: typeof entry.sourceQuery === "string" ? entry.sourceQuery : "",
          preferredScopeKind:
            entry.preferredScopeKind === "current_note" ||
            entry.preferredScopeKind === "search_query" ||
            entry.preferredScopeKind === "smart_set"
              ? entry.preferredScopeKind
              : "search_query",
          operationKinds: Array.isArray(entry.operationKinds)
            ? entry.operationKinds.filter(
                (kind): kind is "rename" | "move" | "property_set" | "property_remove" | "task_update" | "update" | "create" =>
                  kind === "rename" ||
                  kind === "move" ||
                  kind === "property_set" ||
                  kind === "property_remove" ||
                  kind === "task_update" ||
                  kind === "update" ||
                  kind === "create",
              )
            : [],
          examples: Array.isArray(entry.examples)
            ? entry.examples
                .filter((example): example is Record<string, unknown> => Boolean(example && typeof example === "object"))
                .map((example) => ({
                  kind: example.kind === "patch" ? "patch" : "vault_op",
                  operationKind:
                    example.operationKind === "rename" ||
                    example.operationKind === "move" ||
                    example.operationKind === "property_set" ||
                    example.operationKind === "property_remove" ||
                    example.operationKind === "task_update" ||
                    example.operationKind === "update" ||
                    example.operationKind === "create"
                      ? example.operationKind
                      : "rename",
                  title: typeof example.title === "string" ? example.title : "",
                  summary: typeof example.summary === "string" ? example.summary : "",
                  targetPath: typeof example.targetPath === "string" ? example.targetPath : "",
                  destinationPath: typeof example.destinationPath === "string" ? example.destinationPath : null,
                }))
            : [],
          createdAt: typeof entry.createdAt === "number" ? entry.createdAt : Date.now(),
          updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : Date.now(),
        })),
      activeRefactorRecipeId:
        typeof (persistedWorkspace as Partial<PersistedWorkspaceState>).activeRefactorRecipeId === "string"
          ? ((persistedWorkspace as Partial<PersistedWorkspaceState>).activeRefactorRecipeId as string)
          : null,
    };
  }

  private coerceStudyWorkflow(value: unknown): StudyWorkflowKind | null {
    if (value === "lecture" || value === "review" || value === "paper" || value === "homework") {
      return value;
    }
    return null;
  }

  private normalizeRecentStudySources(value: unknown): RecentStudySource[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object"))
      .map((entry) => ({
        id: typeof entry.id === "string" ? entry.id : `study-source-${Date.now()}`,
        label: typeof entry.label === "string" ? entry.label : "",
        path: typeof entry.path === "string" ? entry.path : null,
        kind:
          entry.kind === "note" || entry.kind === "attachment" || entry.kind === "smart_set" || entry.kind === "selection"
            ? entry.kind
            : "note",
        createdAt: typeof entry.createdAt === "number" ? entry.createdAt : Date.now(),
      }));
  }

  private async activateView(): Promise<CodexWorkspaceView | null> {
    const legacyLeaf = this.app.workspace.getLeavesOfType(LEGACY_CODEX_VIEW_TYPE)[0] ?? null;
    const leaf = this.app.workspace.getLeavesOfType(CODEX_VIEW_TYPE)[0] ?? legacyLeaf ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) {
      throw new Error(this.getLocalizedCopy().notices.noOpenLeaf);
    }

    await leaf.setViewState({
      type: CODEX_VIEW_TYPE,
      active: true,
    });
    this.app.workspace.revealLeaf(leaf);
    return leaf.view instanceof CodexWorkspaceView ? leaf.view : null;
  }

  private async attachSelectionToChat(editor: Editor, file: TFile | null): Promise<void> {
    const selection = editor.getSelection().trim();
    if (!selection) {
      new Notice(this.getLocalizedCopy().notices.selectTextFirst);
      return;
    }

    const view = await this.activateView();
    const tab = this.service.getActiveTab() ?? this.service.createTab();
    if (!tab) {
      return;
    }
    if (!this.service.captureSelectionContext(tab.id, file, editor)) {
      new Notice(this.getLocalizedCopy().notices.selectTextFirst);
      return;
    }
    view?.focusComposer();
  }

  private async startStudyWorkflow(kind: StudyWorkflowKind): Promise<void> {
    const view = await this.activateView();
    const tab = this.service.getActiveTab() ?? this.service.createTab();
    if (!tab) {
      return;
    }

    this.service.startStudyWorkflow(tab.id, kind, this.app.workspace.getActiveFile());
    view?.showIngestHubPanel();
    view?.focusComposer();
  }

  private async migrateLegacyLeaves(): Promise<void> {
    const legacyLeaves = this.app.workspace.getLeavesOfType(LEGACY_CODEX_VIEW_TYPE);
    for (const leaf of legacyLeaves) {
      const state = leaf.getViewState();
      await leaf.setViewState({
        ...state,
        type: CODEX_VIEW_TYPE,
      });
    }
  }
}
