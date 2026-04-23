import { basename } from "node:path";
import type { StudyRecipe } from "../model/types";
import type { LocalizedCopy, SupportedLocale } from "./i18n";
import { getStudyRecipeWorkflowLabel } from "./studyWorkflows";

interface PluginFeatureGuideParams {
  prompt: string;
  locale: SupportedLocale;
  copy: LocalizedCopy;
  panels: readonly StudyRecipe[];
  activePanelId: string | null;
  isCollapsed: boolean;
  targetNotePath: string | null;
}

function buildPanelStudioGuide(params: PluginFeatureGuideParams): string {
  const { activePanelId, copy, isCollapsed, locale, panels, targetNotePath } = params;
  const activePanel = activePanelId ? panels.find((entry) => entry.id === activePanelId) ?? null : null;
  const formatPanelTitle = (title: string): string => title.trim() || copy.workspace.untitledPanel;
  const lines =
    locale === "ja"
      ? [
          "Plugin feature guide: Panel Studio",
          "ユーザーはこのプラグイン内の Panel Studio について聞いています。generic な import/ingest 手順や、ローカル検索失敗を前提にした説明へ落とさず、このガイドを優先して答えてください。",
          "現在の状態",
          `- panel 数: ${panels.length}/6`,
          `- 表示状態: ${isCollapsed ? "折りたたみ" : "展開"}`,
          `- アクティブ panel: ${activePanel ? formatPanelTitle(activePanel.title) : copy.workspace.none}`,
          `- 対象ノート: ${targetNotePath ? basename(targetNotePath) : copy.workspace.none}`,
          "実際の使い方",
          `- header のトグルで Panel Studio を展開・折りたたみできます。`,
          `- ${copy.workspace.addPanel} で空の panel を追加できます。最大 6 個までで、追加直後に編集状態で開きます。`,
          `- 各 panel は inline 編集できます。編集対象は title、description、prompt template、linked skills です。`,
          `- 各 panel の主な操作は 2 つです: ${copy.workspace.seedPrompt} と ${copy.workspace.panelSkills}。`,
          `- ${copy.workspace.seedPrompt} はその panel の prompt template を composer に入れて、panel をアクティブにします。`,
          `- ${copy.workspace.panelSkills} はその panel に紐づけた skills の drawer を開きます。`,
          `- drawer では skill を個別に押して composer へ追加することも、複数選択してまとめて追加することもできます。`,
          `- skill を使うと composer の先頭に /skill-name が入り、その下に panel prompt が続きます。自動送信はされません。`,
          `- linked skill が 0 件でも Skills drawer は開き、empty state と編集ヒントを表示します。`,
          `- panel には添付ボタンはありません。ファイル添付は下部 composer から行います。`,
          `- panel を選んだとき、composer 上には長い説明文ではなく短い panel label だけが出ます。`,
          `- Panel Studio を開いたまま chat を送信すると、送信後に Studio は自動で折りたたまれます。`,
          "現在の panel 一覧",
          ...panels.map((panel) => {
            const workflowLabel = getStudyRecipeWorkflowLabel(panel.workflow, locale);
            return `- ${formatPanelTitle(panel.title)} (${workflowLabel}) · alias ${panel.commandAlias} · skills ${panel.linkedSkillNames.length}`;
          }),
        ]
      : [
          "Plugin feature guide: Panel Studio",
          "The user is asking about this plugin's built-in Panel Studio. Do not fall back to generic import/ingest instructions or local-search-failed disclaimers when this guide answers the question.",
          "Current state",
          `- Panel count: ${panels.length}/6`,
          `- Visibility: ${isCollapsed ? "collapsed" : "expanded"}`,
          `- Active panel: ${activePanel ? formatPanelTitle(activePanel.title) : copy.workspace.none}`,
          `- Target note: ${targetNotePath ? basename(targetNotePath) : copy.workspace.none}`,
          "Actual behavior",
          "- Use the header toggle to expand or collapse Panel Studio.",
          `- ${copy.workspace.addPanel} adds a blank panel. The hub supports up to 6 panels and opens the new panel directly in edit mode.`,
          "- Each panel is editable inline for title, description, prompt template, and linked skills.",
          `- Each panel has two main actions: ${copy.workspace.seedPrompt} and ${copy.workspace.panelSkills}.`,
          `- ${copy.workspace.seedPrompt} places that panel's prompt template into the composer and marks the panel active.`,
          `- ${copy.workspace.panelSkills} opens the drawer for skills linked to that panel.`,
          "- The drawer supports both single-click insertion and multi-select insertion for linked skills.",
          "- Using a skill inserts /skill-name at the top of the composer, followed by the panel prompt. It does not auto-send.",
          "- A panel with zero linked skills still opens the Skills drawer and shows the empty-state hint.",
          "- Panels do not include an attach-file button. File attachment lives in the lower composer.",
          "- Selecting a panel shows only a compact panel label above the composer instead of a long description block.",
          "- Sending chat while Panel Studio is open auto-collapses the studio after the send succeeds.",
          "Current panels",
          ...panels.map((panel) => {
            const workflowLabel = getStudyRecipeWorkflowLabel(panel.workflow, locale);
            return `- ${formatPanelTitle(panel.title)} (${workflowLabel}) · alias ${panel.commandAlias} · skills ${panel.linkedSkillNames.length}`;
          }),
        ];

  return lines.join("\n");
}

export function buildPluginFeatureGuideText(params: PluginFeatureGuideParams): string | null {
  if (mentionsPanelStudioPrompt(params.prompt, params.copy.workspace.ingestHubTitle)) {
    return buildPanelStudioGuide(params);
  }
  return null;
}

function mentionsPanelStudioPrompt(prompt: string, localizedTitle: string): boolean {
  const normalizedPrompt = normalizePromptText(prompt);
  const aliases = ["panel studio", "ingest hub", "パネルスタジオ", localizedTitle]
    .map((value) => normalizePromptText(value))
    .filter(Boolean);
  return aliases.some((alias) => normalizedPrompt.includes(alias));
}

function normalizePromptText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
