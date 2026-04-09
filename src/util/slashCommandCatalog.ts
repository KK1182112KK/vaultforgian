import type { SupportedLocale } from "./i18n";

export interface SlashCommandDefinition {
  command: string;
  label: string;
  description: string;
  source?: "builtin" | "custom_prompt" | "skill_alias";
  mode?: "context" | "proposal" | "prompt" | "skill_alias" | "campaign";
  skillName?: string;
}

const SLASH_COMMANDS: readonly SlashCommandDefinition[] = [
  {
    command: "/note",
    label: "Current note",
    description: "Attach the open note before your question.",
    source: "builtin",
    mode: "context",
  },
  {
    command: "/selection",
    label: "Selection",
    description: "Attach the selected text from the editor.",
    source: "builtin",
    mode: "context",
  },
  {
    command: "/daily",
    label: "Daily note",
    description: "Attach today's daily note before your question.",
    source: "builtin",
    mode: "context",
  },
  {
    command: "/backlinks",
    label: "Backlinks",
    description: "Attach backlinks for the current or reference note.",
    source: "builtin",
    mode: "context",
  },
  {
    command: "/history",
    label: "History",
    description: "Attach note timestamps and recent Codex patch history.",
    source: "builtin",
    mode: "context",
  },
  {
    command: "/diff",
    label: "Diff",
    description: "Attach the latest Codex diff for the current or reference note.",
    source: "builtin",
    mode: "context",
  },
  {
    command: "/unresolved",
    label: "Unresolved",
    description: "Attach unresolved links from the current or reference note.",
    source: "builtin",
    mode: "context",
  },
  {
    command: "/searchctx",
    label: "Search context",
    description: "Attach vault search results before your question.",
    source: "builtin",
    mode: "context",
  },
  {
    command: "/campaign",
    label: "Refactor campaign",
    description: "Build a coordinated refactor campaign from a search result set.",
    source: "builtin",
    mode: "campaign",
  },
  {
    command: "/set",
    label: "Smart Set",
    description: "Create a Smart Set from a natural-language query.",
    source: "builtin",
    mode: "prompt",
  },
  {
    command: "/set-run",
    label: "Run Smart Set",
    description: "Refresh the active or named Smart Set.",
    source: "builtin",
    mode: "prompt",
  },
  {
    command: "/set-drift",
    label: "Smart Set drift",
    description: "Compare the active or named Smart Set against its last snapshot.",
    source: "builtin",
    mode: "prompt",
  },
  {
    command: "/set-campaign",
    label: "Smart Set campaign",
    description: "Launch a refactor campaign from the active or named Smart Set snapshot.",
    source: "builtin",
    mode: "prompt",
  },
  {
    command: "/rename-plan",
    label: "Rename plan",
    description: "Ask Codex for a backlink-safe rename proposal.",
    source: "builtin",
    mode: "proposal",
  },
  {
    command: "/move-plan",
    label: "Move plan",
    description: "Ask Codex for a backlink-safe move proposal.",
    source: "builtin",
    mode: "proposal",
  },
  {
    command: "/property-plan",
    label: "Property plan",
    description: "Ask Codex for a note property update proposal.",
    source: "builtin",
    mode: "proposal",
  },
  {
    command: "/task-plan",
    label: "Task plan",
    description: "Ask Codex for a task update proposal.",
    source: "builtin",
    mode: "proposal",
  },
];

export function getSlashCommandCatalog(locale: SupportedLocale = "en"): readonly SlashCommandDefinition[] {
  if (locale === "ja") {
    return [
      { ...SLASH_COMMANDS[0], label: "現在のノート", description: "質問の前に、開いているノートを添付します。" },
      { ...SLASH_COMMANDS[1], label: "選択範囲", description: "エディタで選択しているテキストを添付します。" },
      { ...SLASH_COMMANDS[2], label: "Daily note", description: "質問の前に、今日の daily note を添付します。" },
      { ...SLASH_COMMANDS[3], label: "Backlinks", description: "現在または参照ノートの backlinks を添付します。" },
      { ...SLASH_COMMANDS[4], label: "履歴", description: "ノートの timestamp と最近の Codex patch 履歴を添付します。" },
      { ...SLASH_COMMANDS[5], label: "Diff", description: "現在または参照ノートの最新 Codex diff を添付します。" },
      { ...SLASH_COMMANDS[6], label: "未解決リンク", description: "現在または参照ノートの unresolved link を添付します。" },
      { ...SLASH_COMMANDS[7], label: "検索コンテキスト", description: "質問の前に vault 検索結果を添付します。" },
      { ...SLASH_COMMANDS[8], label: "Refactor campaign", description: "検索結果セットから協調 refactor campaign を組み立てます。" },
      { ...SLASH_COMMANDS[9], label: "Smart Set", description: "自然言語クエリから Smart Set を作成します。" },
      { ...SLASH_COMMANDS[10], label: "Smart Set 実行", description: "アクティブまたは指定した Smart Set を更新します。" },
      { ...SLASH_COMMANDS[11], label: "Smart Set drift", description: "アクティブまたは指定した Smart Set を前回 snapshot と比較します。" },
      { ...SLASH_COMMANDS[12], label: "Smart Set campaign", description: "アクティブまたは指定した Smart Set snapshot から refactor campaign を開始します。" },
      { ...SLASH_COMMANDS[13], label: "Rename plan", description: "backlink-safe な rename proposal を Codex に依頼します。" },
      { ...SLASH_COMMANDS[14], label: "Move plan", description: "backlink-safe な move proposal を Codex に依頼します。" },
      { ...SLASH_COMMANDS[15], label: "Property plan", description: "ノート property 更新 proposal を Codex に依頼します。" },
      { ...SLASH_COMMANDS[16], label: "Task plan", description: "task 更新 proposal を Codex に依頼します。" },
    ] as const;
  }
  return SLASH_COMMANDS;
}

export function matchSlashCommands(
  input: string,
  commands: readonly SlashCommandDefinition[] = SLASH_COMMANDS,
): SlashCommandDefinition[] {
  const trimmedStart = input.trimStart();
  if (!trimmedStart.startsWith("/")) {
    return [];
  }

  const firstSpace = trimmedStart.indexOf(" ");
  const commandFragment = (firstSpace < 0 ? trimmedStart : trimmedStart.slice(0, firstSpace)).toLowerCase();
  if (!commandFragment) {
    return [];
  }

  return commands.filter((entry) => entry.command.toLowerCase().startsWith(commandFragment));
}
