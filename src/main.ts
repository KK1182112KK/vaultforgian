import { homedir } from "node:os";
import { getLanguage, Notice, Plugin, type Command, type Editor, type TFile } from "obsidian";
import { CodexService } from "./app/codexService";
import {
  DEFAULT_LOCAL_SETTINGS,
  DEFAULT_PRIMARY_MODEL,
  DEFAULT_SETTINGS,
  DEFAULT_VAULT_SETTINGS,
  type LocalSettings,
  type PersistedWorkspaceState,
  type PluginSettings,
  type RecentStudySource,
  type StudyRecipe,
  type StudyRecipeWorkflowKind,
  type StudyWorkflowKind,
  type VaultSettings,
} from "./model/types";
import { coerceModelForPicker, getFallbackModelCatalog } from "./util/models";
import { getLocalizedCopy, normalizeUiLanguageSetting, resolveUiLocale, type SupportedLocale } from "./util/i18n";
import { PatchConflictError } from "./util/patchConflicts";
import {
  DEFAULT_CODEX_EXECUTABLE,
  isUnsafeCodexExecutablePath,
  migrateLegacyCodexLauncher,
  normalizeCodexRuntime,
  sanitizeCodexExecutablePath,
} from "./util/codexLauncher";
import { normalizePermissionMode } from "./util/permissionMode";
import { PERMISSION_ONBOARDING_VERSION } from "./util/permissionLifecycle";
import { getCompatibleReasoningEffort, normalizeReasoningEffort } from "./util/reasoning";
import { getStudyWorkflowDefinition } from "./util/studyWorkflows";
import {
  clampMaxChatTabs,
  combineSettings,
  extractLocalSettings,
  extractVaultSettings,
  normalizeLocalSettings,
  normalizeLineList,
  normalizeTabBarPosition,
  readLocalSettingsFile,
  writeLocalSettingsFile,
} from "./util/pluginSettings";
import { createEmptyAccountUsageSummary, createEmptyUsageSummary } from "./util/usage";
import { CODEX_VIEW_TYPE, CodexWorkspaceView, LEGACY_CODEX_VIEW_TYPE } from "./views/codexWorkspaceView";
import { openPatchConflictModal } from "./views/patchConflictUi";
import { PermissionOnboardingModal } from "./views/permissionModals";
import { PromptModal } from "./views/promptModal";
import { CodexSettingTab } from "./views/settingsTab";

interface PluginDataShape {
  settings?: Partial<VaultSettings>;
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

const LEGACY_DEFAULT_LINKED_PANEL_SKILLS: Record<StudyWorkflowKind, string[]> = {
  lecture: ["lecture-read"],
  review: [],
  paper: ["deep-read"],
  homework: ["homework"],
};

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
  private blockedLegacyLauncherCommand: string | null = null;

  override async onload(): Promise<void> {
    await this.loadPluginState();
    if (this.blockedLegacyLauncherCommand) {
      new Notice(this.getLocalizedCopy().notices.blockedLegacyLauncherNotice);
    }
    this.service = new CodexService(
      this.app,
      () => this.settings,
      () => this.getResolvedLocale(),
      this.settings.autoRestoreTabs ? this.workspaceState : null,
      async (workspace) => {
        this.workspaceState = workspace;
        await this.savePluginState();
      },
      async (nextSettings) => {
        this.settings = nextSettings;
        await this.saveAllSettings();
        this.refreshRuntimeSettings();
      },
    );

    this.registerView(CODEX_VIEW_TYPE, (leaf) => new CodexWorkspaceView(leaf, this.service, CODEX_VIEW_TYPE));
    this.registerView(LEGACY_CODEX_VIEW_TYPE, (leaf) => new CodexWorkspaceView(leaf, this.service, LEGACY_CODEX_VIEW_TYPE));
    void this.migrateLegacyLeaves();
    this.settingTab = new CodexSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
    this.registerLocalizedUi();
    void this.refreshOpenWorkspaceLeaves();
    this.app.workspace.onLayoutReady(() => {
      void this.refreshOpenWorkspaceLeaves().finally(() => {
        this.maybeShowPermissionOnboarding();
      });
    });

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

  getRuntimeIssue(): string | null {
    const runtimeIssue = this.service?.getRuntimeIssue() ?? null;
    const blockedLegacyWarning = this.blockedLegacyLauncherCommand
      ? this.getLocalizedCopy().settings.blockedLegacyLauncherWarning(this.blockedLegacyLauncherCommand)
      : null;
    const issues = [blockedLegacyWarning, runtimeIssue].filter((issue): issue is string => Boolean(issue?.trim()));
    return issues.length > 0 ? issues.join("\n\n") : null;
  }

  getAuthState(): "ready" | "missing_login" {
    return this.service?.getAuthState() ?? "missing_login";
  }

  getRuntimeStatusSummaryParts(): string[] {
    return this.service?.getRuntimeStatusSummaryParts() ?? [];
  }

  async updateSettings(partial: Partial<PluginSettings>): Promise<void> {
    this.settings = {
      ...this.settings,
      ...partial,
      codex: {
        ...this.settings.codex,
        ...(partial.codex ?? {}),
      },
      securityPolicy: {
        ...this.settings.securityPolicy,
        ...(partial.securityPolicy ?? {}),
      },
    };
    await this.saveAllSettings();
    this.refreshRuntimeSettings();
  }

  getInstalledSkills() {
    return this.service?.getInstalledSkills() ?? [];
  }

  getAvailableModels() {
    return this.service?.getAvailableModels() ?? getFallbackModelCatalog();
  }

  async refreshRuntimeMetadata(): Promise<void> {
    await this.service?.refreshRuntimeMetadata();
  }

  getCustomStudyRecipes(): StudyRecipe[] {
    return this.service?.getCustomStudyRecipes() ?? [];
  }

  upsertStudyRecipe(recipe: StudyRecipe): void {
    this.service?.upsertStudyRecipe(recipe);
  }

  removeStudyRecipe(recipeId: string): void {
    this.service?.removeStudyRecipe(recipeId);
  }

  clearBlockedLegacyLauncherWarning(): void {
    this.blockedLegacyLauncherCommand = null;
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
          if (error instanceof PatchConflictError) {
            openPatchConflictModal(this.app, this.service, copy.workspace, error);
            return;
          }
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

  }

  refreshRuntimeSettings(): void {
    this.service?.refreshSettings();
    this.registerLocalizedUi();
    this.settingTab?.display();
    void this.refreshOpenWorkspaceLeaves();
  }

  private async refreshOpenWorkspaceLeaves(): Promise<void> {
    for (const leaf of [...this.app.workspace.getLeavesOfType(CODEX_VIEW_TYPE), ...this.app.workspace.getLeavesOfType(LEGACY_CODEX_VIEW_TYPE)]) {
      if ("loadIfDeferred" in leaf && typeof leaf.loadIfDeferred === "function") {
        await leaf.loadIfDeferred();
      }
      if (leaf.view instanceof CodexWorkspaceView) {
        leaf.view.refreshLocalization();
        leaf.view.persistLeafBranding();
      }
    }
  }

  async savePluginState(): Promise<void> {
    this.workspaceState = this.service?.store.serialize() ?? this.workspaceState;
    await this.saveData({
      settings: extractVaultSettings(this.settings),
      workspace: this.workspaceState,
    } satisfies PluginDataShape);
  }

  private async saveLocalSettings(): Promise<void> {
    await writeLocalSettingsFile(extractLocalSettings(this.settings));
  }

  private async saveAllSettings(): Promise<void> {
    await Promise.all([this.savePluginState(), this.saveLocalSettings()]);
  }

  private async loadPluginState(): Promise<void> {
    const data = (await this.loadData()) as (PluginDataShape & {
      settings?: Partial<VaultSettings> & LegacySettingsShape;
      workspace?: PersistedWorkspaceState | LegacyWorkspaceShape | null;
    }) | null;
    const localSettingsData = await readLocalSettingsFile();
    const legacySettings = data?.settings ?? {};
    const legacyCommand = legacySettings.codexCommand?.trim() ?? "";
    const modelCatalog = getFallbackModelCatalog();
    const configuredDefaultModel = data?.settings?.defaultModel?.trim() || legacySettings.defaultModel?.trim() || DEFAULT_SETTINGS.defaultModel;
    const localSettings = normalizeLocalSettings(localSettingsData, {
      allowedRoots: [((this.app.vault as { adapter?: { basePath?: string } }).adapter?.basePath?.trim() ?? ""), homedir()],
    });
    const configuredCodexModel = localSettings.codex.model.trim() || legacySettings.defaultModel?.trim() || DEFAULT_SETTINGS.codex.model;
    const usesLegacyDefaultPair = configuredDefaultModel === "gpt-5" && configuredCodexModel === "gpt-5.1-codex";
    const rawModel = usesLegacyDefaultPair ? DEFAULT_SETTINGS.codex.model : configuredCodexModel;
    const model = coerceModelForPicker(modelCatalog, rawModel || DEFAULT_PRIMARY_MODEL);
    const configuredRuntime = normalizeCodexRuntime(localSettings.codex.runtime);
    const configuredExecutablePath = sanitizeCodexExecutablePath(localSettings.codex.executablePath);
    const migratedLegacyLauncher = migrateLegacyCodexLauncher(legacyCommand);
    const blockedPersistedExecutablePath = isUnsafeCodexExecutablePath(configuredExecutablePath) ? configuredExecutablePath : null;
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
    const vaultSettings: VaultSettings = {
      defaultModel: coerceModelForPicker(modelCatalog, usesLegacyDefaultPair ? DEFAULT_SETTINGS.defaultModel : configuredDefaultModel),
      defaultReasoningEffort: getCompatibleReasoningEffort(model, configuredDefaultReasoningEffort) ?? configuredDefaultReasoningEffort,
      defaultFastMode: typeof settings.defaultFastMode === "boolean" ? settings.defaultFastMode : DEFAULT_VAULT_SETTINGS.defaultFastMode,
      defaultLearningMode:
        typeof settings.defaultLearningMode === "boolean" ? settings.defaultLearningMode : DEFAULT_VAULT_SETTINGS.defaultLearningMode,
      permissionMode: configuredPermissionMode ?? DEFAULT_SETTINGS.permissionMode,
      uiLanguage: configuredUiLanguage,
      onboardingVersionSeen:
        typeof data?.settings?.onboardingVersionSeen === "number" ? data.settings.onboardingVersionSeen : DEFAULT_SETTINGS.onboardingVersionSeen,
      autoApplyConsentVersionSeen:
        typeof data?.settings?.autoApplyConsentVersionSeen === "number"
          ? data.settings.autoApplyConsentVersionSeen
          : DEFAULT_SETTINGS.autoApplyConsentVersionSeen,
      preferredName: typeof settings.preferredName === "string" ? settings.preferredName.trim() : DEFAULT_VAULT_SETTINGS.preferredName,
      excludedTags: normalizeLineList(Array.isArray(settings.excludedTags) ? settings.excludedTags : []),
      mediaFolder: typeof settings.mediaFolder === "string" ? settings.mediaFolder.trim() : DEFAULT_VAULT_SETTINGS.mediaFolder,
      customSystemPrompt:
        typeof settings.customSystemPrompt === "string" ? settings.customSystemPrompt : DEFAULT_VAULT_SETTINGS.customSystemPrompt,
      autoScrollStreaming:
        typeof settings.autoScrollStreaming === "boolean" ? settings.autoScrollStreaming : DEFAULT_VAULT_SETTINGS.autoScrollStreaming,
      autoGenerateTitle:
        typeof settings.autoGenerateTitle === "boolean" ? settings.autoGenerateTitle : DEFAULT_VAULT_SETTINGS.autoGenerateTitle,
      titleGenerationModel:
        typeof settings.titleGenerationModel === "string" && settings.titleGenerationModel.trim()
          ? coerceModelForPicker(modelCatalog, settings.titleGenerationModel.trim())
          : model,
      vimMappings: normalizeLineList(Array.isArray(settings.vimMappings) ? settings.vimMappings : []),
      tabBarPosition: normalizeTabBarPosition(settings.tabBarPosition),
      openInMainEditor: typeof settings.openInMainEditor === "boolean" ? settings.openInMainEditor : DEFAULT_VAULT_SETTINGS.openInMainEditor,
      maxChatTabs: clampMaxChatTabs(settings.maxChatTabs),
      showReasoning: settings.showReasoning ?? legacySettings.showReasoning ?? DEFAULT_SETTINGS.showReasoning,
      autoRestoreTabs: settings.autoRestoreTabs ?? legacySettings.autoRestoreTabs ?? DEFAULT_SETTINGS.autoRestoreTabs,
    };
    const mergedLocalSettings: LocalSettings = {
      ...DEFAULT_LOCAL_SETTINGS,
      ...localSettings,
      codex: {
        ...DEFAULT_LOCAL_SETTINGS.codex,
        ...localSettings.codex,
        model,
        runtime:
          localSettingsData?.codex?.runtime !== undefined
            ? configuredRuntime
            : migratedLegacyLauncher.runtime,
        executablePath:
          localSettingsData?.codex?.executablePath?.trim()
            ? blockedPersistedExecutablePath
              ? DEFAULT_CODEX_EXECUTABLE
              : configuredExecutablePath
            : migratedLegacyLauncher.executablePath,
      },
      extraSkillRoots: localSettings.extraSkillRoots,
      mcpServers: localSettings.mcpServers,
      pluginOverrides: localSettings.pluginOverrides,
      securityPolicy: localSettings.securityPolicy,
      customEnv: localSettings.customEnv,
      envSnippets: localSettings.envSnippets,
    };
    this.settings = combineSettings(vaultSettings, mergedLocalSettings);
    this.blockedLegacyLauncherCommand = blockedPersistedExecutablePath ?? migratedLegacyLauncher.blockedLegacyCommand;
    this.workspaceState = this.migrateWorkspace(data?.workspace ?? null);
  }

  private maybeShowPermissionOnboarding(): void {
    if ((this.settings.onboardingVersionSeen ?? 0) >= PERMISSION_ONBOARDING_VERSION) {
      return;
    }
    const copy = this.getLocalizedCopy().prompts;
    new PermissionOnboardingModal(
      this.app,
      {
        title: copy.permissionOnboardingTitle,
        body: copy.permissionOnboardingBody,
        openSettings: copy.permissionOnboardingOpenSettings,
        confirm: copy.permissionOnboardingConfirm,
      },
      () => {
        void this.updatePermissionLifecycleSettings({
          onboardingVersionSeen: PERMISSION_ONBOARDING_VERSION,
        });
      },
      () => {
        const settingsApp = this.app as typeof this.app & {
          setting?: {
            open: () => void;
            openTabById: (id: string) => void;
          };
        };
        settingsApp.setting?.open();
        settingsApp.setting?.openTabById("obsidian-codex-study");
      },
    ).open();
  }

  private async updatePermissionLifecycleSettings(
    partial: Partial<Pick<PluginSettings, "onboardingVersionSeen" | "autoApplyConsentVersionSeen" | "permissionMode">>,
  ): Promise<void> {
    this.settings = {
      ...this.settings,
      ...partial,
    };
    await this.saveAllSettings();
    this.refreshRuntimeSettings();
  }

  private migrateWorkspace(input: PersistedWorkspaceState | LegacyWorkspaceShape | null): PersistedWorkspaceState | null {
    if (!input || !Array.isArray(input.tabs)) {
      return null;
    }

    const persistedWorkspace = input as Partial<PersistedWorkspaceState>;
    const requestedActiveTabId = typeof persistedWorkspace.activeTabId === "string" ? persistedWorkspace.activeTabId : null;
    const legacyActiveStudyRecipeId =
      typeof persistedWorkspace.activeStudyRecipeId === "string" ? persistedWorkspace.activeStudyRecipeId : null;
    const modelCatalog = getFallbackModelCatalog();
    const fallbackModel = coerceModelForPicker(
      modelCatalog,
      this.settings.codex.model.trim() || this.settings.defaultModel.trim() || DEFAULT_SETTINGS.codex.model,
    );
    const fallbackReasoningEffort =
      getCompatibleReasoningEffort(fallbackModel, this.settings.defaultReasoningEffort) ?? this.settings.defaultReasoningEffort;
    const fallbackFastMode = this.settings.defaultFastMode;
    const fallbackLearningMode = this.settings.defaultLearningMode;

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
            activeStudyRecipeId:
              "activeStudyRecipeId" in tab && typeof persisted.activeStudyRecipeId === "string"
                ? persisted.activeStudyRecipeId
                : typeof persisted.id === "string" && persisted.id === requestedActiveTabId
                  ? legacyActiveStudyRecipeId
                  : null,
            activeStudySkillNames:
              "activeStudySkillNames" in tab && Array.isArray((persisted as { activeStudySkillNames?: unknown }).activeStudySkillNames)
                ? (persisted as { activeStudySkillNames: unknown[] }).activeStudySkillNames
                    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
                : "activeStudySkillName" in tab && typeof ((persisted as unknown) as { activeStudySkillName?: unknown }).activeStudySkillName === "string"
                  ? [((persisted as unknown) as { activeStudySkillName: string }).activeStudySkillName]
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
                    pendingThreadReset: Boolean(persisted.lineage.pendingThreadReset),
                    compactedFromThreadId:
                      typeof persisted.lineage.compactedFromThreadId === "string" ? persisted.lineage.compactedFromThreadId : null,
                  }
                : {
                    parentTabId: null,
                    forkedFromThreadId: null,
                    resumedFromThreadId: null,
                    compactedAt: null,
                    pendingThreadReset: false,
                    compactedFromThreadId: null,
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
            panelSessionOrigin:
              "panelSessionOrigin" in tab &&
              persisted.panelSessionOrigin &&
              typeof persisted.panelSessionOrigin === "object" &&
              typeof persisted.panelSessionOrigin.panelId === "string"
                ? {
                    panelId: persisted.panelSessionOrigin.panelId,
                    selectedSkillNames:
                      Array.isArray((persisted.panelSessionOrigin as { selectedSkillNames?: unknown }).selectedSkillNames)
                        ? (persisted.panelSessionOrigin as { selectedSkillNames: unknown[] }).selectedSkillNames
                            .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
                        : typeof ((persisted.panelSessionOrigin as unknown) as { selectedSkillName?: unknown }).selectedSkillName === "string"
                          ? [((persisted.panelSessionOrigin as unknown) as { selectedSkillName: string }).selectedSkillName]
                          : [],
                    promptSnapshot:
                      typeof persisted.panelSessionOrigin.promptSnapshot === "string" ? persisted.panelSessionOrigin.promptSnapshot : "",
                    awaitingCompletionSignal: Boolean(persisted.panelSessionOrigin.awaitingCompletionSignal),
                    lastAssistantMessageId:
                      typeof persisted.panelSessionOrigin.lastAssistantMessageId === "string"
                        ? persisted.panelSessionOrigin.lastAssistantMessageId
                        : null,
                    startedAt: typeof persisted.panelSessionOrigin.startedAt === "number" ? persisted.panelSessionOrigin.startedAt : Date.now(),
                  }
                : null,
            chatSuggestion:
              "chatSuggestion" in tab &&
              persisted.chatSuggestion &&
              typeof persisted.chatSuggestion === "object" &&
              typeof persisted.chatSuggestion.messageId === "string"
                ? {
                    id: typeof persisted.chatSuggestion.id === "string" ? persisted.chatSuggestion.id : `chat-suggestion-${Date.now()}`,
                    kind:
                      persisted.chatSuggestion.kind === "plan_execute"
                        ? ("plan_execute" as const)
                        : persisted.chatSuggestion.kind === "rewrite_followup"
                          ? ("rewrite_followup" as const)
                        : ("panel_completion" as const),
                    status:
                      persisted.chatSuggestion.status === "applied" || persisted.chatSuggestion.status === "dismissed"
                        ? (persisted.chatSuggestion.status as "applied" | "dismissed")
                        : ("pending" as const),
                    messageId: persisted.chatSuggestion.messageId,
                    panelId: typeof persisted.chatSuggestion.panelId === "string" ? persisted.chatSuggestion.panelId : null,
                    panelTitle: typeof persisted.chatSuggestion.panelTitle === "string" ? persisted.chatSuggestion.panelTitle : null,
                    promptSnapshot: typeof persisted.chatSuggestion.promptSnapshot === "string" ? persisted.chatSuggestion.promptSnapshot : "",
                    matchedSkillName:
                      typeof persisted.chatSuggestion.matchedSkillName === "string" ? persisted.chatSuggestion.matchedSkillName : null,
                    canUpdatePanel: Boolean(persisted.chatSuggestion.canUpdatePanel),
                    canSaveCopy: Boolean(persisted.chatSuggestion.canSaveCopy),
                    planSummary:
                      typeof persisted.chatSuggestion.planSummary === "string" ? persisted.chatSuggestion.planSummary : null,
                    planStatus:
                      persisted.chatSuggestion.planStatus === "ready_to_implement"
                        ? ("ready_to_implement" as const)
                        : null,
                    rewriteSummary:
                      typeof persisted.chatSuggestion.rewriteSummary === "string" ? persisted.chatSuggestion.rewriteSummary : null,
                    rewriteQuestion:
                      typeof persisted.chatSuggestion.rewriteQuestion === "string" ? persisted.chatSuggestion.rewriteQuestion : null,
                    createdAt: typeof persisted.chatSuggestion.createdAt === "number" ? persisted.chatSuggestion.createdAt : Date.now(),
                  }
                : null,
            composerHistory:
              "composerHistory" in tab &&
              persisted.composerHistory &&
              typeof persisted.composerHistory === "object" &&
              Array.isArray((persisted.composerHistory as { entries?: unknown }).entries)
                ? {
                    entries: (persisted.composerHistory as { entries: unknown[] }).entries.filter(
                      (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
                    ),
                    index:
                      typeof (persisted.composerHistory as { index?: unknown }).index === "number"
                        ? (persisted.composerHistory as { index: number }).index
                        : null,
                    draft:
                      typeof (persisted.composerHistory as { draft?: unknown }).draft === "string"
                        ? (persisted.composerHistory as { draft: string }).draft
                        : null,
                  }
                : {
                    entries: [],
                    index: null,
                    draft: null,
                  },
            composeMode: ("composeMode" in tab && persisted.composeMode === "plan" ? "plan" : "chat") as "plan" | "chat",
            learningMode: fallbackLearningMode,
            contextPaths: Array.isArray("contextPaths" in tab ? persisted.contextPaths : undefined) ? [...persisted.contextPaths] : [],
            lastResponseId: "lastResponseId" in tab && typeof persisted.lastResponseId === "string" ? persisted.lastResponseId : null,
            sessionItems: [],
            codexThreadId:
              "codexThreadId" in tab && typeof persisted.codexThreadId === "string"
                ? persisted.codexThreadId
                : "threadId" in tab && typeof tab.threadId === "string"
                  ? tab.threadId
                  : null,
            model,
            reasoningEffort,
            fastMode: fallbackFastMode,
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
            patchBasket: [],
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
                input.accountUsage.source === "active_poll" ||
                input.accountUsage.source === "idle_poll" ||
                input.accountUsage.source === "session_backfill" ||
                input.accountUsage.source === "restored"
                  ? input.accountUsage.source
                  : "restored",
              updatedAt: typeof input.accountUsage.updatedAt === "number" ? input.accountUsage.updatedAt : null,
              lastObservedAt:
                typeof input.accountUsage.lastObservedAt === "number"
                  ? input.accountUsage.lastObservedAt
                  : typeof input.accountUsage.updatedAt === "number"
                    ? input.accountUsage.updatedAt
                    : null,
              lastCheckedAt: typeof input.accountUsage.lastCheckedAt === "number" ? input.accountUsage.lastCheckedAt : null,
              threadId: typeof input.accountUsage.threadId === "string" ? input.accountUsage.threadId : null,
            }
          : createEmptyAccountUsageSummary(),
      activeStudyWorkflow: this.coerceStudyWorkflow((persistedWorkspace as Partial<PersistedWorkspaceState>).activeStudyWorkflow),
      recentStudySources: this.normalizeRecentStudySources((persistedWorkspace as Partial<PersistedWorkspaceState>).recentStudySources),
      studyHubState: {
        lastOpenedAt:
          typeof (persistedWorkspace as Partial<PersistedWorkspaceState>).studyHubState?.lastOpenedAt === "number"
            ? ((persistedWorkspace as Partial<PersistedWorkspaceState>).studyHubState?.lastOpenedAt as number)
            : null,
        isCollapsed: Boolean((persistedWorkspace as Partial<PersistedWorkspaceState>).studyHubState?.isCollapsed),
      },
      studyRecipes: ((Array.isArray((persistedWorkspace as Partial<PersistedWorkspaceState>).studyRecipes)
        ? (persistedWorkspace as Partial<PersistedWorkspaceState>).studyRecipes
        : []) as unknown as Array<Record<string, unknown>>)
        .filter((entry: Record<string, unknown>) => Boolean(entry && typeof entry === "object"))
        .map((entry: Record<string, unknown>) => {
          const contextContract =
            entry.contextContract && typeof entry.contextContract === "object"
              ? (entry.contextContract as Record<string, unknown>)
              : null;
          const exampleSession =
            entry.exampleSession && typeof entry.exampleSession === "object"
              ? (entry.exampleSession as Record<string, unknown>)
              : null;
          const workflow = this.coerceStudyRecipeWorkflow(entry.workflow);
          const rawLinkedSkillNames = Array.isArray(entry.linkedSkillNames)
            ? entry.linkedSkillNames.filter((item): item is string => typeof item === "string")
            : typeof entry.promotedSkillName === "string"
              ? [entry.promotedSkillName]
              : [];
          const normalizedLinkedSkillNames =
            workflow === "custom"
              ? rawLinkedSkillNames
              : this.normalizeLegacyPanelLinkedSkills({
                  workflow,
                  title: typeof entry.title === "string" ? entry.title : "Study Recipe",
                  description: typeof entry.description === "string" ? entry.description : "Reusable study panel.",
                  promptTemplate: typeof entry.promptTemplate === "string" ? entry.promptTemplate : "",
                  linkedSkillNames: rawLinkedSkillNames,
                  promotedSkillName: typeof entry.promotedSkillName === "string" ? entry.promotedSkillName : null,
                });
          return ({
          id: typeof entry.id === "string" ? entry.id : `study-recipe-${Date.now()}`,
          title: typeof entry.title === "string" ? entry.title : "Study Recipe",
          description: typeof entry.description === "string" ? entry.description : "Reusable study panel.",
          commandAlias: typeof entry.commandAlias === "string" ? entry.commandAlias : "/recipe-study-recipe",
          workflow,
          promptTemplate: typeof entry.promptTemplate === "string" ? entry.promptTemplate : "",
          linkedSkillNames: normalizedLinkedSkillNames,
          contextContract: contextContract
              ? {
                  summary: typeof contextContract.summary === "string" ? contextContract.summary : "",
                  requireTargetNote: Boolean(contextContract.requireTargetNote),
                  recommendAttachments: Boolean(contextContract.recommendAttachments),
                  requireSelection: Boolean(contextContract.requireSelection),
                  minimumPinnedContextCount:
                    typeof contextContract.minimumPinnedContextCount === "number" ? contextContract.minimumPinnedContextCount : 0,
                }
              : {
                  summary: "",
                  requireTargetNote: false,
                  recommendAttachments: false,
                  requireSelection: false,
                  minimumPinnedContextCount: 0,
                },
          outputContract: Array.isArray(entry.outputContract) ? entry.outputContract.filter((item): item is string => typeof item === "string") : [],
          sourceHints: Array.isArray(entry.sourceHints) ? entry.sourceHints.filter((item): item is string => typeof item === "string") : [],
          exampleSession: exampleSession
              ? {
                  sourceTabTitle: typeof exampleSession.sourceTabTitle === "string" ? exampleSession.sourceTabTitle : "Study chat",
                  targetNotePath: typeof exampleSession.targetNotePath === "string" ? exampleSession.targetNotePath : null,
                  prompt: typeof exampleSession.prompt === "string" ? exampleSession.prompt : "",
                  outcomePreview: typeof exampleSession.outcomePreview === "string" ? exampleSession.outcomePreview : null,
                  createdAt: typeof exampleSession.createdAt === "number" ? exampleSession.createdAt : Date.now(),
                }
              : {
                  sourceTabTitle: "Study chat",
                  targetNotePath: null,
                  prompt: "",
                  outcomePreview: null,
                  createdAt: Date.now(),
                },
          promotionState: entry.promotionState === "promoted" ? "promoted" : "captured",
          promotedSkillName: typeof entry.promotedSkillName === "string" ? entry.promotedSkillName : null,
          useCount: typeof entry.useCount === "number" ? entry.useCount : 0,
          lastUsedAt: typeof entry.lastUsedAt === "number" ? entry.lastUsedAt : null,
          createdAt: typeof entry.createdAt === "number" ? entry.createdAt : Date.now(),
          updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : Date.now(),
        });
        }),
      activeStudyRecipeId:
        typeof (persistedWorkspace as Partial<PersistedWorkspaceState>).activeStudyRecipeId === "string"
          ? ((persistedWorkspace as Partial<PersistedWorkspaceState>).activeStudyRecipeId as string)
          : null,
    };
  }

  private coerceStudyWorkflow(value: unknown): StudyWorkflowKind | null {
    if (value === "lecture" || value === "review" || value === "paper" || value === "homework") {
      return value;
    }
    return null;
  }

  private coerceStudyRecipeWorkflow(value: unknown): StudyRecipeWorkflowKind {
    if (value === "custom") {
      return value;
    }
    return this.coerceStudyWorkflow(value) ?? "lecture";
  }

  private normalizeLegacyPanelLinkedSkills(input: {
    workflow: StudyWorkflowKind;
    title: string;
    description: string;
    promptTemplate: string;
    linkedSkillNames: string[];
    promotedSkillName: string | null;
  }): string[] {
    if (input.promotedSkillName) {
      return input.linkedSkillNames;
    }
    const legacyDefaults = LEGACY_DEFAULT_LINKED_PANEL_SKILLS[input.workflow];
    if (!this.stringArraysEqual(input.linkedSkillNames, legacyDefaults) || legacyDefaults.length === 0) {
      return input.linkedSkillNames;
    }
    const matchesSeed = (["en", "ja"] as const).some((locale) => {
      const definition = getStudyWorkflowDefinition(input.workflow, locale);
      return (
        input.title.trim() === definition.label &&
        input.description.trim() === definition.description &&
        input.promptTemplate.trim() === definition.promptLead
      );
    });
    return matchesSeed ? [] : input.linkedSkillNames;
  }

  private stringArraysEqual(left: string[], right: string[]): boolean {
    if (left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => value === right[index]);
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
        kind: entry.kind === "note" || entry.kind === "attachment" || entry.kind === "selection" ? entry.kind : "note",
        createdAt: typeof entry.createdAt === "number" ? entry.createdAt : Date.now(),
      }));
  }

  private async activateView(): Promise<CodexWorkspaceView | null> {
    const legacyLeaf = this.app.workspace.getLeavesOfType(LEGACY_CODEX_VIEW_TYPE)[0] ?? null;
    const preferredLeaf =
      this.app.workspace.getLeavesOfType(CODEX_VIEW_TYPE)[0] ??
      legacyLeaf ??
      (this.settings.openInMainEditor ? this.app.workspace.getLeaf("tab") : this.app.workspace.getRightLeaf(false));
    const leaf = preferredLeaf;
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
