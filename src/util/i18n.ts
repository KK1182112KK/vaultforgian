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
    togglePlanMode: string;
    forkConversation: string;
    resumeThread: string;
    compactConversation: string;
    createSmartSet: string;
    openSmartSetPanel: string;
    runActiveSmartSet: string;
    pinCurrentNote: string;
    pinDailyNote: string;
    clearContextPack: string;
  };
  prompts: {
    fieldLabel: string;
    cancel: string;
    send: string;
    askAboutThisNoteTitle: string;
    askAboutThisNotePlaceholder: string;
    askAboutThisNoteDescription: string;
    refactorCampaignTitle: string;
    refactorCampaignPlaceholder: string;
    refactorCampaignDescription: string;
    createSmartSetTitle: string;
    createSmartSetPlaceholder: string;
    createSmartSetDescription: string;
  };
  notices: {
    selectTextFirst: string;
    noPendingPatch: string;
    noPatchTarget: string;
    cannotForkConversation: string;
    noResumableThread: string;
    noActiveSmartSet: string;
    noOpenLeaf: string;
    cannotStartNewSession: string;
    provideSearchQuery: string;
    openChatsLimited: (max: number) => string;
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
    codexCommandName: string;
    codexCommandDesc: string;
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
    selectModel: string;
    selectThinkingLevel: string;
    toggleYolo: string;
    yolo: string;
    referenceNote: string;
    removeReferenceNote: string;
    currentNote: string;
    ingestHubTitle: string;
    ingestHubSubtitle: string;
    expandIngestHub: string;
    collapseIngestHub: string;
    attachFriendly: string;
    seedPrompt: string;
    attachFiles: string;
    activeWorkflow: (label: string) => string;
    openedAt: (text: string) => string;
    note: (name: string) => string;
    smartSets: string;
    notesCount: (count: number) => string;
    runAt: (text: string) => string;
    snapshotAt: (text: string) => string;
    noSnapshot: string;
    run: string;
    viewDrift: string;
    openNote: string;
    conversationContext: string;
    forked: string;
    resumed: string;
    compactedAt: (text: string) => string;
    showingLastItems: (count: number) => string;
    instructions: string;
    removeInstruction: (label: string) => string;
    pendingApprovals: string;
    approveAll: string;
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
    includeCampaignItem: (title: string) => string;
    applyCampaign: string;
    rollbackCampaign: string;
    saveAsRecipe: string;
    dismiss: string;
    runOnCurrentNote: string;
    runOnActiveSmartSet: string;
    runOnSearch: string;
    delete: string;
    changes: string;
    open: string;
    apply: string;
    retry: string;
    reject: string;
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
    smartSetSaved: (title: string, count: number) => string;
    smartSetRefreshed: (title: string, count: number) => string;
    smartSetSnapshotRefreshed: (title: string) => string;
    smartSetSnapshotBaseline: (title: string) => string;
    smartSetDrift: (title: string, added: number, removed: number, changed: number) => string;
    recipeSaved: (title: string) => string;
    selectTextBeforeAsking: string;
    approvalAborted: (title: string) => string;
    approvalDenied: (title: string) => string;
    approvalApplied: (title: string) => string;
    batchApprovalFinished: (applied: number, denied: number, failed: number) => string;
    patchCreated: (path: string) => string;
    patchApplied: (path: string) => string;
    patchRejected: (path: string) => string;
    patchTargetMissing: (path: string) => string;
    noActiveNoteToPin: string;
    dailyNoteNotFound: string;
    tabAlreadyRunning: string;
    promptEmptyAfterExpansion: string;
    interruptRequested: string;
    turnInterrupted: string;
    campaignReady: (items: number, notes: number) => string;
    campaignReadyNoChanges: (notes: number) => string;
    proposalProcessingFailed: (message: string) => string;
  };
}

const EN_COPY: LocalizedCopy = {
  pluginName: "Obsidian Codex Study",
  pluginDescription: "Study-first Codex workspace for Obsidian",
  ribbon: {
    openWorkspace: "Open Study workspace",
  },
  commands: {
    openWorkspace: "Open Study workspace",
    openIngestHub: "Open Ingest Hub",
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
    togglePlanMode: "Toggle Codex plan mode",
    forkConversation: "Fork Codex conversation",
    resumeThread: "Resume Codex thread in new tab",
    compactConversation: "Compact Codex conversation",
    createSmartSet: "Create Smart Set",
    openSmartSetPanel: "Open Smart Set panel",
    runActiveSmartSet: "Run active Smart Set",
    pinCurrentNote: "Pin current note to Codex context",
    pinDailyNote: "Pin daily note to Codex context",
    clearContextPack: "Clear Codex context pack",
  },
  prompts: {
    fieldLabel: "Prompt",
    cancel: "Cancel",
    send: "Send",
    askAboutThisNoteTitle: "Ask About This Note",
    askAboutThisNotePlaceholder: "Summarize this note and suggest the next steps.",
    askAboutThisNoteDescription: "Leave blank to use the default note-review prompt.",
    refactorCampaignTitle: "Start Codex Refactor Campaign",
    refactorCampaignPlaceholder: "lecture notes ai",
    refactorCampaignDescription: "Enter a search query for the notes to include in this campaign.",
    createSmartSetTitle: "Create Smart Set",
    createSmartSetPlaceholder: "control lectures except archived",
    createSmartSetDescription: "Enter a natural-language query for the Smart Set.",
  },
  notices: {
    selectTextFirst: "Select some text first.",
    noPendingPatch: "No pending Codex patch.",
    noPatchTarget: "No Codex patch target.",
    cannotForkConversation: "Cannot fork this conversation.",
    noResumableThread: "No resumable Codex thread on this tab.",
    noActiveSmartSet: "No active Smart Set.",
    noOpenLeaf: "Failed to allocate an Obsidian leaf for the Study workspace.",
    cannotStartNewSession: "Cannot start a new session while Codex is responding.",
    provideSearchQuery: "Provide a search query.",
    openChatsLimited: (max) => `Open chats are limited to ${max}.`,
  },
  settings: {
    title: "Obsidian Codex Study",
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
    codexCommandName: "Codex command",
    codexCommandDesc: "Launcher used by the plugin. You can set `codex`, an absolute executable path, `wsl.exe -e codex`, or `wsl.exe -e bash -lc codex`. Leaving `codex` enables auto-detection of the local install.",
    extraSkillRootsName: "Extra skill roots",
    extraSkillRootsDesc: "Additional directories to scan for SKILL.md bundles. Enter one absolute path per line.",
    showReasoningName: "Show reasoning",
    showReasoningDesc: "Render reasoning deltas when the model emits them.",
    autoRestoreTabsName: "Auto restore tabs",
    autoRestoreTabsDesc: "Restore saved tabs and transcripts when the workspace opens.",
  },
  workspace: {
    title: "Obsidian Codex Study",
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
    selectModel: "Select model",
    selectThinkingLevel: "Select thinking level",
    toggleYolo: "Toggle YOLO mode",
    yolo: "YOLO",
    referenceNote: "Reference note",
    removeReferenceNote: "Remove reference note from this conversation",
    currentNote: "Current note",
    ingestHubTitle: "Ingest Hub",
    ingestHubSubtitle: "Start from lecture material, papers, homework, or a review scope.",
    expandIngestHub: "Expand Ingest Hub",
    collapseIngestHub: "Collapse Ingest Hub",
    attachFriendly: "Attach-friendly",
    seedPrompt: "Seed prompt",
    attachFiles: "Attach files",
    activeWorkflow: (label) => `Active ${label}`,
    openedAt: (text) => `Opened ${text}`,
    note: (name) => `Note ${name}`,
    smartSets: "Smart Sets",
    notesCount: (count) => `${count} notes`,
    runAt: (text) => `Run ${text}`,
    snapshotAt: (text) => `Snapshot ${text}`,
    noSnapshot: "No snapshot",
    run: "Run",
    viewDrift: "View drift",
    openNote: "Open note",
    conversationContext: "Conversation context",
    forked: "Forked",
    resumed: "Resumed",
    compactedAt: (text) => `Compacted ${text}`,
    showingLastItems: (count) => `Showing last ${count} items`,
    instructions: "Instructions",
    removeInstruction: (label) => `Remove #${label}`,
    pendingApprovals: "Pending approvals",
    approveAll: "Approve all",
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
    includeCampaignItem: (title) => `Include ${title} in this campaign`,
    applyCampaign: "Apply campaign",
    rollbackCampaign: "Rollback campaign",
    saveAsRecipe: "Save as recipe",
    dismiss: "Dismiss",
    runOnCurrentNote: "Run on current note",
    runOnActiveSmartSet: "Run on active Smart Set",
    runOnSearch: "Run on search",
    delete: "Delete",
    changes: "Changes",
    open: "Open",
    apply: "Apply",
    retry: "Retry",
    reject: "Reject",
    welcomeTitle: "Obsidian Codex Study",
    welcomeBody: "Use your vault as a study workspace for lectures, review loops, papers, and homework. Seed a workflow from the Ingest Hub or ask directly in chat.",
    usageTitle: "Codex usage",
    noUsageYet: "No Codex usage yet",
    usageRemainingAria: (label) => `${label} remaining`,
    usageTitleTooltip: (remaining, used, source) => `${remaining}% left, ${used}% used${source ? ` · ${source}` : ""}`,
    welcomeSuggestions: [
      "Create a lecture study guide from the current material",
      "Plan a focused review session from this note set",
      "Read the attached paper deeply",
      "Help me unpack this homework step by step",
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
    smartSetSaved: (title, count) => `Smart Set saved: ${title} · ${count} notes.`,
    smartSetRefreshed: (title, count) => `Smart Set refreshed: ${title} · ${count} notes.`,
    smartSetSnapshotRefreshed: (title) => `Smart Set snapshot refreshed: ${title}.`,
    smartSetSnapshotBaseline: (title) => `Smart Set snapshot created for drift baseline: ${title}.`,
    smartSetDrift: (title, added, removed, changed) => `Smart Set drift: ${title} · +${added} / -${removed} / Δ${changed}.`,
    recipeSaved: (title) => `Recipe saved: ${title}.`,
    selectTextBeforeAsking: "Select some text before asking Codex about it.",
    approvalAborted: (title) => `Aborted: ${title}`,
    approvalDenied: (title) => `Denied: ${title}`,
    approvalApplied: (title) => `${title} applied.`,
    batchApprovalFinished: (applied, denied, failed) => `Batch approval finished. Applied: ${applied}, denied: ${denied}, failed: ${failed}.`,
    patchCreated: (path) => `Created ${path}`,
    patchApplied: (path) => `Patched ${path}`,
    patchRejected: (path) => `Rejected patch for ${path}`,
    patchTargetMissing: (path) => `${path} does not exist yet.`,
    noActiveNoteToPin: "No active note to pin.",
    dailyNoteNotFound: "Today's daily note was not found.",
    tabAlreadyRunning: "This tab is already running. Wait for it to finish or interrupt it first.",
    promptEmptyAfterExpansion: "The prompt is empty after slash-command expansion.",
    interruptRequested: "Interrupt requested.",
    turnInterrupted: "Turn interrupted.",
    campaignReady: (items, notes) => `Refactor campaign ready: ${items} items across ${notes} notes.`,
    campaignReadyNoChanges: (notes) => `Refactor campaign ready: no changes proposed for ${notes} notes.`,
    proposalProcessingFailed: (message) => `Failed to process Codex proposals: ${message}`,
  },
};

const JA_COPY: LocalizedCopy = {
  pluginName: "Obsidian Codex Study",
  pluginDescription: "Obsidian 向け学習用 Codex ワークスペース",
  ribbon: {
    openWorkspace: "Study ワークスペースを開く",
  },
  commands: {
    openWorkspace: "Study ワークスペースを開く",
    openIngestHub: "Ingest Hub を開く",
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
    togglePlanMode: "Codex plan mode を切り替え",
    forkConversation: "Codex conversation を fork",
    resumeThread: "Codex thread を新しいタブで再開",
    compactConversation: "Codex conversation を compact",
    createSmartSet: "Smart Set を作成",
    openSmartSetPanel: "Smart Set パネルを開く",
    runActiveSmartSet: "アクティブな Smart Set を実行",
    pinCurrentNote: "現在のノートを Codex context に固定",
    pinDailyNote: "今日の daily note を Codex context に固定",
    clearContextPack: "Codex context pack をクリア",
  },
  prompts: {
    fieldLabel: "プロンプト",
    cancel: "キャンセル",
    send: "送信",
    askAboutThisNoteTitle: "このノートについて聞く",
    askAboutThisNotePlaceholder: "このノートを要約して、次のアクションを提案してください。",
    askAboutThisNoteDescription: "空欄なら既定のノートレビュー用プロンプトを使います。",
    refactorCampaignTitle: "Codex リファクタ campaign を開始",
    refactorCampaignPlaceholder: "lecture notes ai",
    refactorCampaignDescription: "この campaign に含めるノートの検索クエリを入力してください。",
    createSmartSetTitle: "Smart Set を作成",
    createSmartSetPlaceholder: "control lectures except archived",
    createSmartSetDescription: "Smart Set 用の自然言語クエリを入力してください。",
  },
  notices: {
    selectTextFirst: "先にテキストを選択してください。",
    noPendingPatch: "保留中の Codex patch はありません。",
    noPatchTarget: "Codex patch の対象がありません。",
    cannotForkConversation: "この conversation は fork できません。",
    noResumableThread: "このタブに再開可能な Codex thread はありません。",
    noActiveSmartSet: "アクティブな Smart Set がありません。",
    noOpenLeaf: "Study ワークスペース用の Obsidian leaf を確保できませんでした。",
    cannotStartNewSession: "Codex が応答中のため、新しい session を開始できません。",
    provideSearchQuery: "検索クエリを入力してください。",
    openChatsLimited: (max) => `開ける chat は最大 ${max} 個です。`,
  },
  settings: {
    title: "Obsidian Codex Study",
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
    codexCommandName: "Codex command",
    codexCommandDesc: "plugin が使う launcher です。`codex`、絶対パスの実行ファイル、`wsl.exe -e codex`、`wsl.exe -e bash -lc codex` を指定できます。`codex` のままならローカル install を自動検出します。",
    extraSkillRootsName: "追加 skill root",
    extraSkillRootsDesc: "SKILL.md bundle を追加で走査するディレクトリです。絶対パスを 1 行 1 件で入力してください。",
    showReasoningName: "Reasoning を表示",
    showReasoningDesc: "model が reasoning delta を返したときに描画します。",
    autoRestoreTabsName: "タブを自動復元",
    autoRestoreTabsDesc: "workspace を開いたときに保存済みタブと transcript を復元します。",
  },
  workspace: {
    title: "Obsidian Codex Study",
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
    selectModel: "Model を選択",
    selectThinkingLevel: "Thinking level を選択",
    toggleYolo: "YOLO mode を切り替え",
    yolo: "YOLO",
    referenceNote: "参照ノート",
    removeReferenceNote: "この conversation から参照ノートを外す",
    currentNote: "現在のノート",
    ingestHubTitle: "Ingest Hub",
    ingestHubSubtitle: "講義資料、論文、宿題、復習スコープから始めます。",
    expandIngestHub: "Ingest Hub を展開",
    collapseIngestHub: "Ingest Hub を折りたたむ",
    attachFriendly: "添付向き",
    seedPrompt: "Prompt を入れる",
    attachFiles: "ファイルを添付",
    activeWorkflow: (label) => `現在 ${label}`,
    openedAt: (text) => `Opened ${text}`,
    note: (name) => `ノート ${name}`,
    smartSets: "Smart Sets",
    notesCount: (count) => `${count} 件のノート`,
    runAt: (text) => `実行 ${text}`,
    snapshotAt: (text) => `Snapshot ${text}`,
    noSnapshot: "Snapshot なし",
    run: "実行",
    viewDrift: "差分を見る",
    openNote: "ノートを開く",
    conversationContext: "Conversation context",
    forked: "Forked",
    resumed: "Resumed",
    compactedAt: (text) => `Compact ${text}`,
    showingLastItems: (count) => `直近 ${count} 件を表示`,
    instructions: "Instructions",
    removeInstruction: (label) => `#${label} を外す`,
    pendingApprovals: "保留中の approval",
    approveAll: "すべて承認",
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
    includeCampaignItem: (title) => `この campaign に ${title} を含める`,
    applyCampaign: "Campaign を適用",
    rollbackCampaign: "Campaign を rollback",
    saveAsRecipe: "Recipe として保存",
    dismiss: "閉じる",
    runOnCurrentNote: "現在のノートで実行",
    runOnActiveSmartSet: "アクティブな Smart Set で実行",
    runOnSearch: "検索で実行",
    delete: "削除",
    changes: "変更",
    open: "開く",
    apply: "適用",
    retry: "再試行",
    reject: "却下",
    welcomeTitle: "Obsidian Codex Study",
    welcomeBody: "vault を講義、復習、論文、宿題の学習ワークスペースとして使います。Ingest Hub から workflow を始めるか、そのまま chat で質問してください。",
    usageTitle: "Codex usage",
    noUsageYet: "まだ Codex usage はありません",
    usageRemainingAria: (label) => `${label} の残量`,
    usageTitleTooltip: (remaining, used, source) => `${remaining}% 残り, ${used}% 使用済み${source ? ` · ${source}` : ""}`,
    welcomeSuggestions: [
      "現在の資料から講義の study guide を作って",
      "このノート集合から復習セッションを計画して",
      "添付した論文を深く読んで",
      "この宿題を順を追って解きほぐして",
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
    smartSetSaved: (title, count) => `Smart Set を保存しました: ${title} · ${count} 件のノート。`,
    smartSetRefreshed: (title, count) => `Smart Set を更新しました: ${title} · ${count} 件のノート。`,
    smartSetSnapshotRefreshed: (title) => `Smart Set snapshot を更新しました: ${title}。`,
    smartSetSnapshotBaseline: (title) => `Drift 用の snapshot baseline を作成しました: ${title}。`,
    smartSetDrift: (title, added, removed, changed) => `Smart Set drift: ${title} · +${added} / -${removed} / Δ${changed}。`,
    recipeSaved: (title) => `Recipe を保存しました: ${title}。`,
    selectTextBeforeAsking: "Codex に聞く前にテキストを選択してください。",
    approvalAborted: (title) => `中止: ${title}`,
    approvalDenied: (title) => `拒否: ${title}`,
    approvalApplied: (title) => `${title} を適用しました。`,
    batchApprovalFinished: (applied, denied, failed) => `一括 approval が完了しました。適用: ${applied}、拒否: ${denied}、失敗: ${failed}。`,
    patchCreated: (path) => `${path} を作成しました`,
    patchApplied: (path) => `${path} に patch を適用しました`,
    patchRejected: (path) => `${path} への patch を却下しました`,
    patchTargetMissing: (path) => `${path} はまだ存在しません。`,
    noActiveNoteToPin: "固定するアクティブなノートがありません。",
    dailyNoteNotFound: "今日の daily note が見つかりませんでした。",
    tabAlreadyRunning: "このタブはすでに実行中です。完了を待つか、先に中断してください。",
    promptEmptyAfterExpansion: "slash command 展開後に prompt が空になりました。",
    interruptRequested: "中断を要求しました。",
    turnInterrupted: "turn を中断しました。",
    campaignReady: (items, notes) => `Refactor campaign の準備ができました: ${notes} 件のノートに ${items} 件の項目があります。`,
    campaignReadyNoChanges: (notes) => `Refactor campaign の準備ができました: ${notes} 件のノートに対して変更提案はありません。`,
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
