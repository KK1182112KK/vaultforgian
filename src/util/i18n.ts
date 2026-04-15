import type { UiLanguageSetting } from "../model/types";

export type SupportedLocale = "en" | "ja";

export interface LocalizedCopy {
  pluginName: string;
  pluginDescription: string;
  ribbon: {
    openWorkspace: string;
  };
  commands: {
    openWorkspace: string;
    openIngestHub: string;
    newTab: string;
    startLectureWorkflow: string;
    startReviewWorkflow: string;
    startPaperWorkflow: string;
    startHomeworkWorkflow: string;
    askAboutCurrentNote: string;
    askAboutSelection: string;
    attachLocalFile: string;
    applyLatestPatch: string;
    rejectLatestPatch: string;
    openLatestPatchTarget: string;
    interruptActiveTurn: string;
    stopTurn: string;
    togglePlanMode: string;
    forkConversation: string;
    resumeThread: string;
    compactConversation: string;
    pinCurrentNote: string;
    pinDailyNote: string;
    clearContextPack: string;
  };
  prompts: {
    fieldLabel: string;
    cancel: string;
    send: string;
    permissionOnboardingTitle: string;
    permissionOnboardingBody: string[];
    permissionOnboardingOpenSettings: string;
    permissionOnboardingConfirm: string;
    autoApplyConsentTitle: string;
    autoApplyConsentBody: string[];
    autoApplyConsentKeep: string;
    autoApplyConsentSwitch: string;
    askAboutThisNoteTitle: string;
    askAboutThisNotePlaceholder: string;
    askAboutThisNoteDescription: string;
    saveStudyRecipeTitle: string;
    saveStudyRecipePlaceholder: string;
    saveStudyRecipeDescription: string;
    reviewSkillDraftTitle: string;
    reviewSkillDraftPlaceholder: string;
    reviewSkillDraftDescription: (targetPath: string, diff: string) => string;
  };
  notices: {
    selectTextFirst: string;
    noPendingPatch: string;
    noPatchTarget: string;
    cannotForkConversation: string;
    noResumableThread: string;
    noOpenLeaf: string;
    cannotStartNewSession: string;
    blockedLegacyLauncherNotice: string;
    provideSearchQuery: string;
    openChatsLimited: (max: number) => string;
    updateExistingRecipe: (title: string, diff: string) => string;
    recipeCopyCreated: (title: string) => string;
  };
  settings: {
    title: string;
    languageName: string;
    languageDesc: string;
    languageFollowApp: string;
    languageEnglish: string;
    languageJapanese: string;
    authenticationName: string;
    authenticationDesc: string;
    codexModelName: string;
    codexModelDesc: string;
    defaultReasoningEffortName: string;
    defaultReasoningEffortDesc: string;
    permissionModeName: string;
    permissionModeDesc: string;
    codexRuntimeName: string;
    codexRuntimeDesc: string;
    codexExecutableName: string;
    codexExecutableDesc: string;
    runtimeWarningTitle: string;
    blockedLegacyLauncherWarning: (command: string) => string;
    extraSkillRootsName: string;
    extraSkillRootsDesc: string;
    showReasoningName: string;
    showReasoningDesc: string;
    autoRestoreTabsName: string;
    autoRestoreTabsDesc: string;
  };
  workspace: {
    title: string;
    header: {
      newTab: string;
      newSession: string;
      forkConversation: string;
      resumeThread: string;
      compactConversation: string;
      settings: string;
    };
    planMode: string;
    defaultComposerPlaceholder: string;
    attachLocalFiles: string;
    send: string;
    sending: string;
    selectModel: string;
    selectThinkingLevel: string;
    modelMenuTitle: string;
    thinkingMenuTitle: string;
    toggleFastMode: string;
    fastMode: string;
    fastModeHint: string;
    fastModeStreamingTooltip: string;
    toggleYolo: string;
    yolo: string;
    autoApplyDisabledTooltip: string;
    effectiveState: string;
    executionPlanning: string;
    executionArmed: string;
    executionEditing: string;
    executionAssisted: string;
    executionReadOnly: string;
    planYoloWarning: string;
    implementNow: string;
    implementNowNotReady: string;
    implementNowConfirm: (summary: string) => string;
    referenceNote: string;
    removeReferenceNote: string;
    currentNote: string;
    dailyNote: string;
    pinnedContext: string;
    clearAll: string;
    removePinnedContext: (name: string) => string;
    ingestHubTitle: string;
    ingestHubSubtitle: string;
    expandIngestHub: string;
    collapseIngestHub: string;
    attachFriendly: string;
    seedPrompt: string;
    attachFiles: string;
    saveAsStudyRecipe: string;
    activeWorkflow: (label: string) => string;
    activePanel: (label: string) => string;
    addPanel: string;
    createPanelTitle: string;
    createPanelSave: string;
    closeCreatePanel: string;
    panelSkills: string;
    untitledPanel: string;
    panelTitlePlaceholder: string;
    panelDescriptionPlaceholder: string;
    panelPromptPlaceholder: string;
    editPanel: string;
    cancelEdit: string;
    deletePanel: string;
    deletePanelConfirm: (title: string) => string;
    discardNewPanelConfirm: string;
    linkedSkills: string;
    availableSkills: string;
    noLinkedSkills: string;
    noLinkedSkillsHint: string;
    useSelectedSkills: string;
    noSelectedSkills: string;
    updatePanel: string;
    saveAsNewPanel: string;
    skipSuggestion: string;
    reflectInNote: string;
    reflectInNoteQuestion: string;
    evidence: string;
    webBackedPatch: string;
    openedAt: (text: string) => string;
    note: (name: string) => string;
    studyRecipes: string;
    studyRecipesSubtitle: string;
    noStudyRecipes: string;
    recipeAlias: (alias: string) => string;
    useInChat: string;
    promoteToSkill: string;
    updateSkill: string;
    contextReady: string;
    recipeNeedsContext: string;
    promotedAs: (skillName: string) => string;
    recipeUses: (count: number) => string;
    conversationContext: string;
    forked: string;
    resumed: string;
    compactedAt: (text: string) => string;
    showingLastItems: (count: number) => string;
    instructions: string;
    modifiers: string;
    addModifier: string;
    removeInstruction: (label: string) => string;
    clearPanelContext: (label: string) => string;
    pendingApprovals: string;
    approveAll: string;
    approveAllConfirm: (count: number, targets: string) => string;
    thisSession: string;
    denyAll: string;
    selectedText: string;
    attachedFiles: (count: number | null) => string;
    approvalRequired: string;
    approve: string;
    deny: string;
    abort: string;
    selection: string;
    response: string;
    removeSelectedText: string;
    removeAttachment: (name: string) => string;
    saveAsRecipe: string;
    dismiss: string;
    runOnCurrentNote: string;
    runOnSearch: string;
    delete: string;
    changes: string;
    open: string;
    apply: string;
    retry: string;
    reject: string;
    conflictModalTitle: (path: string) => string;
    conflictCurrentContent: string;
    conflictCodexProposal: string;
    conflictOverwrite: string;
    conflictKeepCurrent: string;
    conflictOpenInEditor: string;
    conflictOverwriteChangedConfirm: string;
    welcomeTitle: string;
    welcomeBody: string;
    usageTitle: string;
    noUsageYet: string;
    usageRemainingAria: (label: string) => string;
    usageTitleTooltip: (remaining: number, used: number, source: string | null) => string;
    welcomeSuggestions: string[];
    usageSource: {
      live: string;
      recovered: string;
      restored: string;
    };
    activityStatus: {
      running: string;
      failed: string;
      done: string;
    };
    backlinks: (count: number) => string;
    topSources: (sources: string) => string;
    unresolvedSources: (sources: string) => string;
    changesProposedBelow: string;
    none: string;
    never: string;
  };
  service: {
    newChatTitle: string;
    studyChatTitle: string;
    reviewThisNoteFallback: string;
    selectionSource: (path: string) => string;
    selectionLabel: string;
    fileSelectionLabel: (basename: string) => string;
    recipeSaved: (title: string) => string;
    studyRecipeSaved: (title: string, alias: string) => string;
    studyRecipeSkillSaved: (title: string, skillName: string) => string;
    panelNothingToSave: (title: string) => string;
    panelSavePrompt: (title: string) => string;
    panelSavePromptWithSkill: (title: string, skillName: string) => string;
    panelSuggestionDismissed: (title: string) => string;
    panelUpdated: (title: string) => string;
    panelCopied: (title: string) => string;
    panelSkillUpdated: (title: string, skillName: string) => string;
    panelLimitReached: (max: number) => string;
    planImplementationStarted: string;
    planImplementationRequiresYolo: string;
    studyRecipeFallbackPrompt: string;
    studyRecipeWorkflowRequired: string;
    selectTextBeforeAsking: string;
    approvalAborted: (title: string) => string;
    approvalDenied: (title: string) => string;
    approvalApplied: (title: string) => string;
    batchApprovalFinished: (applied: number, denied: number, failed: number) => string;
    patchCreated: (path: string) => string;
    patchApplied: (path: string) => string;
    patchRejected: (path: string) => string;
    patchNeedsReview: (path: string) => string;
    patchTargetMissing: (path: string) => string;
    unsafeNotePathBlocked: (path: string) => string;
    unsafeVaultOpBlocked: (path: string) => string;
    autoApplyReviewFallback: (limit: number) => string;
    noActiveNoteToPin: string;
    dailyNoteNotFound: string;
    tabAlreadyRunning: string;
    promptEmptyAfterExpansion: string;
    interruptRequested: string;
    turnInterrupted: string;
    invalidPatchRepairing: string;
    invalidPatchRepairFailed: string;
    applyLatestPatchAmbiguous: (count: number) => string;
    proposalProcessingFailed: (message: string) => string;
  };
}

const EN_COPY: LocalizedCopy = {
  pluginName: "Codex Noteforge",
  pluginDescription: "Study-first Codex workspace for Obsidian",
  ribbon: {
    openWorkspace: "Open Study workspace",
  },
  commands: {
    openWorkspace: "Open Study workspace",
    openIngestHub: "Open Panel Studio",
    newTab: "New Codex tab",
    startLectureWorkflow: "Start Lecture workflow",
    startReviewWorkflow: "Start Review workflow",
    startPaperWorkflow: "Start Paper workflow",
    startHomeworkWorkflow: "Start Homework workflow",
    askAboutCurrentNote: "Ask Codex about the current note",
    askAboutSelection: "Use selection in Codex chat",
    attachLocalFile: "Attach local file to Codex chat",
    applyLatestPatch: "Apply latest Codex patch",
    rejectLatestPatch: "Reject latest Codex patch",
    openLatestPatchTarget: "Open latest Codex patch target",
    interruptActiveTurn: "Interrupt active Codex turn",
    stopTurn: "Stop",
    togglePlanMode: "Toggle Codex plan mode",
    forkConversation: "Fork Codex conversation",
    resumeThread: "Resume Codex thread in new tab",
    compactConversation: "Compact Codex conversation",
    pinCurrentNote: "Pin current note to Codex context",
    pinDailyNote: "Pin daily note to Codex context",
    clearContextPack: "Clear Codex context pack",
  },
  prompts: {
    fieldLabel: "Prompt",
    cancel: "Cancel",
    send: "Send",
    permissionOnboardingTitle: "Note editing permissions",
    permissionOnboardingBody: [
      "This plugin lets Codex read your vault through a read-only sandbox.",
      "All note edits flow through Obsidian patch or vault-operation proposals instead of direct file writes.",
      "By default, note changes stay in review until you approve them. If you switch to Edit automatically, note changes may be applied automatically.",
    ],
    permissionOnboardingOpenSettings: "Open settings",
    permissionOnboardingConfirm: "I understand",
    autoApplyConsentTitle: "Keep automatic note edits?",
    autoApplyConsentBody: [
      "Edit automatically now means this plugin may apply note changes without stopping for approval.",
      "Codex still reads your vault through a read-only sandbox, and all note writes still go through plugin patch or vault-operation proposals.",
    ],
    autoApplyConsentKeep: "Keep Edit automatically",
    autoApplyConsentSwitch: "Switch to Edit with approval",
    askAboutThisNoteTitle: "Ask About This Note",
    askAboutThisNotePlaceholder: "Summarize this note and suggest the next steps.",
    askAboutThisNoteDescription: "Leave blank to use the default note-review prompt.",
    saveStudyRecipeTitle: "Save Study Recipe",
    saveStudyRecipePlaceholder: "Lecture signals review loop",
    saveStudyRecipeDescription: "Name the reusable recipe captured from the current workflow and chat pattern.",
    reviewSkillDraftTitle: "Review Skill Draft",
    reviewSkillDraftPlaceholder: "Review the generated SKILL.md draft before saving.",
    reviewSkillDraftDescription: (targetPath, diff) => `Target: ${targetPath}\n${diff}`,
  },
  notices: {
    selectTextFirst: "Select some text first.",
    noPendingPatch: "No pending Codex patch.",
    noPatchTarget: "No Codex patch target.",
    cannotForkConversation: "Cannot fork this conversation.",
    noResumableThread: "No resumable Codex thread on this tab.",
    noOpenLeaf: "Failed to allocate an Obsidian leaf for the Study workspace.",
    cannotStartNewSession: "Cannot start a new session while Codex is responding.",
    blockedLegacyLauncherNotice: "Blocked an unsafe legacy Codex launcher and restored safe defaults. Review Codex runtime settings.",
    provideSearchQuery: "Provide a search query.",
    openChatsLimited: (max) => `Open chats are limited to ${max}.`,
    updateExistingRecipe: (title, diff) => `A matching recipe already exists: ${title}\n${diff}\n\nSelect OK to update it, or Cancel to save a new copy.`,
    recipeCopyCreated: (title) => `Saved a new recipe copy: ${title}.`,
  },
  settings: {
    title: "Codex Noteforge",
    languageName: "Display language",
    languageDesc: "Follow Obsidian or override this plugin's UI language.",
    languageFollowApp: "Follow Obsidian",
    languageEnglish: "English",
    languageJapanese: "Japanese",
    authenticationName: "Authentication",
    authenticationDesc: "Run `codex login` on this machine. This plugin uses the local Codex login and does not require an OpenAI API key for normal use.",
    codexModelName: "Codex model",
    codexModelDesc: "Model used for new turns.",
    defaultReasoningEffortName: "Default reasoning effort",
    defaultReasoningEffortDesc: "Reasoning effort used when a new chat starts.",
    permissionModeName: "Permission mode",
    permissionModeDesc: "Default execution mode for new turns outside Plan mode.",
    codexRuntimeName: "Codex runtime",
    codexRuntimeDesc: "Choose whether the plugin launches Codex directly or through WSL.",
    codexExecutableName: "Codex executable path",
    codexExecutableDesc: "Executable path only. Examples: `codex`, `codex.cmd`, `codex.exe`, or an absolute executable path. Shell launchers such as `bash -lc` and `cmd /c` are blocked.",
    runtimeWarningTitle: "Runtime warning",
    blockedLegacyLauncherWarning: (command) =>
      `Blocked an unsafe legacy Codex launcher and restored safe defaults. Review Codex runtime/executable settings. Blocked value: ${command}`,
    extraSkillRootsName: "Extra skill roots",
    extraSkillRootsDesc: "Additional directories to scan for SKILL.md bundles. Enter one absolute path per line.",
    showReasoningName: "Show reasoning",
    showReasoningDesc: "Render reasoning deltas when the model emits them.",
    autoRestoreTabsName: "Auto restore tabs",
    autoRestoreTabsDesc: "Restore saved tabs and transcripts when the workspace opens.",
  },
  workspace: {
    title: "Codex Noteforge",
    header: {
      newTab: "New tab",
      newSession: "New session",
      forkConversation: "Fork conversation",
      resumeThread: "Resume thread in a new tab",
      compactConversation: "Compact conversation",
      settings: "Settings",
    },
    planMode: "Plan mode",
    defaultComposerPlaceholder: "Ask about your lecture, paper, homework, or notes...",
    attachLocalFiles: "Attach local files",
    send: "Send",
    sending: "Sending",
    selectModel: "Select model",
    selectThinkingLevel: "Select thinking level",
    modelMenuTitle: "Model",
    thinkingMenuTitle: "Thinking",
    toggleFastMode: "Toggle Fast mode",
    fastMode: "Fast mode",
    fastModeHint: "Fastest inference · 2x plan usage",
    fastModeStreamingTooltip: "Fast mode can be changed after the current turn finishes.",
    toggleYolo: "Toggle auto-apply",
    yolo: "Auto-apply",
    autoApplyDisabledTooltip: "Auto-apply is disabled in Read only mode. Change Permission mode in Settings.",
    effectiveState: "Effective",
    executionPlanning: "Planning",
    executionArmed: "Ready to implement",
    executionEditing: "Edit automatically",
    executionAssisted: "Edit with approval",
    executionReadOnly: "Read only",
    planYoloWarning: "Plan mode stays read-only. Switch to Edit automatically to run Implement now.",
    implementNow: "Implement now",
    implementNowNotReady: "Plan is not yet ready to implement.",
    implementNowConfirm: (summary) =>
      ["Implement this plan now?", summary.trim() || null].filter((line): line is string => Boolean(line)).join("\n"),
    referenceNote: "Reference note",
    removeReferenceNote: "Remove reference note from this conversation",
    currentNote: "Current note",
    dailyNote: "Daily note",
    pinnedContext: "Pinned context",
    clearAll: "Clear all",
    removePinnedContext: (name) => `Remove ${name} from pinned context`,
    ingestHubTitle: "Panel Studio",
    ingestHubSubtitle: "Shape reusable panels, prompts, and skills for this workspace.",
    expandIngestHub: "Expand Panel Studio",
    collapseIngestHub: "Collapse Panel Studio",
    attachFriendly: "Attach-friendly",
    seedPrompt: "Seed prompt",
    attachFiles: "Attach files",
    saveAsStudyRecipe: "Save current setup",
    activeWorkflow: (label) => `Active ${label}`,
    activePanel: (label) => `Panel ${label}`,
    addPanel: "Add panel",
    createPanelTitle: "New panel",
    createPanelSave: "Create panel",
    closeCreatePanel: "Close new panel",
    panelSkills: "Skills",
    untitledPanel: "Untitled panel",
    panelTitlePlaceholder: "Signals exam drill",
    panelDescriptionPlaceholder: "When to use this panel and what it should help with.",
    panelPromptPlaceholder: "Ask about your lecture, paper, homework, notes, or any workflow you want this panel to run.",
    editPanel: "Edit panel",
    cancelEdit: "Cancel editing",
    deletePanel: "Delete panel",
    deletePanelConfirm: (title) => `Delete the panel "${title}"?`,
    discardNewPanelConfirm: "Discard this new panel draft?",
    linkedSkills: "Linked skills",
    availableSkills: "Available skills",
    noLinkedSkills: "No linked skills yet.",
    noLinkedSkillsHint: "Open Edit panel to link one or more skills to this panel.",
    useSelectedSkills: "Use selected",
    noSelectedSkills: "No skills selected",
    updatePanel: "Update panel",
    saveAsNewPanel: "Save as new panel",
    skipSuggestion: "Skip",
    reflectInNote: "Reflect in note",
    reflectInNoteQuestion: "Want me to reflect this in the note?",
    evidence: "Evidence",
    webBackedPatch: "Web-backed",
    openedAt: (text) => `Opened ${text}`,
    note: (name) => `Note ${name}`,
    studyRecipes: "Captured recipes",
    studyRecipesSubtitle: "Turn successful study flows into reusable recipes and promote them to skills when they stabilize.",
    noStudyRecipes: "No study recipes yet. Save a successful workflow from the current chat to reuse it later.",
    recipeAlias: (alias) => `Alias ${alias}`,
    useInChat: "Use in chat",
    promoteToSkill: "Promote to skill",
    updateSkill: "Update skill",
    contextReady: "Context ready",
    recipeNeedsContext: "Needs more context",
    promotedAs: (skillName) => `Promoted as $${skillName}`,
    recipeUses: (count) => `${count} uses`,
    conversationContext: "Conversation context",
    forked: "Forked",
    resumed: "Resumed",
    compactedAt: (text) => `Compacted ${text}`,
    showingLastItems: (count) => `Showing last ${count} items`,
    instructions: "Instructions",
    modifiers: "Modifiers",
    addModifier: "Modifier",
    removeInstruction: (label) => `Remove #${label}`,
    clearPanelContext: (label) => `Clear ${label} panel context`,
    pendingApprovals: "Pending approvals",
    approveAll: "Approve all",
    approveAllConfirm: (count, targets) =>
      [`Approve ${count} pending change${count === 1 ? "" : "s"}?`, targets.trim() ? `Targets: ${targets}` : null]
        .filter((line): line is string => Boolean(line))
        .join("\n"),
    thisSession: "This session",
    denyAll: "Deny all",
    selectedText: "Selected text",
    attachedFiles: (count) => (count ? `Attached files (${count})` : "Attached files"),
    approvalRequired: "Approval required",
    approve: "Approve",
    deny: "Deny",
    abort: "Abort",
    selection: "Selection",
    response: "Response",
    removeSelectedText: "Remove selected text from this chat",
    removeAttachment: (name) => `Remove ${name}`,
    saveAsRecipe: "Save as recipe",
    dismiss: "Dismiss",
    runOnCurrentNote: "Run on current note",
    runOnSearch: "Run on search",
    delete: "Delete",
    changes: "Changes",
    open: "Open",
    apply: "Apply",
    retry: "Rebase and apply",
    reject: "Reject",
    conflictModalTitle: (path) => `Resolve conflict for ${path}`,
    conflictCurrentContent: "Current content",
    conflictCodexProposal: "Codex proposal",
    conflictOverwrite: "Overwrite with proposal",
    conflictKeepCurrent: "Keep current",
    conflictOpenInEditor: "Open in editor for manual merge",
    conflictOverwriteChangedConfirm: "This note changed after the conflict dialog opened. Overwrite it with the Codex proposal anyway?",
    welcomeTitle: "Codex Noteforge",
    welcomeBody: "Use your vault as a study workspace for lectures, review loops, papers, and homework. Start from Panel Studio or ask directly in chat.",
    usageTitle: "Codex usage",
    noUsageYet: "No Codex usage yet",
    usageRemainingAria: (label) => `${label} remaining`,
    usageTitleTooltip: (remaining, used, source) => `${remaining}% left, ${used}% used${source ? ` · ${source}` : ""}`,
    welcomeSuggestions: [
      "Summarize this note",
      "Create a study guide from this note",
      "Propose improvements to this note",
    ],
    usageSource: {
      live: "LIVE",
      recovered: "RECOVERED",
      restored: "RESTORED",
    },
    activityStatus: {
      running: "Running",
      failed: "Failed",
      done: "Done",
    },
    backlinks: (count) => `Backlinks: ${count}`,
    topSources: (sources) => `Top sources: ${sources}`,
    unresolvedSources: (sources) => `Unresolved sources: ${sources}`,
    changesProposedBelow: "Changes proposed below.",
    none: "None",
    never: "never",
  },
  service: {
    newChatTitle: "New chat",
    studyChatTitle: "Study chat",
    reviewThisNoteFallback: "Review this note and suggest the next steps.",
    selectionSource: (path) => `Selected text from ${path}`,
    selectionLabel: "Selected text",
    fileSelectionLabel: (basename) => `${basename} selection`,
    recipeSaved: (title) => `Recipe saved: ${title}.`,
    studyRecipeSaved: (title, alias) => `Study recipe saved: ${title} · ${alias}.`,
    studyRecipeSkillSaved: (title, skillName) => `Skill saved from ${title}: $${skillName}.`,
    panelNothingToSave: (title) => `The ${title} panel already matches this flow, so there is nothing new to save.`,
    panelSavePrompt: (title) => `This looked like a completed ${title} pass. Do you want me to update the panel or save a new variant?`,
    panelSavePromptWithSkill: (title, skillName) =>
      `This looked like a completed ${title} pass. Do you want me to update the panel or refresh $${skillName}?`,
    panelSuggestionDismissed: (title) => `Skipped saving changes for ${title}.`,
    panelUpdated: (title) => `Updated panel: ${title}.`,
    panelCopied: (title) => `Saved a new panel: ${title}.`,
    panelSkillUpdated: (title, skillName) => `Updated $${skillName} from the ${title} panel.`,
    panelLimitReached: (max) => `Panel Studio supports up to ${max} panels.`,
    planImplementationStarted: "Starting implementation from the agreed plan.",
    planImplementationRequiresYolo: "Switch Permission mode to Edit automatically before starting implementation from Plan mode.",
    studyRecipeFallbackPrompt: "Recreate this study workflow as a reusable pattern.",
    studyRecipeWorkflowRequired: "Start a lecture, review, paper, or homework workflow before saving a study recipe.",
    selectTextBeforeAsking: "Select some text before asking Codex about it.",
    approvalAborted: (title) => `Aborted: ${title}`,
    approvalDenied: (title) => `Denied: ${title}`,
    approvalApplied: (title) => `${title} applied.`,
    batchApprovalFinished: (applied, denied, failed) => `Batch approval finished. Applied: ${applied}, denied: ${denied}, failed: ${failed}.`,
    patchCreated: (path) => `Created ${path}`,
    patchApplied: (path) => `Successfully patched ${path}.`,
    patchRejected: (path) => `Rejected patch for ${path}`,
    patchNeedsReview: (path) => `${path} needs manual review before it can be applied automatically.`,
    patchTargetMissing: (path) => `${path} does not exist yet.`,
    unsafeNotePathBlocked: (path) => `Blocked unsafe note path: ${path}.`,
    unsafeVaultOpBlocked: (path) => `Blocked unsafe file operation target: ${path}.`,
    autoApplyReviewFallback: (limit) => `Automatic note edits paused for this turn after ${limit} proposals. Review the remaining changes manually.`,
    noActiveNoteToPin: "No active note to pin.",
    dailyNoteNotFound: "Today's daily note was not found.",
    tabAlreadyRunning: "This tab is already running. Wait for it to finish or interrupt it first.",
    promptEmptyAfterExpansion: "The prompt is empty after slash-command expansion.",
    interruptRequested: "Interrupt requested.",
    turnInterrupted: "Turn interrupted.",
    invalidPatchRepairing: "Codex returned an invalid note patch, so the plugin is requesting a repaired proposal.",
    invalidPatchRepairFailed: "Codex did not return a valid note patch. Nothing was applied.",
    applyLatestPatchAmbiguous: (count) => `There are ${count} pending note patches. Pick one from the Changes tray before applying it.`,
    proposalProcessingFailed: (message) => `Failed to process Codex proposals: ${message}`,
  },
};

const JA_COPY: LocalizedCopy = {
  pluginName: "Codex Noteforge",
  pluginDescription: "Obsidian 向け学習用 Codex ワークスペース",
  ribbon: {
    openWorkspace: "Study ワークスペースを開く",
  },
  commands: {
    openWorkspace: "Study ワークスペースを開く",
    openIngestHub: "Panel Studio を開く",
    newTab: "Codex タブを新規作成",
    startLectureWorkflow: "Lecture workflow を開始",
    startReviewWorkflow: "Review workflow を開始",
    startPaperWorkflow: "Paper workflow を開始",
    startHomeworkWorkflow: "Homework workflow を開始",
    askAboutCurrentNote: "現在のノートについて Codex に聞く",
    askAboutSelection: "選択範囲を Codex chat に使う",
    attachLocalFile: "ローカルファイルを Codex chat に添付",
    applyLatestPatch: "最新の Codex patch を適用",
    rejectLatestPatch: "最新の Codex patch を却下",
    openLatestPatchTarget: "最新の Codex patch 対象を開く",
    interruptActiveTurn: "進行中の Codex turn を中断",
    stopTurn: "停止",
    togglePlanMode: "Codex plan mode を切り替え",
    forkConversation: "Codex conversation を fork",
    resumeThread: "Codex thread を新しいタブで再開",
    compactConversation: "Codex conversation を compact",
    pinCurrentNote: "現在のノートを Codex context に固定",
    pinDailyNote: "今日の daily note を Codex context に固定",
    clearContextPack: "Codex context pack をクリア",
  },
  prompts: {
    fieldLabel: "プロンプト",
    cancel: "キャンセル",
    send: "送信",
    permissionOnboardingTitle: "ノート編集の権限",
    permissionOnboardingBody: [
      "この plugin では、Codex は read-only sandbox 経由で vault を読みます。",
      "ノート変更は direct file write ではなく、Obsidian patch / vault operation proposal 経由でのみ行います。",
      "既定ではノート変更は review / approval に止まります。Edit automatically に切り替えると、ノート変更が自動適用される場合があります。",
    ],
    permissionOnboardingOpenSettings: "設定を開く",
    permissionOnboardingConfirm: "理解しました",
    autoApplyConsentTitle: "自動ノート編集を維持しますか",
    autoApplyConsentBody: [
      "Edit automatically は、ノート変更を承認なしで自動適用できる設定になりました。",
      "それでも Codex は read-only sandbox で vault を読み、ノート書き込み自体は plugin の patch / vault operation proposal 経由のみです。",
    ],
    autoApplyConsentKeep: "Edit automatically を維持",
    autoApplyConsentSwitch: "Edit with approval に変更",
    askAboutThisNoteTitle: "このノートについて聞く",
    askAboutThisNotePlaceholder: "このノートを要約して、次のアクションを提案してください。",
    askAboutThisNoteDescription: "空欄なら既定のノートレビュー用プロンプトを使います。",
    saveStudyRecipeTitle: "Study Recipe を保存",
    saveStudyRecipePlaceholder: "Signals lecture review loop",
    saveStudyRecipeDescription: "現在の workflow と chat パターンから再利用 recipe を作ります。",
    reviewSkillDraftTitle: "Skill 草案を確認",
    reviewSkillDraftPlaceholder: "生成した SKILL.md 草案を保存前に確認します。",
    reviewSkillDraftDescription: (targetPath, diff) => `保存先: ${targetPath}\n${diff}`,
  },
  notices: {
    selectTextFirst: "先にテキストを選択してください。",
    noPendingPatch: "保留中の Codex patch はありません。",
    noPatchTarget: "Codex patch の対象がありません。",
    cannotForkConversation: "この conversation は fork できません。",
    noResumableThread: "このタブに再開可能な Codex thread はありません。",
    noOpenLeaf: "Study ワークスペース用の Obsidian leaf を確保できませんでした。",
    cannotStartNewSession: "Codex が応答中のため、新しい session を開始できません。",
    blockedLegacyLauncherNotice: "危険な legacy Codex launcher を拒否して安全な既定値へ戻しました。Codex runtime 設定を確認してください。",
    provideSearchQuery: "検索クエリを入力してください。",
    openChatsLimited: (max) => `開ける chat は最大 ${max} 個です。`,
    updateExistingRecipe: (title, diff) => `同名の recipe が見つかりました: ${title}\n${diff}\n\nOK で更新、キャンセルで新しいコピーを保存します。`,
    recipeCopyCreated: (title) => `新しい recipe コピーを保存しました: ${title}。`,
  },
  settings: {
    title: "Codex Noteforge",
    languageName: "表示言語",
    languageDesc: "Obsidian の言語に追従するか、この plugin の UI 言語を上書きします。",
    languageFollowApp: "Obsidian に追従",
    languageEnglish: "English",
    languageJapanese: "日本語",
    authenticationName: "認証",
    authenticationDesc: "このマシンで `codex login` を実行してください。この plugin はローカルの Codex login を使い、通常利用では OpenAI API key を必要としません。",
    codexModelName: "Codex model",
    codexModelDesc: "新しい turn に使う model です。",
    defaultReasoningEffortName: "既定の reasoning effort",
    defaultReasoningEffortDesc: "新しい chat を始めるときに使う reasoning effort です。",
    permissionModeName: "Permission mode",
    permissionModeDesc: "Plan mode 以外で新しい turn を始めるときの既定実行モードです。",
    codexRuntimeName: "Codex runtime",
    codexRuntimeDesc: "plugin が Codex を直接起動するか、WSL 経由で起動するかを選びます。",
    codexExecutableName: "Codex executable path",
    codexExecutableDesc: "実行ファイルパスだけを指定します。例: `codex`, `codex.cmd`, `codex.exe`, または絶対パスの実行ファイル。`bash -lc` や `cmd /c` のような shell launcher は拒否されます。",
    runtimeWarningTitle: "実行時の警告",
    blockedLegacyLauncherWarning: (command) =>
      `危険な legacy Codex launcher を拒否して安全な既定値へ戻しました。Codex runtime / executable の設定を確認してください。拒否した値: ${command}`,
    extraSkillRootsName: "追加 skill root",
    extraSkillRootsDesc: "SKILL.md bundle を追加で走査するディレクトリです。絶対パスを 1 行 1 件で入力してください。",
    showReasoningName: "Reasoning を表示",
    showReasoningDesc: "model が reasoning delta を返したときに描画します。",
    autoRestoreTabsName: "タブを自動復元",
    autoRestoreTabsDesc: "workspace を開いたときに保存済みタブと transcript を復元します。",
  },
  workspace: {
    title: "Codex Noteforge",
    header: {
      newTab: "新しいタブ",
      newSession: "新しい session",
      forkConversation: "Conversation を fork",
      resumeThread: "Thread を新しいタブで再開",
      compactConversation: "Conversation を compact",
      settings: "設定",
    },
    planMode: "Plan mode",
    defaultComposerPlaceholder: "講義、論文、宿題、ノートについて質問してください...",
    attachLocalFiles: "ローカルファイルを添付",
    send: "送信",
    sending: "送信中",
    selectModel: "Model を選択",
    selectThinkingLevel: "Thinking level を選択",
    modelMenuTitle: "Model",
    thinkingMenuTitle: "Thinking",
    toggleFastMode: "Fast mode を切り替え",
    fastMode: "Fast mode",
    fastModeHint: "最速推論 · プラン使用量 2 倍",
    fastModeStreamingTooltip: "Fast mode は現在の turn 完了後に切り替えできます。",
    toggleYolo: "Auto-apply を切り替え",
    yolo: "Auto-apply",
    autoApplyDisabledTooltip: "Read only mode では Auto-apply は無効です。Settings の Permission mode から変更してください。",
    effectiveState: "実効状態",
    executionPlanning: "Planning",
    executionArmed: "実装可能",
    executionEditing: "Edit automatically",
    executionAssisted: "Edit with approval",
    executionReadOnly: "Read only",
    planYoloWarning: "Plan mode は read-only のままです。Implement now を使うには Edit automatically に切り替えてください。",
    implementNow: "Implement now",
    implementNowNotReady: "プランはまだ実行できる状態ではありません。",
    implementNowConfirm: (summary) =>
      ["この plan を実行しますか？", summary.trim() || null].filter((line): line is string => Boolean(line)).join("\n"),
    referenceNote: "参照ノート",
    removeReferenceNote: "この conversation から参照ノートを外す",
    currentNote: "現在のノート",
    dailyNote: "Daily note",
    pinnedContext: "固定 context",
    clearAll: "すべて外す",
    removePinnedContext: (name) => `固定 context から ${name} を外す`,
    ingestHubTitle: "Panel Studio",
    ingestHubSubtitle: "この workspace で使う panel、prompt、skills を整える編集ハブです。",
    expandIngestHub: "Panel Studio を展開",
    collapseIngestHub: "Panel Studio を折りたたむ",
    attachFriendly: "添付向き",
    seedPrompt: "Prompt を入れる",
    attachFiles: "ファイルを添付",
    saveAsStudyRecipe: "現在の流れを保存",
    activeWorkflow: (label) => `現在 ${label}`,
    activePanel: (label) => `Panel ${label}`,
    addPanel: "Panel を追加",
    createPanelTitle: "新しい panel",
    createPanelSave: "Panel を作成",
    closeCreatePanel: "新しい panel を閉じる",
    panelSkills: "Skills",
    untitledPanel: "無題の panel",
    panelTitlePlaceholder: "信号処理の試験ドリル",
    panelDescriptionPlaceholder: "この panel を何のために使うか、いつ使うかを書いてください。",
    panelPromptPlaceholder: "講義、論文、宿題、ノート、またはこの panel で回したい workflow への依頼を書いてください。",
    editPanel: "Panel を編集",
    cancelEdit: "編集を取り消す",
    deletePanel: "Panel を削除",
    deletePanelConfirm: (title) => `「${title}」panel を削除しますか。`,
    discardNewPanelConfirm: "この新しい panel の下書きを破棄しますか。",
    linkedSkills: "紐づけた skills",
    availableSkills: "持っている skills",
    noLinkedSkills: "まだ紐づけた skill はありません。",
    noLinkedSkillsHint: "Panel を編集して、この panel に使う skill を紐づけてください。",
    useSelectedSkills: "選択した skills を使う",
    noSelectedSkills: "skill が選択されていません",
    updatePanel: "Panel を更新",
    saveAsNewPanel: "新しい panel として保存",
    skipSuggestion: "今はしない",
    reflectInNote: "ノートに反映",
    reflectInNoteQuestion: "ノートに反映しますか？",
    evidence: "根拠",
    webBackedPatch: "Web根拠",
    openedAt: (text) => `Opened ${text}`,
    note: (name) => `ノート ${name}`,
    studyRecipes: "Captured recipes",
    studyRecipesSubtitle: "うまくいった学習フローを再利用 recipe にして、固まったら skill へ昇格します。",
    noStudyRecipes: "まだ study recipe はありません。現在の chat から成功した workflow を保存してください。",
    recipeAlias: (alias) => `Alias ${alias}`,
    useInChat: "chat に使う",
    promoteToSkill: "skill に昇格",
    updateSkill: "skill を更新",
    contextReady: "この context で実行可能",
    recipeNeedsContext: "追加 context が必要",
    promotedAs: (skillName) => `$${skillName} として昇格済み`,
    recipeUses: (count) => `${count} 回使用`,
    conversationContext: "Conversation context",
    forked: "Forked",
    resumed: "Resumed",
    compactedAt: (text) => `Compact ${text}`,
    showingLastItems: (count) => `直近 ${count} 件を表示`,
    instructions: "Instructions",
    modifiers: "Modifiers",
    addModifier: "Modifier",
    removeInstruction: (label) => `#${label} を外す`,
    clearPanelContext: (label) => `${label} panel の文脈を外す`,
    pendingApprovals: "保留中の approval",
    approveAll: "すべて承認",
    approveAllConfirm: (count, targets) =>
      [`${count} 件の保留中の変更を承認しますか？`, targets.trim() ? `対象: ${targets}` : null]
        .filter((line): line is string => Boolean(line))
        .join("\n"),
    thisSession: "この session",
    denyAll: "すべて拒否",
    selectedText: "選択テキスト",
    attachedFiles: (count) => (count ? `添付ファイル (${count})` : "添付ファイル"),
    approvalRequired: "承認が必要",
    approve: "承認",
    deny: "拒否",
    abort: "中止",
    selection: "選択範囲",
    response: "期待する応答",
    removeSelectedText: "この chat から選択テキストを外す",
    removeAttachment: (name) => `${name} を外す`,
    saveAsRecipe: "Recipe として保存",
    dismiss: "閉じる",
    runOnCurrentNote: "現在のノートで実行",
    runOnSearch: "検索で実行",
    delete: "削除",
    changes: "変更",
    open: "開く",
    apply: "適用",
    retry: "Rebase して適用",
    reject: "却下",
    conflictModalTitle: (path) => `${path} の衝突を解決`,
    conflictCurrentContent: "現在の内容",
    conflictCodexProposal: "Codex の提案",
    conflictOverwrite: "提案で上書き",
    conflictKeepCurrent: "現在の内容を維持",
    conflictOpenInEditor: "エディタで手動マージ",
    conflictOverwriteChangedConfirm: "このダイアログを開いてからノートが変更されました。それでも Codex の提案で上書きしますか。",
    welcomeTitle: "Codex Noteforge",
    welcomeBody: "vault を講義、復習、論文、宿題の学習ワークスペースとして使います。Panel Studio から始めるか、そのまま chat で質問してください。",
    usageTitle: "Codex usage",
    noUsageYet: "まだ Codex usage はありません",
    usageRemainingAria: (label) => `${label} の残量`,
    usageTitleTooltip: (remaining, used, source) => `${remaining}% 残り, ${used}% 使用済み${source ? ` · ${source}` : ""}`,
    welcomeSuggestions: [
      "このノートを要約して",
      "このノートから学習ガイドを作って",
      "このノートの改善案を出して",
    ],
    usageSource: {
      live: "LIVE",
      recovered: "RECOVERED",
      restored: "RESTORED",
    },
    activityStatus: {
      running: "実行中",
      failed: "失敗",
      done: "完了",
    },
    backlinks: (count) => `Backlinks: ${count}`,
    topSources: (sources) => `主な参照元: ${sources}`,
    unresolvedSources: (sources) => `未解決の参照元: ${sources}`,
    changesProposedBelow: "下に変更案があります。",
    none: "なし",
    never: "never",
  },
  service: {
    newChatTitle: "新しい chat",
    studyChatTitle: "Study chat",
    reviewThisNoteFallback: "このノートを見直して、次のアクションを提案してください。",
    selectionSource: (path) => `${path} から選択したテキスト`,
    selectionLabel: "選択テキスト",
    fileSelectionLabel: (basename) => `${basename} の selection`,
    recipeSaved: (title) => `Recipe を保存しました: ${title}。`,
    studyRecipeSaved: (title, alias) => `Study recipe を保存しました: ${title} · ${alias}。`,
    studyRecipeSkillSaved: (title, skillName) => `${title} から skill を保存しました: $${skillName}。`,
    panelNothingToSave: (title) => `${title} panel はすでに現在の流れと一致しているので、新しく保存する差分はありません。`,
    panelSavePrompt: (title) => `${title} panel の流れが完了したようです。panel を更新するか、新しい variant として保存しますか。`,
    panelSavePromptWithSkill: (title, skillName) =>
      `${title} panel の流れが完了したようです。panel を更新するか、$${skillName} を更新しますか。`,
    panelSuggestionDismissed: (title) => `${title} の保存提案を見送りました。`,
    panelUpdated: (title) => `Panel を更新しました: ${title}。`,
    panelCopied: (title) => `新しい panel を保存しました: ${title}。`,
    panelSkillUpdated: (title, skillName) => `${title} panel から $${skillName} を更新しました。`,
    panelLimitReached: (max) => `Panel Studio は最大 ${max} 個までです。`,
    planImplementationStarted: "合意した plan から実装を開始します。",
    planImplementationRequiresYolo: "Plan mode から実装を始める前に Permission mode を Edit automatically に切り替えてください。",
    studyRecipeFallbackPrompt: "この学習 workflow を再利用できる形にまとめてください。",
    studyRecipeWorkflowRequired: "Study recipe を保存する前に lecture / review / paper / homework workflow を始めてください。",
    selectTextBeforeAsking: "Codex に聞く前にテキストを選択してください。",
    approvalAborted: (title) => `中止: ${title}`,
    approvalDenied: (title) => `拒否: ${title}`,
    approvalApplied: (title) => `${title} を適用しました。`,
    batchApprovalFinished: (applied, denied, failed) => `一括 approval が完了しました。適用: ${applied}、拒否: ${denied}、失敗: ${failed}。`,
    patchCreated: (path) => `${path} を作成しました`,
    patchApplied: (path) => `${path} にパッチを正常に適用しました。`,
    patchRejected: (path) => `${path} への patch を却下しました`,
    patchNeedsReview: (path) => `${path} は自動適用できないため、手動で review してください。`,
    patchTargetMissing: (path) => `${path} はまだ存在しません。`,
    unsafeNotePathBlocked: (path) => `安全でないノート path を拒否しました: ${path}`,
    unsafeVaultOpBlocked: (path) => `安全でないファイル操作の対象を拒否しました: ${path}`,
    autoApplyReviewFallback: (limit) => `この turn では ${limit} 件を超えたため自動ノート編集を停止しました。残りの変更を手動で review してください。`,
    noActiveNoteToPin: "固定するアクティブなノートがありません。",
    dailyNoteNotFound: "今日の daily note が見つかりませんでした。",
    tabAlreadyRunning: "このタブはすでに実行中です。完了を待つか、先に中断してください。",
    promptEmptyAfterExpansion: "slash command 展開後に prompt が空になりました。",
    interruptRequested: "中断を要求しました。",
    turnInterrupted: "turn を中断しました。",
    invalidPatchRepairing: "Codex が無効な note patch を返したため、plugin が修正版 proposal を再要求しています。",
    invalidPatchRepairFailed: "Codex から有効な note patch が返らなかったため、何も適用されていません。",
    applyLatestPatchAmbiguous: (count) => `${count} 件の note patch が保留中です。適用前に Changes tray から対象を選んでください。`,
    proposalProcessingFailed: (message) => `Codex proposal の処理に失敗しました: ${message}`,
  },
};

export function normalizeSupportedLocale(value: string | null | undefined): SupportedLocale {
  if (!value) {
    return "en";
  }
  return value.toLowerCase().startsWith("ja") ? "ja" : "en";
}

export function normalizeUiLanguageSetting(value: string | null | undefined): UiLanguageSetting | null {
  if (value === "app" || value === "en" || value === "ja") {
    return value;
  }
  return null;
}

export function resolveUiLocale(setting: UiLanguageSetting, appLanguage = "en"): SupportedLocale {
  return setting === "app" ? normalizeSupportedLocale(appLanguage) : setting;
}

export function getLocaleDateTag(locale: SupportedLocale): string {
  return locale === "ja" ? "ja-JP" : "en-US";
}

export function getLocalizedCopy(locale: SupportedLocale): LocalizedCopy {
  return locale === "ja" ? JA_COPY : EN_COPY;
}
