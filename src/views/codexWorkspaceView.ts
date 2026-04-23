import { ItemView, MarkdownView, Notice, TFile, setIcon, type ViewState, type WorkspaceLeaf } from "obsidian";
import type { CodexService } from "../app/codexService";
import type { ComposerAttachmentInput, WorkspaceState } from "../model/types";
import type { SupportedLocale } from "../util/i18n";
import { ComposerRenderer } from "./renderers/composerRenderer";
import { HeaderRenderer } from "./renderers/headerRenderer";
import { createHubRendererEphemeralState, HubRenderer } from "./renderers/hubRenderer";
import { TranscriptRenderer } from "./renderers/transcriptRenderer";
import type { WorkspaceRenderCallbacks, WorkspaceRenderContext } from "./renderers/types";

export const CODEX_VIEW_TYPE = "obsidian-codex-study-workspace";
export const LEGACY_CODEX_VIEW_TYPE = "obsidian-openai-agent-study-workspace";

type VimAction = "scrollUp" | "scrollDown" | "focusInput";

function parseVimMappingLine(value: string): { key: string; action: VimAction } | null {
  const trimmed = value.trim();
  const match = /^map\s+(\S+)\s+(scrollUp|scrollDown|focusInput)$/u.exec(trimmed);
  if (!match) {
    return null;
  }
  const [, key, action] = match;
  return {
    key: key.toLowerCase(),
    action: action as VimAction,
  };
}

type PersistedLeafViewState = ViewState & {
  icon?: string;
  title?: string;
};

type BrandableWorkspaceLeaf = WorkspaceLeaf & {
  tabHeaderIconEl?: HTMLElement | null;
  tabHeaderInnerTitleEl?: (HTMLElement & { setText?: (text: string) => void }) | null;
};

export async function syncWorkspaceLeafBranding(
  leaf: WorkspaceLeaf,
  title: string,
  icon: string,
  options: { persist?: boolean } = {},
): Promise<void> {
  const brandableLeaf = leaf as BrandableWorkspaceLeaf;
  const titleEl = brandableLeaf.tabHeaderInnerTitleEl;
  if (titleEl) {
    if (typeof titleEl.setText === "function") {
      titleEl.setText(title);
    } else {
      titleEl.textContent = title;
    }
  }
  if (brandableLeaf.tabHeaderIconEl) {
    setIcon(brandableLeaf.tabHeaderIconEl, icon);
  }
  if (!options.persist) {
    return;
  }

  const currentState = leaf.getViewState() as PersistedLeafViewState;
  if (currentState.title === title && currentState.icon === icon) {
    return;
  }
  await leaf.setViewState({
    ...currentState,
    icon,
    title,
  } as PersistedLeafViewState);
}

export class CodexWorkspaceView extends ItemView {
  private static readonly RESPONSIVE_HUB_COLLAPSE_WIDTH = 860;
  private unsubscribe: (() => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private state: WorkspaceState | null = null;
  private activeTabId: string | null = null;
  private shellEl!: HTMLDivElement;
  private headerEl!: HTMLDivElement;
  private ingestHubPanelEl!: HTMLDivElement;
  private messagesEl!: HTMLDivElement;
  private inputAreaEl!: HTMLDivElement;
  private restoreStarted = false;
  private readonly viewType: string;
  private headerRenderer!: HeaderRenderer;
  private hubRenderer!: HubRenderer;
  private transcriptRenderer!: TranscriptRenderer;
  private composerRenderer!: ComposerRenderer;
  private brandingSyncPromise: Promise<void> | null = null;
  private responsiveHubIsNarrow = false;
  private responsiveHubAutoCollapsed = false;
  private responsiveHubManualCollapsed: boolean | null = null;
  private pendingResponsiveHubCollapsedState: boolean | null = null;
  private isNarrowLayout = false;
  private readonly hubEphemeralState = createHubRendererEphemeralState();
  private readonly windowResizeHandler = () => {
    this.handleResponsiveResize();
  };
  private readonly keydownHandler = (event: KeyboardEvent) => {
    this.handleKeydown(event);
  };

  constructor(leaf: WorkspaceLeaf, private readonly service: CodexService, viewType = CODEX_VIEW_TYPE) {
    super(leaf);
    this.viewType = viewType;
  }

  override getViewType(): string {
    return this.viewType;
  }

  override getDisplayText(): string {
    return this.getCopy().workspace.title;
  }

  override getIcon(): string {
    return "sparkles";
  }

  refreshLocalization(): void {
    this.applyLeafBranding();
    if (!this.shellEl) {
      return;
    }
    this.hubRenderer?.dispose();
    this.composerRenderer?.closeStatusMenu();
    this.shellEl.empty();
    this.buildLayout();
    this.render();
  }

  override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("obsidian-codex");

    this.shellEl = this.contentEl.createDiv({ cls: "obsidian-codex__container" });
    this.buildLayout();
    this.applyLeafBranding();
    this.contentEl.addEventListener("keydown", this.keydownHandler, true);
    this.contentEl.ownerDocument.defaultView?.addEventListener("resize", this.windowResizeHandler);

    this.resizeObserver = new ResizeObserver((entries) => {
      this.handleResponsiveResize(entries[0]?.contentRect.width);
    });
    this.resizeObserver.observe(this.contentEl);

    this.unsubscribe = this.service.store.subscribe((state) => {
      this.state = state;
      this.render();
    });
    this.handleResponsiveResize();

    if (!this.restoreStarted) {
      this.restoreStarted = true;
      await this.service.ensureStarted();
      if (this.service.shouldAutoRestoreTabs()) {
        await this.service.restoreTabs();
      }
    }
  }

  override async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.responsiveHubIsNarrow = false;
    this.responsiveHubAutoCollapsed = false;
    this.responsiveHubManualCollapsed = null;
    this.pendingResponsiveHubCollapsedState = null;
    this.isNarrowLayout = false;
    this.hubRenderer?.dispose();
    this.composerRenderer?.dispose();
    this.contentEl.removeEventListener("keydown", this.keydownHandler, true);
    this.contentEl.ownerDocument.defaultView?.removeEventListener("resize", this.windowResizeHandler);
  }

  override onResize(): void {
    this.handleResponsiveResize();
  }

  private handleResponsiveResize(observedWidth?: number): void {
    if (!this.shellEl) {
      return;
    }
    const layoutChanged = this.syncResponsiveHubCollapse({
      paneWidth: this.measureResponsiveHubWidth(observedWidth),
    });
    if (layoutChanged && this.state) {
      this.render();
    }
    this.composerRenderer?.syncInputHeight();
  }

  showIngestHubPanel(): void {
    this.service.openStudyHub();
    this.ingestHubPanelEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  focusComposer(): void {
    this.composerRenderer?.focusComposer();
  }

  openAttachmentPicker(): void {
    this.composerRenderer?.openAttachmentPicker();
  }

  persistLeafBranding(): void {
    if (this.brandingSyncPromise) {
      return;
    }
    this.brandingSyncPromise = syncWorkspaceLeafBranding(this.leaf, this.getCopy().workspace.title, this.getIcon(), {
      persist: true,
    })
      .catch((error: unknown) => {
        console.warn("[obsidian-codex-study] failed to persist workspace leaf branding", error);
      })
      .finally(() => {
        this.brandingSyncPromise = null;
      });
  }

  private getLocale(): SupportedLocale {
    return this.service.getLocale();
  }

  private getCopy() {
    return this.service.getLocalizedCopy();
  }

  private applyLeafBranding(): void {
    void syncWorkspaceLeafBranding(this.leaf, this.getCopy().workspace.title, this.getIcon());
  }

  private buildLayout(): void {
    this.headerEl = this.shellEl.createDiv();
    this.ingestHubPanelEl = this.shellEl.createDiv();
    this.messagesEl = this.shellEl.createDiv();
    this.inputAreaEl = this.shellEl.createDiv();

    const callbacks: WorkspaceRenderCallbacks = {
      markdownComponent: this,
      openSettings: () => {
        const settingsApp = this.app as typeof this.app & {
          setting?: {
            open: () => void;
            openTabById: (id: string) => void;
          };
        };
        settingsApp.setting?.open();
        settingsApp.setting?.openTabById("obsidian-codex-study");
      },
      requestRender: () => {
        this.render();
      },
      focusComposer: () => {
        this.focusComposer();
      },
      seedDraftAndSend: async (prompt: string) => {
        await this.composerRenderer.setDraftAndSend(prompt);
      },
      respondToChatSuggestion: async (action) => {
        const tabId = this.activeTabId ?? this.service.getActiveTab()?.id ?? null;
        if (!tabId) {
          return;
        }
        const { file, editor } = this.resolvePromptContext();
        await this.service.respondToChatSuggestion(tabId, action, { file, editor });
      },
      resolvePromptContext: () => this.resolvePromptContext(),
      attachBrowserFiles: async (files, source) => {
        await this.attachBrowserFiles(files, source);
      },
      openTargetNote: async () => {
        await this.openTargetNote();
      },
    };

    this.headerRenderer = new HeaderRenderer(this.headerEl, callbacks);
    this.hubRenderer = new HubRenderer(this.ingestHubPanelEl, callbacks, this.hubEphemeralState);
    this.transcriptRenderer = new TranscriptRenderer(this.messagesEl, callbacks);
    this.composerRenderer = new ComposerRenderer(this.inputAreaEl, callbacks);
  }

  private render(): void {
    const state = this.state;
    if (!state) {
      return;
    }

    const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0] ?? null;
    this.activeTabId = activeTab?.id ?? null;
    this.syncResponsiveHubManualState();

    const context: WorkspaceRenderContext = {
      app: this.app,
      service: this.service,
      state,
      activeTab,
      isNarrowLayout: this.isNarrowLayout,
      locale: this.getLocale(),
      copy: this.getCopy(),
    };

    this.headerRenderer.render(context);
    this.hubRenderer.render(context);
    this.transcriptRenderer.render(context);
    this.composerRenderer.render(context);
  }

  private syncResponsiveHubCollapse(widths: { paneWidth: number; windowWidth?: number }): boolean {
    const isNarrow = widths.paneWidth <= CodexWorkspaceView.RESPONSIVE_HUB_COLLAPSE_WIDTH;
    const layoutChanged = this.isNarrowLayout !== isNarrow;
    this.isNarrowLayout = isNarrow;
    const currentCollapsed = this.service.getStudyHubState().isCollapsed;

    if (isNarrow && !this.responsiveHubIsNarrow) {
      this.responsiveHubIsNarrow = true;
      this.responsiveHubManualCollapsed = currentCollapsed;
      this.responsiveHubAutoCollapsed = !currentCollapsed;
      if (!currentCollapsed) {
        this.applyResponsiveHubCollapsedState(true);
      }
      return layoutChanged;
    }

    if (!isNarrow && this.responsiveHubIsNarrow) {
      const shouldRestore = this.responsiveHubAutoCollapsed;
      const restoreCollapsed = this.responsiveHubManualCollapsed;
      this.responsiveHubIsNarrow = false;
      this.responsiveHubAutoCollapsed = false;
      this.responsiveHubManualCollapsed = null;
      if (shouldRestore && restoreCollapsed !== null && currentCollapsed !== restoreCollapsed) {
        this.applyResponsiveHubCollapsedState(restoreCollapsed);
      } else {
        this.pendingResponsiveHubCollapsedState = null;
      }
      return layoutChanged;
    }

    this.responsiveHubIsNarrow = isNarrow;
    return layoutChanged;
  }

  private measureResponsiveHubWidth(observedWidth?: number): number {
    const candidates = [this.contentEl.clientWidth, observedWidth ?? 0, this.contentEl.getBoundingClientRect().width].filter((value) => value > 0);
    return candidates[0] ?? 0;
  }

  private syncResponsiveHubManualState(): void {
    if (!this.responsiveHubIsNarrow) {
      return;
    }
    const currentCollapsed = this.service.getStudyHubState().isCollapsed;
    if (this.pendingResponsiveHubCollapsedState !== null) {
      if (currentCollapsed === this.pendingResponsiveHubCollapsedState) {
        this.pendingResponsiveHubCollapsedState = null;
        return;
      }
      this.pendingResponsiveHubCollapsedState = null;
    }
    this.responsiveHubManualCollapsed = currentCollapsed;
  }

  private applyResponsiveHubCollapsedState(isCollapsed: boolean): void {
    this.pendingResponsiveHubCollapsedState = isCollapsed;
    this.service.setStudyHubCollapsed(isCollapsed);
    if (this.service.getStudyHubState().isCollapsed === isCollapsed && this.pendingResponsiveHubCollapsedState === isCollapsed) {
      this.pendingResponsiveHubCollapsedState = null;
    }
  }

  private async attachBrowserFiles(files: File[], source: "clipboard" | "picker"): Promise<void> {
    const tabId = this.activeTabId ?? this.service.getActiveTab()?.id;
    if (!tabId || files.length === 0) {
      return;
    }

    try {
      const inputs = await Promise.all(
        files.map(async (file): Promise<ComposerAttachmentInput> => {
          const buffer = await file.arrayBuffer();
          const maybePath =
            "path" in file && typeof (file as File & { path?: string }).path === "string"
              ? (file as File & { path?: string }).path ?? null
              : null;
          return {
            name: file.name || (this.getLocale() === "ja" ? "添付ファイル" : "attachment"),
            mimeType: file.type || null,
            bytes: new Uint8Array(buffer),
            source,
            originalPath: maybePath,
          };
        }),
      );
      await this.service.addComposerAttachments(tabId, inputs);
    } catch (error) {
      new Notice((error as Error).message);
    }
  }

  private resolvePromptContext(): { file: TFile | null; editor: MarkdownView["editor"] | null } {
    const activeFile = this.app.workspace.getActiveFile();
    const activeEditor = this.app.workspace.activeEditor?.editor ?? null;
    if (activeEditor) {
      return { file: activeFile, editor: activeEditor };
    }

    if (activeFile) {
      for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
        if (leaf.view instanceof MarkdownView && leaf.view.file?.path === activeFile.path) {
          return {
            file: activeFile,
            editor: leaf.view.editor,
          };
        }
      }
    }

    const recentLeaf = this.app.workspace.getMostRecentLeaf();
    if (recentLeaf?.view instanceof MarkdownView) {
      return {
        file: recentLeaf.view.file ?? activeFile,
        editor: recentLeaf.view.editor,
      };
    }

    return { file: activeFile, editor: null };
  }

  private async openTargetNote(): Promise<void> {
    const tabId = this.activeTabId ?? this.service.getActiveTab()?.id;
    if (!tabId) {
      return;
    }

    const targetPath = this.service.getTabTargetNotePath(tabId);
    if (!targetPath) {
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(targetPath);
    if (!(file instanceof TFile)) {
      return;
    }

    await this.app.workspace.getLeaf(this.service.shouldOpenInMainEditor() ? "tab" : false).openFile(file);
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const activeElement = this.app.workspace.containerEl.ownerDocument.activeElement;
    const isEditingText =
      activeElement instanceof HTMLInputElement ||
      activeElement instanceof HTMLTextAreaElement ||
      Boolean(activeElement?.closest("[contenteditable='true']"));
    const pressedKey = event.key.trim().toLowerCase();
    if (!pressedKey) {
      return;
    }

    for (const line of this.service.getVimMappings()) {
      const mapping = parseVimMappingLine(line);
      if (!mapping || mapping.key !== pressedKey) {
        continue;
      }
      if (mapping.action !== "focusInput" && isEditingText) {
        return;
      }
      event.preventDefault();
      if (mapping.action === "focusInput") {
        this.focusComposer();
        return;
      }
      this.messagesEl.scrollBy({
        top: mapping.action === "scrollUp" ? -96 : 96,
        behavior: "smooth",
      });
      return;
    }
  }
}
