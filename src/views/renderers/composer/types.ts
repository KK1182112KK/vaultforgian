import type { ComposerHistoryState } from "../../../util/composerHistory";
import type { ComposerSuggestion } from "../../../util/composerSuggestions";
import type { WorkspaceRenderCallbacks, WorkspaceRenderContext } from "../types";

export interface ComposerElements {
  root: HTMLDivElement;
  composerFlagsEl: HTMLDivElement;
  tabBarEl: HTMLDivElement;
  slashMenuEl: HTMLDivElement;
  contextRowEl: HTMLDivElement;
  referenceDocEl: HTMLDivElement;
  instructionRowEl: HTMLDivElement;
  selectionPreviewEl: HTMLDivElement;
  attachmentsRowEl: HTMLDivElement;
  changesTrayEl: HTMLDivElement;
  planModeTextEl: HTMLDivElement;
  workflowBriefEl: HTMLDivElement;
  inputRowEl: HTMLDivElement;
  attachButtonEl: HTMLButtonElement;
  inputEl: HTMLTextAreaElement;
  sendButton: HTMLButtonElement;
  sendIconEl: HTMLSpanElement;
  fileInputEl: HTMLInputElement;
  statusBarEl: HTMLDivElement;
  statusPrimaryEl: HTMLDivElement;
  statusHeaderEl: HTMLDivElement;
  statusControlsEl: HTMLDivElement;
  statusTogglesEl: HTMLDivElement;
  modelGroupEl: HTMLDivElement;
  modelButtonEl: HTMLButtonElement;
  modelValueEl: HTMLSpanElement;
  executionStateEl: HTMLDivElement;
  usageMetersEl: HTMLDivElement;
  planWarningEl: HTMLDivElement;
  learningModeControlEl: HTMLButtonElement;
  learningModeTextEl: HTMLSpanElement;
  fastModeControlEl: HTMLButtonElement;
  fastModeTextEl: HTMLSpanElement;
  thinkingButtonEl: HTMLButtonElement;
  thinkingValueEl: HTMLSpanElement;
  yoloControlEl: HTMLButtonElement;
}

export interface ComposerSharedState {
  context: WorkspaceRenderContext | null;
  composerSuggestions: ComposerSuggestion[];
  composerSelectedIndex: number;
  statusMenuEl: HTMLDivElement | null;
  statusMenuAnchorEl: HTMLElement | null;
  statusMenuCloseHandler: ((event: MouseEvent) => void) | null;
  historyByTab: Map<string, ComposerHistoryState>;
  lastAppliedDraftByTab: Map<string, string>;
  lastRenderedTabId: string | null;
  applyingPatchIds: Set<string>;
  isSending: boolean;
  isApplyingHistoryDraft: boolean;
}

export type ComposerCallbacks = Pick<
  WorkspaceRenderCallbacks,
  "attachBrowserFiles" | "focusComposer" | "openTargetNote" | "requestRender" | "resolvePromptContext"
>;

export interface ComposerSectionRenderState {
  panelLabel: string | null;
  activeSkillLabels: string[];
  canClearPanelContext: boolean;
  planModeActive: boolean;
  placeholder: string;
}

export interface ComposerContextSectionDeps {
  elements: ComposerElements;
  state: ComposerSharedState;
  callbacks: ComposerCallbacks;
  closeStatusMenu(): void;
}
