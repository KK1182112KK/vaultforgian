import type { ChatSuggestionAction } from "../../model/types";
import type { App, Component, MarkdownView, TFile } from "obsidian";
import type { CodexService } from "../../app/codexService";
import type { WorkspaceState } from "../../model/types";
import type { LocalizedCopy, SupportedLocale } from "../../util/i18n";

export interface WorkspaceRenderContext {
  app: App;
  service: CodexService;
  state: WorkspaceState;
  activeTab: WorkspaceState["tabs"][number] | null;
  isNarrowLayout: boolean;
  locale: SupportedLocale;
  copy: LocalizedCopy;
}

export interface WorkspaceRenderCallbacks {
  markdownComponent: Component;
  openSettings(): void;
  requestRender(): void;
  focusComposer(): void;
  seedDraftAndSend(prompt: string): Promise<void>;
  respondToChatSuggestion(action: ChatSuggestionAction): Promise<void>;
  resolvePromptContext(): { file: TFile | null; editor: MarkdownView["editor"] | null };
  attachBrowserFiles(files: File[], source: "clipboard" | "picker"): Promise<void>;
  openTargetNote(): Promise<void>;
}
