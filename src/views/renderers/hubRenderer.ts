import { Notice, setIcon, type TFile } from "obsidian";
import { basename } from "node:path";
import type { StudyRecipe } from "../../model/types";
import type { WorkspaceRenderCallbacks, WorkspaceRenderContext } from "./types";
import type { HubPanelDraft } from "./workspaceViewShared";

export interface HubRendererEphemeralState {
  editingPanelId: string | null;
  isCreatePanelPopoverOpen: boolean;
  panelDrafts: Map<string, HubPanelDraft>;
  openSkillPanelIds: Set<string>;
  selectedDrawerSkillNames: Map<string, string[]>;
  pendingScrollTargetPanelId: string | null;
  pendingFocusTitlePanelId: string | null;
  pendingFocusSkillTogglePanelId: string | null;
}

export function createHubRendererEphemeralState(): HubRendererEphemeralState {
  return {
    editingPanelId: null,
    isCreatePanelPopoverOpen: false,
    panelDrafts: new Map<string, HubPanelDraft>(),
    openSkillPanelIds: new Set<string>(),
    selectedDrawerSkillNames: new Map<string, string[]>(),
    pendingScrollTargetPanelId: null,
    pendingFocusTitlePanelId: null,
    pendingFocusSkillTogglePanelId: null,
  };
}

export type HubPanelDraftValidation = "missing_required" | null;

export function validateHubPanelDraft(draft: HubPanelDraft): HubPanelDraftValidation {
  return draft.title.trim() && draft.promptTemplate.trim() ? null : "missing_required";
}

function normalizeDraftText(value: string): string {
  return value.trim();
}

function areSkillListsEqual(left: readonly string[], right: readonly string[]): boolean {
  const normalizedLeft = [...new Set(left.map((entry) => entry.trim()).filter(Boolean))].sort();
  const normalizedRight = [...new Set(right.map((entry) => entry.trim()).filter(Boolean))].sort();
  return normalizedLeft.length === normalizedRight.length && normalizedLeft.every((entry, index) => entry === normalizedRight[index]);
}

function isPanelDraftChanged(panel: StudyRecipe, draft: HubPanelDraft): boolean {
  return (
    normalizeDraftText(panel.title) !== normalizeDraftText(draft.title) ||
    normalizeDraftText(panel.description) !== normalizeDraftText(draft.description) ||
    normalizeDraftText(panel.promptTemplate) !== normalizeDraftText(draft.promptTemplate) ||
    !areSkillListsEqual(panel.linkedSkillNames, draft.linkedSkillNames)
  );
}

export class HubRenderer {
  private static readonly PANEL_SELECTOR = ".obsidian-codex__hub-panel";
  private static readonly NEW_PANEL_DRAFT_ID = "__new-panel-draft__";
  private skillPopoverDismissHandler: ((event: MouseEvent) => void) | null = null;
  private hubBodyEl: HTMLDivElement | null = null;
  private preservedBodyScrollTop = 0;
  private preservedElementAnchor: { selector: string; offsetTop: number } | null = null;
  private preservedPanelAnchor: { panelId: string; offsetTop: number } | null = null;
  private preserveExactScrollOnNextRender = false;
  private hadOpenSkillDrawerDuringCapture = false;
  private refreshedSkillsWhileOpen = false;

  constructor(
    private readonly root: HTMLDivElement,
    private readonly callbacks: Pick<WorkspaceRenderCallbacks, "focusComposer" | "requestRender">,
    private readonly ephemeralState: HubRendererEphemeralState = createHubRendererEphemeralState(),
  ) {}

  dispose(): void {
    this.teardownSkillPopoverDismissHandler();
    this.hubBodyEl = null;
  }

  private get editingPanelId(): string | null {
    return this.ephemeralState.editingPanelId;
  }

  private set editingPanelId(value: string | null) {
    this.ephemeralState.editingPanelId = value;
  }

  private get isCreatePanelPopoverOpen(): boolean {
    return this.ephemeralState.isCreatePanelPopoverOpen;
  }

  private set isCreatePanelPopoverOpen(value: boolean) {
    this.ephemeralState.isCreatePanelPopoverOpen = value;
  }

  private get panelDrafts(): Map<string, HubPanelDraft> {
    return this.ephemeralState.panelDrafts;
  }

  private get openSkillPanelIds(): Set<string> {
    return this.ephemeralState.openSkillPanelIds;
  }

  private get selectedDrawerSkillNames(): Map<string, string[]> {
    return this.ephemeralState.selectedDrawerSkillNames;
  }

  private get pendingScrollTargetPanelId(): string | null {
    return this.ephemeralState.pendingScrollTargetPanelId;
  }

  private set pendingScrollTargetPanelId(value: string | null) {
    this.ephemeralState.pendingScrollTargetPanelId = value;
  }

  private get pendingFocusTitlePanelId(): string | null {
    return this.ephemeralState.pendingFocusTitlePanelId;
  }

  private set pendingFocusTitlePanelId(value: string | null) {
    this.ephemeralState.pendingFocusTitlePanelId = value;
  }

  private get pendingFocusSkillTogglePanelId(): string | null {
    return this.ephemeralState.pendingFocusSkillTogglePanelId;
  }

  private set pendingFocusSkillTogglePanelId(value: string | null) {
    this.ephemeralState.pendingFocusSkillTogglePanelId = value;
  }

  render(context: WorkspaceRenderContext): void {
    const { activeTab, app, copy, service } = context;
    this.captureHubBodyState();
    const panels = service.getHubPanels();
    const activePanelId = activeTab ? activeTab.activeStudyRecipeId : service.getActivePanelId(null);
    const studyHubState = service.getStudyHubState();
    const isCollapsed = studyHubState.isCollapsed;

    this.root.empty();
    this.root.addClass("obsidian-codex__ingest-hub-panel");
    this.root.addClass("is-visible");
    this.root.dataset.smoke = "panel-studio";
    this.root.dataset.workflow = activeTab?.studyWorkflow ?? "";
    this.root.classList.toggle("is-collapsed", isCollapsed);
    this.root.classList.toggle(
      "is-editor-open",
      !isCollapsed && (this.editingPanelId !== null || this.pendingScrollTargetPanelId !== null || this.isCreatePanelPopoverOpen),
    );
    this.root.classList.toggle("is-create-popover-open", this.isCreatePanelPopoverOpen);

    const headerEl = this.root.createDiv({ cls: "obsidian-codex__ingest-hub-header" });
    const headingEl = headerEl.createDiv({ cls: "obsidian-codex__ingest-hub-heading" });
    const titleWrapEl = headingEl.createDiv({ cls: "obsidian-codex__ingest-hub-title-wrap" });
    titleWrapEl.createSpan({ cls: "obsidian-codex__ingest-hub-title", text: copy.workspace.ingestHubTitle });
    if (!isCollapsed) {
      titleWrapEl.createSpan({
        cls: "obsidian-codex__ingest-hub-subtitle",
        text: copy.workspace.ingestHubSubtitle,
      });
    }

    const toggleButton = headerEl.createEl("button", {
      cls: "obsidian-codex__ingest-hub-toggle",
      attr: {
        type: "button",
        "aria-label": isCollapsed ? copy.workspace.expandIngestHub : copy.workspace.collapseIngestHub,
        "aria-expanded": String(!isCollapsed),
      },
    });
    toggleButton.dataset.smoke = "panel-studio-toggle";
    setIcon(toggleButton, isCollapsed ? "chevron-down" : "chevron-up");
    toggleButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      service.toggleStudyHubCollapsed();
    });

    if (isCollapsed) {
      this.refreshedSkillsWhileOpen = false;
      this.hubBodyEl = null;
      this.syncSkillPopoverDismissHandler();
      return;
    }

    if (!this.refreshedSkillsWhileOpen) {
      this.refreshedSkillsWhileOpen = true;
      void service.refreshInstalledSkills()
        .then(() => {
          this.callbacks.requestRender();
        })
        .catch((error: unknown) => {
          new Notice((error as Error).message);
        });
    }

    const bodyEl = this.root.createDiv({ cls: "obsidian-codex__ingest-hub-body" });
    this.hubBodyEl = bodyEl;
    bodyEl.scrollTop = this.preservedBodyScrollTop;
    bodyEl.addEventListener("scroll", () => {
      this.preservedBodyScrollTop = bodyEl.scrollTop;
    });

    if (activeTab?.targetNotePath) {
      const metaEl = bodyEl.createDiv({ cls: "obsidian-codex__ingest-hub-meta" });
      metaEl.createSpan({
        cls: "obsidian-codex__hub-meta-pill",
        text: copy.workspace.note(basename(activeTab.targetNotePath)),
      });
    }

    const actionsEl = bodyEl.createDiv({ cls: "obsidian-codex__ingest-hub-incubator-actions" });
    const isPanelLimitReached = panels.length >= 6;
    const addButton = actionsEl.createEl("button", {
      cls: "obsidian-codex__change-card-btn",
      text: copy.workspace.addPanel,
    });
    addButton.type = "button";
    addButton.dataset.smoke = "panel-studio-add";
    addButton.disabled = isPanelLimitReached;
    if (isPanelLimitReached) {
      addButton.title = copy.service.panelLimitReached(6);
    }
    addButton.addEventListener("click", () => {
      this.openCreatePanelPopover();
      this.callbacks.requestRender();
    });

    const panelListEl = bodyEl.createDiv({ cls: "obsidian-codex__recipe-list obsidian-codex__recipe-list--study" });
    if (panels.length === 0) {
      panelListEl.createDiv({ cls: "obsidian-codex__hub-empty", text: copy.workspace.noStudyRecipes });
    } else {
      for (const panel of panels) {
        this.renderHubPanelCard(panelListEl, panel, panel.id === activePanelId, activeTab?.id ?? null, app.workspace.getActiveFile(), context);
      }
    }

    if (this.isCreatePanelPopoverOpen) {
      this.renderCreatePanelPopover(context);
    }
    this.restoreHubBodyState(bodyEl);
    this.syncSkillPopoverDismissHandler();
  }

  private renderHubPanelCard(
    parent: HTMLElement,
    panel: StudyRecipe,
    isActive: boolean,
    tabId: string | null,
    activeFile: TFile | null,
    context: WorkspaceRenderContext,
  ): void {
    const { copy, service } = context;
    const isEditing = this.editingPanelId === panel.id;
    const cardEl = parent.createDiv({
      cls: `obsidian-codex__recipe-card obsidian-codex__hub-panel${isActive ? " is-active" : ""}${isEditing ? " is-editing" : ""}${
        this.openSkillPanelIds.has(panel.id) ? " is-skills-open" : ""
      }`,
    });
    cardEl.dataset.workflow = panel.workflow;
    cardEl.dataset.panelId = panel.id;

    const headEl = cardEl.createDiv({ cls: "obsidian-codex__hub-panel-head" });
    const titleWrapEl = headEl.createDiv({
      cls: `obsidian-codex__hub-panel-title-wrap${isEditing ? " is-editing" : ""}`,
    });

    if (isEditing) {
      const draft = this.getPanelDraft(panel);
      const titleInput = titleWrapEl.createEl("input", {
        cls: "obsidian-codex__panel-edit-input obsidian-codex__panel-edit-input-title",
        value: draft.title,
        attr: { placeholder: copy.workspace.panelTitlePlaceholder },
      });
      titleInput.value = draft.title;
      titleInput.addEventListener("input", () => {
        this.updatePanelDraft(panel.id, { title: titleInput.value });
      });
      if (this.pendingFocusTitlePanelId === panel.id) {
        window.requestAnimationFrame(() => {
          titleInput.focus();
          titleInput.select();
          this.pendingFocusTitlePanelId = null;
        });
      }
    } else {
      titleWrapEl.createDiv({
        cls: "obsidian-codex__hub-panel-title-text",
        text: panel.title.trim() || copy.workspace.untitledPanel,
      });
    }

    const headActionsEl = headEl.createDiv({ cls: "obsidian-codex__hub-panel-head-actions" });
    const editActionLabel = isEditing ? copy.workspace.savePanel : copy.workspace.editPanel;
    const editButton = headActionsEl.createEl("button", {
      cls: "obsidian-codex__header-btn obsidian-codex__hub-panel-edit-btn",
      attr: { type: "button", "aria-label": editActionLabel, title: editActionLabel },
    });
    editButton.dataset.smoke = "panel-edit-toggle";
    setIcon(editButton, isEditing ? "check" : "pencil");
    editButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (isEditing) {
        try {
          const draft = this.getPanelDraft(panel);
          service.updateHubPanel(panel.id, draft);
          this.editingPanelId = null;
          this.panelDrafts.delete(panel.id);
          this.pendingFocusTitlePanelId = null;
          this.callbacks.requestRender();
        } catch (error) {
          new Notice((error as Error).message);
        }
        return;
      }
      if (!this.confirmDiscardActivePanelEdit(panel.id, context)) {
        return;
      }
      this.beginEditingPanel(panel);
      this.callbacks.requestRender();
    });

    if (isEditing) {
      const cancelButton = headActionsEl.createEl("button", {
        cls: "obsidian-codex__header-btn obsidian-codex__hub-panel-edit-btn",
        attr: { type: "button", "aria-label": copy.workspace.cancelEdit },
      });
      setIcon(cancelButton, "x");
      cancelButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!this.confirmDiscardPanelEdit(panel, context)) {
          return;
        }
        this.editingPanelId = null;
        this.panelDrafts.delete(panel.id);
        this.pendingFocusTitlePanelId = null;
        this.callbacks.requestRender();
      });
    }

    if (isEditing) {
      const draft = this.getPanelDraft(panel);
      this.renderPanelEditorBody(cardEl, panel.id, draft, context);
      const editActionsEl = cardEl.createDiv({ cls: "obsidian-codex__hub-panel-edit-actions" });
      const legacyDeleteButton = editActionsEl.createEl("button", {
        cls: "obsidian-codex__change-card-btn is-muted",
        text: copy.workspace.delete,
      });
      legacyDeleteButton.type = "button";
      legacyDeleteButton.dataset.smoke = "panel-edit-delete";
      legacyDeleteButton.addEventListener("click", () => {
        if (!this.confirmDiscardPanelEdit(panel, context)) {
          return;
        }
        this.removePanel(panel.id, this.getPanelDisplayTitle(panel.title, copy.workspace.untitledPanel), context);
      });
      return;
    }

    if (panel.description.trim()) {
      cardEl.createDiv({ cls: "obsidian-codex__ingest-hub-card-desc", text: panel.description });
    }

    const actionsEl = cardEl.createDiv({ cls: "obsidian-codex__ingest-hub-card-actions obsidian-codex__hub-panel-card-actions" });
    this.createActionButton(actionsEl, copy.workspace.seedPrompt, async () => {
      const nextTabId = tabId ?? service.getActiveTab()?.id ?? service.createTab()?.id ?? null;
      if (!nextTabId) {
        return;
      }
      service.seedHubPanelPrompt(nextTabId, panel.id, activeFile);
      this.callbacks.focusComposer();
    });
    const isSkillsOpen = this.openSkillPanelIds.has(panel.id);
    const skillsControlEl = actionsEl.createDiv({ cls: "obsidian-codex__hub-panel-skill-control" });
    const installedSkills = service.getUserOwnedInstalledSkills();
    const linkedSkills = installedSkills.filter((skill) => panel.linkedSkillNames.includes(skill.name));
    const drawerSkills = linkedSkills;
    const linkedSkillCount = linkedSkills.length;
    const skillsButton = skillsControlEl.createEl("button", {
      cls: `obsidian-codex__change-card-btn is-muted obsidian-codex__hub-panel-skill-toggle${isSkillsOpen ? " is-active" : ""}${
        linkedSkillCount === 0 ? " is-empty" : ""
      }`,
    });
    skillsButton.type = "button";
    skillsButton.title = copy.workspace.panelSkills;
    skillsButton.setAttribute("aria-haspopup", "dialog");
    skillsButton.dataset.smoke = "panel-skill-toggle";
    skillsButton.ariaExpanded = String(isSkillsOpen);
    skillsButton.createSpan({ text: `${copy.workspace.panelSkills} ${linkedSkillCount}` });
    if (this.pendingFocusSkillTogglePanelId === panel.id) {
      window.requestAnimationFrame(() => {
        skillsButton.focus();
        this.pendingFocusSkillTogglePanelId = null;
      });
    }
    skillsButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.openSkillPanelIds.has(panel.id)) {
        this.closeSkillPopover(panel.id, true);
      } else {
        this.openSkillPopover(panel.id);
      }
      this.callbacks.requestRender();
    });

    if (!isSkillsOpen) {
      return;
    }

    const committedSkillNames =
      tabId && service.getActivePanelId(tabId) === panel.id ? service.getActivePanelSkillNames(tabId) : [];
    const selectedSkillNames = (this.selectedDrawerSkillNames.get(panel.id) ?? committedSkillNames).filter((skillName) =>
      drawerSkills.some((skill) => skill.name === skillName),
    );
    this.selectedDrawerSkillNames.set(panel.id, selectedSkillNames);
    const drawerEl = skillsControlEl.createDiv({
      cls: `obsidian-codex__hub-panel-skill-drawer${drawerSkills.length === 0 ? " is-empty" : ""}`,
    });
    drawerEl.dataset.smoke = "panel-skill-popover";
    drawerEl.setAttribute("role", "dialog");
    drawerEl.setAttribute("aria-label", copy.workspace.panelSkills);
    drawerEl.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.closeSkillPopover(panel.id, true);
      this.callbacks.requestRender();
    });
    if (drawerSkills.length === 0) {
      drawerEl.createDiv({ cls: "obsidian-codex__hub-panel-skill-empty-title", text: copy.workspace.noLinkedSkills });
      drawerEl.createDiv({ cls: "obsidian-codex__hub-panel-skill-empty-note", text: copy.workspace.noLinkedSkillsHint });
      return;
    }

    this.renderDrawerSkillSection(drawerEl, copy.workspace.linkedSkills, linkedSkills, selectedSkillNames, panel.id, tabId, activeFile, context);

    const bulkActionsEl = drawerEl.createDiv({ cls: "obsidian-codex__hub-panel-skill-actions" });
    const useSelectedButton = bulkActionsEl.createEl("button", {
      cls: "obsidian-codex__change-card-btn",
      text: copy.workspace.useSelectedSkills,
    });
    useSelectedButton.type = "button";
    useSelectedButton.disabled = selectedSkillNames.length === 0;
    useSelectedButton.addEventListener("click", () => {
      const nextTabId = tabId ?? service.getActiveTab()?.id ?? service.createTab()?.id ?? null;
      if (!nextTabId || selectedSkillNames.length === 0) {
        return;
      }
      this.capturePanelAnchor(panel.id);
      this.closeSkillPopover(panel.id);
      service.seedHubPanelSkills(nextTabId, panel.id, selectedSkillNames, activeFile);
      this.selectedDrawerSkillNames.set(panel.id, [...selectedSkillNames]);
      this.callbacks.focusComposer();
      this.callbacks.requestRender();
    });
    if (selectedSkillNames.length === 0) {
      bulkActionsEl.createSpan({
        cls: "obsidian-codex__hub-panel-skill-empty-note",
        text: copy.workspace.noSelectedSkills,
      });
    }
  }

  private renderCreatePanelPopover(context: WorkspaceRenderContext): void {
    const { copy } = context;
    const draft = this.getOrCreateNewPanelDraft();
    const overlayEl = this.root.createDiv({ cls: "obsidian-codex__hub-create-overlay" });
    overlayEl.dataset.smoke = "panel-create-overlay";
    overlayEl.addEventListener("click", (event) => {
      if (event.target !== overlayEl) {
        return;
      }
      this.dismissCreatePanelPopover(context);
    });

    const popoverEl = overlayEl.createDiv({ cls: "obsidian-codex__hub-create-popover" });
    popoverEl.dataset.smoke = "panel-create-popover";
    popoverEl.tabIndex = -1;
    popoverEl.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    popoverEl.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.dismissCreatePanelPopover(context);
        return;
      }
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        event.stopPropagation();
        this.saveCreatePanel(context);
      }
    });

    const popoverHeaderEl = popoverEl.createDiv({ cls: "obsidian-codex__hub-create-popover-header" });
    const titleWrapEl = popoverHeaderEl.createDiv({ cls: "obsidian-codex__hub-create-popover-title-wrap" });
    titleWrapEl.createDiv({
      cls: "obsidian-codex__hub-create-popover-title",
      text: copy.workspace.createPanelTitle,
    });
    titleWrapEl.createDiv({
      cls: "obsidian-codex__hub-create-popover-subtitle",
      text: copy.workspace.ingestHubSubtitle,
    });

    const closeButton = popoverHeaderEl.createEl("button", {
      cls: "obsidian-codex__header-btn obsidian-codex__hub-panel-edit-btn",
      attr: { type: "button", "aria-label": copy.workspace.closeCreatePanel },
    });
    closeButton.dataset.smoke = "panel-create-close";
    setIcon(closeButton, "x");
    closeButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.dismissCreatePanelPopover(context);
    });

    const titleInput = popoverEl.createEl("input", {
      cls: "obsidian-codex__panel-edit-input obsidian-codex__panel-edit-input-title obsidian-codex__hub-create-title",
      value: draft.title,
      attr: { placeholder: copy.workspace.panelTitlePlaceholder },
    });
    titleInput.value = draft.title;
    titleInput.dataset.smoke = "panel-create-title";
    titleInput.addEventListener("input", () => {
      this.updatePanelDraft(HubRenderer.NEW_PANEL_DRAFT_ID, { title: titleInput.value });
    });
    if (this.pendingFocusTitlePanelId === HubRenderer.NEW_PANEL_DRAFT_ID) {
      window.requestAnimationFrame(() => {
        titleInput.focus();
        titleInput.select();
        this.pendingFocusTitlePanelId = null;
      });
    }

    this.renderPanelEditorBody(popoverEl, HubRenderer.NEW_PANEL_DRAFT_ID, draft, context);

    const actionsEl = popoverEl.createDiv({ cls: "obsidian-codex__hub-create-popover-actions" });
    const cancelButton = actionsEl.createEl("button", {
      cls: "obsidian-codex__change-card-btn is-muted",
      text: copy.workspace.cancelEdit,
    });
    cancelButton.type = "button";
    cancelButton.dataset.smoke = "panel-create-cancel";
    cancelButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.dismissCreatePanelPopover(context);
    });

    const saveButton = actionsEl.createEl("button", {
      cls: "obsidian-codex__change-card-btn",
      text: copy.workspace.createPanelSave,
    });
    saveButton.type = "button";
    saveButton.dataset.smoke = "panel-create-save";
    saveButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.saveCreatePanel(context);
    });
  }

  private renderPanelEditorBody(
    parent: HTMLElement,
    panelId: string,
    draft: HubPanelDraft,
    context: WorkspaceRenderContext,
  ): void {
    const { copy, service } = context;
    const descriptionEl = parent.createEl("textarea", {
      cls: "obsidian-codex__panel-edit-textarea",
      text: draft.description,
      attr: { placeholder: copy.workspace.panelDescriptionPlaceholder },
    });
    descriptionEl.value = draft.description;
    descriptionEl.rows = 2;
    descriptionEl.addEventListener("input", () => {
      this.updatePanelDraft(panelId, { description: descriptionEl.value });
    });

    const promptEl = parent.createEl("textarea", {
      cls: "obsidian-codex__panel-edit-textarea obsidian-codex__panel-edit-prompt",
      text: draft.promptTemplate,
      attr: { placeholder: copy.workspace.panelPromptPlaceholder },
    });
    promptEl.value = draft.promptTemplate;
    promptEl.rows = 4;
    promptEl.addEventListener("input", () => {
      this.updatePanelDraft(panelId, { promptTemplate: promptEl.value });
    });

    const skillsWrapEl = parent.createDiv({ cls: "obsidian-codex__panel-skill-picker" });
    const installedSkills = service.getUserOwnedInstalledSkills();
    const linkedSkills = installedSkills.filter((skill) => draft.linkedSkillNames.includes(skill.name));
    const availableSkills = installedSkills.filter((skill) => !draft.linkedSkillNames.includes(skill.name));
    this.renderPanelSkillSection(skillsWrapEl, panelId, copy.workspace.linkedSkills, linkedSkills, true, copy.workspace.noLinkedSkills, "linked");
    this.renderPanelSkillSection(skillsWrapEl, panelId, copy.workspace.availableSkills, availableSkills, false, null, "available");
  }

  private getPanelDraft(panel: StudyRecipe): HubPanelDraft {
    return (
      this.panelDrafts.get(panel.id) ?? {
        title: panel.title,
        description: panel.description,
        promptTemplate: panel.promptTemplate,
        linkedSkillNames: [...panel.linkedSkillNames],
      }
    );
  }

  private getOrCreateNewPanelDraft(): HubPanelDraft {
    const existing = this.panelDrafts.get(HubRenderer.NEW_PANEL_DRAFT_ID);
    if (existing) {
      return existing;
    }
    const created: HubPanelDraft = {
      title: "",
      description: "",
      promptTemplate: "",
      linkedSkillNames: [],
    };
    this.panelDrafts.set(HubRenderer.NEW_PANEL_DRAFT_ID, created);
    return created;
  }

  private getPanelDisplayTitle(title: string, fallback: string): string {
    return title.trim() || fallback;
  }

  private updatePanelDraft(panelId: string, patch: Partial<HubPanelDraft>): void {
    const current = this.panelDrafts.get(panelId);
    if (!current) {
      return;
    }
    this.panelDrafts.set(panelId, {
      ...current,
      ...patch,
      linkedSkillNames: patch.linkedSkillNames ? [...patch.linkedSkillNames] : [...current.linkedSkillNames],
    });
  }

  private beginEditingPanel(panel: StudyRecipe): void {
    this.editingPanelId = panel.id;
    this.pendingFocusTitlePanelId = panel.id;
    this.panelDrafts.set(panel.id, {
      title: panel.title,
      description: panel.description,
      promptTemplate: panel.promptTemplate,
      linkedSkillNames: [...panel.linkedSkillNames],
    });
  }

  private openCreatePanelPopover(): void {
    this.isCreatePanelPopoverOpen = true;
    this.pendingFocusTitlePanelId = HubRenderer.NEW_PANEL_DRAFT_ID;
    this.openSkillPanelIds.clear();
    this.getOrCreateNewPanelDraft();
  }

  private dismissCreatePanelPopover(context: WorkspaceRenderContext): void {
    if (this.shouldConfirmDiscardNewPanel() && !this.confirmDiscardNewPanel(context)) {
      return;
    }
    this.closeCreatePanelPopover();
    this.callbacks.requestRender();
  }

  private saveCreatePanel(context: WorkspaceRenderContext): void {
    try {
      const draft = this.getOrCreateNewPanelDraft();
      if (validateHubPanelDraft(draft) === "missing_required") {
        new Notice(context.copy.workspace.panelDraftEmpty);
        return;
      }
      const panel = context.service.createHubPanel(draft);
      this.pendingScrollTargetPanelId = panel.id;
      this.closeCreatePanelPopover();
      this.callbacks.requestRender();
    } catch (error) {
      new Notice((error as Error).message);
    }
  }

  private closeCreatePanelPopover(): void {
    this.isCreatePanelPopoverOpen = false;
    this.panelDrafts.delete(HubRenderer.NEW_PANEL_DRAFT_ID);
    if (this.pendingFocusTitlePanelId === HubRenderer.NEW_PANEL_DRAFT_ID) {
      this.pendingFocusTitlePanelId = null;
    }
  }

  private shouldConfirmDiscardNewPanel(): boolean {
    if (!this.isCreatePanelPopoverOpen) {
      return false;
    }
    const draft = this.panelDrafts.get(HubRenderer.NEW_PANEL_DRAFT_ID);
    if (!draft) {
      return false;
    }
    return this.isPanelDraftDirty(draft);
  }

  private isPanelDraftDirty(draft: HubPanelDraft): boolean {
    return (
      draft.title.trim().length > 0 ||
      draft.description.trim().length > 0 ||
      draft.promptTemplate.trim().length > 0 ||
      draft.linkedSkillNames.length > 0
    );
  }

  private confirmDiscardNewPanel(context: WorkspaceRenderContext): boolean {
    return typeof globalThis.confirm === "function" ? globalThis.confirm(context.copy.workspace.discardNewPanelConfirm) : true;
  }

  private confirmDiscardActivePanelEdit(nextPanelId: string | null, context: WorkspaceRenderContext): boolean {
    const currentPanelId = this.editingPanelId;
    if (!currentPanelId || currentPanelId === nextPanelId) {
      return true;
    }
    const currentPanel = context.service.getHubPanels().find((panel) => panel.id === currentPanelId) ?? null;
    if (!currentPanel || this.confirmDiscardPanelEdit(currentPanel, context)) {
      this.panelDrafts.delete(currentPanelId);
      this.editingPanelId = null;
      this.pendingFocusTitlePanelId = null;
      return true;
    }
    return false;
  }

  private confirmDiscardPanelEdit(panel: StudyRecipe, context: WorkspaceRenderContext): boolean {
    const draft = this.panelDrafts.get(panel.id);
    if (!draft || !isPanelDraftChanged(panel, draft)) {
      return true;
    }
    return typeof globalThis.confirm === "function" ? globalThis.confirm(context.copy.workspace.discardPanelEditConfirm) : true;
  }

  private restoreHubBodyState(bodyEl: HTMLDivElement): void {
    window.requestAnimationFrame(() => {
      const preferStableDirection = this.hadOpenSkillDrawerDuringCapture;
      this.hadOpenSkillDrawerDuringCapture = false;
      let didRestoreFromAnchor = false;
      if (this.pendingScrollTargetPanelId) {
        const targetCard = this.queryPanelCard(bodyEl, this.pendingScrollTargetPanelId);
        targetCard?.scrollIntoView({ block: "center", inline: "nearest" });
        this.pendingScrollTargetPanelId = null;
        this.preservedElementAnchor = null;
        this.preservedPanelAnchor = null;
        this.preservedBodyScrollTop = bodyEl.scrollTop;
        didRestoreFromAnchor = true;
      } else if (this.preserveExactScrollOnNextRender) {
        bodyEl.scrollTop = this.preservedBodyScrollTop;
        this.preserveExactScrollOnNextRender = false;
        this.preservedElementAnchor = null;
        this.preservedPanelAnchor = null;
      } else if (this.preservedElementAnchor) {
        const targetEl = bodyEl.querySelector<HTMLElement>(this.preservedElementAnchor.selector);
        if (targetEl) {
          bodyEl.scrollTop = Math.max(0, this.getElementOffsetTop(targetEl, bodyEl) - this.preservedElementAnchor.offsetTop);
          this.preservedBodyScrollTop = bodyEl.scrollTop;
        } else {
          bodyEl.scrollTop = this.preservedBodyScrollTop;
        }
        this.preservedElementAnchor = null;
        didRestoreFromAnchor = true;
      } else if (this.preservedPanelAnchor) {
        const targetCard = this.queryPanelCard(bodyEl, this.preservedPanelAnchor.panelId);
        if (targetCard) {
          bodyEl.scrollTop = Math.max(0, this.getElementOffsetTop(targetCard, bodyEl) - this.preservedPanelAnchor.offsetTop);
          this.preservedBodyScrollTop = bodyEl.scrollTop;
        } else {
          bodyEl.scrollTop = this.preservedBodyScrollTop;
        }
        this.preservedPanelAnchor = null;
        didRestoreFromAnchor = true;
      } else {
        bodyEl.scrollTop = this.preservedBodyScrollTop;
      }
      this.positionSkillDrawers(bodyEl, didRestoreFromAnchor && preferStableDirection);
    });
  }

  private positionSkillDrawers(bodyEl: HTMLDivElement, preferStableDirection: boolean): void {
    const bodyRect = bodyEl.getBoundingClientRect();
    const controls = Array.from(bodyEl.querySelectorAll(".obsidian-codex__hub-panel-skill-control")) as HTMLElement[];
    for (const controlEl of controls) {
      const drawerEl = controlEl.querySelector(".obsidian-codex__hub-panel-skill-drawer") as HTMLElement | null;
      if (!drawerEl) {
        continue;
      }
      drawerEl.classList.remove("is-open-up", "is-open-down", "is-align-start", "is-align-end");
      drawerEl.style.width = "";
      drawerEl.style.maxHeight = "";

      const controlRect = controlEl.getBoundingClientRect();
      const drawerHeight = Math.min(Math.max(drawerEl.scrollHeight, 0), 420);
      const desiredWidth = 360;
      const availableAbove = Math.max(0, controlRect.top - bodyRect.top - 10);
      const availableBelow = Math.max(0, bodyRect.bottom - controlRect.bottom - 10);
      const openDown = !preferStableDirection && availableAbove < Math.min(drawerHeight, 220) && availableBelow > availableAbove;
      const availableHeight = Math.max(160, Math.min(openDown ? availableBelow : availableAbove, 420));
      const availableRight = Math.max(0, bodyRect.right - controlRect.left - 8);
      const availableLeft = Math.max(0, controlRect.right - bodyRect.left - 8);
      const alignEnd = availableRight < Math.min(desiredWidth, 260) && availableLeft > availableRight;
      const availableWidth = Math.max(220, Math.min(desiredWidth, alignEnd ? availableLeft : availableRight));

      drawerEl.classList.add(openDown ? "is-open-down" : "is-open-up");
      drawerEl.classList.add(alignEnd ? "is-align-end" : "is-align-start");
      drawerEl.style.width = `${availableWidth}px`;
      drawerEl.style.maxHeight = `${availableHeight}px`;
    }
  }

  private removePanel(panelId: string, title: string, context: WorkspaceRenderContext): void {
    const confirmed = typeof globalThis.confirm === "function" ? globalThis.confirm(context.copy.workspace.deletePanelConfirm(title)) : true;
    if (!confirmed) {
      return;
    }
    context.service.removeStudyRecipe(panelId);
    this.panelDrafts.delete(panelId);
    this.openSkillPanelIds.delete(panelId);
    this.selectedDrawerSkillNames.delete(panelId);
    if (this.editingPanelId === panelId) {
      this.editingPanelId = null;
    }
    if (this.pendingFocusTitlePanelId === panelId) {
      this.pendingFocusTitlePanelId = null;
    }
    this.callbacks.requestRender();
  }

  private renderPanelSkillSection(
    parent: HTMLElement,
    panelId: string,
    label: string,
    skills: Array<{ name: string }>,
    checked: boolean,
    emptyText: string | null,
    sectionKind: "linked" | "available",
  ): void {
    const sectionEl = parent.createDiv({
      cls: `obsidian-codex__panel-skill-picker-section obsidian-codex__panel-skill-picker-section--${sectionKind}`,
    });
    sectionEl.dataset.smoke = `panel-skill-section-${sectionKind}`;
    sectionEl.createSpan({ cls: "obsidian-codex__panel-skill-picker-label", text: label });
    const listEl = sectionEl.createDiv({
      cls: `obsidian-codex__panel-skill-picker-list obsidian-codex__panel-skill-picker-list--${sectionKind}`,
    });
    if (skills.length === 0) {
      if (emptyText) {
        listEl.createDiv({ cls: "obsidian-codex__ingest-hub-card-note is-muted", text: emptyText });
      }
      return;
    }
    const draft = this.panelDrafts.get(panelId);
    if (!draft) {
      return;
    }
    for (const skill of skills) {
      const labelEl = listEl.createEl("label", { cls: "obsidian-codex__panel-skill-option" });
      labelEl.dataset.skillName = skill.name;
      const checkboxEl = labelEl.createEl("input", { attr: { type: "checkbox" } });
      checkboxEl.checked = checked;
      checkboxEl.addEventListener("change", () => {
        this.captureSkillAnchor(skill.name);
        this.capturePanelAnchor(panelId);
        const next = checkboxEl.checked
          ? [...new Set([...draft.linkedSkillNames, skill.name])]
          : draft.linkedSkillNames.filter((entry) => entry !== skill.name);
        this.updatePanelDraft(panelId, { linkedSkillNames: next });
        this.callbacks.requestRender();
      });
      labelEl.createSpan({ text: skill.name });
    }
  }

  private renderDrawerSkillSection(
    parent: HTMLElement,
    label: string,
    skills: Array<{ name: string }>,
    selectedSkillNames: string[],
    panelId: string,
    tabId: string | null,
    activeFile: TFile | null,
    context: WorkspaceRenderContext,
  ): void {
    if (skills.length === 0) {
      return;
    }
    const sectionEl = parent.createDiv({ cls: "obsidian-codex__panel-skill-picker-section" });
    sectionEl.createSpan({ cls: "obsidian-codex__panel-skill-picker-label", text: label });
    for (const skill of skills) {
      const rowEl = sectionEl.createDiv({ cls: "obsidian-codex__hub-panel-skill-row" });
      rowEl.dataset.skillName = skill.name;
      const checkboxEl = rowEl.createEl("input", {
        cls: "obsidian-codex__hub-panel-skill-checkbox",
        attr: { type: "checkbox", "aria-label": skill.name },
      });
      checkboxEl.checked = selectedSkillNames.includes(skill.name);
      checkboxEl.addEventListener("change", () => {
        this.preserveExactScrollOnNextRender = true;
        this.preservedBodyScrollTop = this.hubBodyEl?.scrollTop ?? this.preservedBodyScrollTop;
        this.preservedElementAnchor = null;
        this.preservedPanelAnchor = null;
        const next = checkboxEl.checked
          ? [...new Set([...selectedSkillNames, skill.name])]
          : selectedSkillNames.filter((entry) => entry !== skill.name);
        this.selectedDrawerSkillNames.set(panelId, next);
        this.callbacks.requestRender();
      });

      const skillButton = rowEl.createEl("button", {
        cls: "obsidian-codex__suggestion-chip",
        text: `/${skill.name}`,
      });
      skillButton.type = "button";
      skillButton.dataset.smoke = "panel-skill-seed";
      skillButton.addEventListener("click", () => {
        const nextTabId = tabId ?? context.service.getActiveTab()?.id ?? context.service.createTab()?.id ?? null;
        if (!nextTabId) {
          return;
        }
        this.captureSkillAnchor(skill.name);
        this.capturePanelAnchor(panelId);
        this.closeSkillPopover(panelId);
        context.service.seedHubPanelSkills(nextTabId, panelId, [skill.name], activeFile);
        this.callbacks.focusComposer();
        this.callbacks.requestRender();
      });
    }
  }

  private syncSkillPopoverDismissHandler(): void {
    const hasOpenPopover = this.hubBodyEl !== null && this.getOpenSkillPanelId() !== null;
    if (!hasOpenPopover) {
      this.teardownSkillPopoverDismissHandler();
      return;
    }
    if (this.skillPopoverDismissHandler) {
      return;
    }
    this.skillPopoverDismissHandler = (event: MouseEvent) => {
      if (!this.root.isConnected) {
        this.teardownSkillPopoverDismissHandler();
        return;
      }
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      const openPanelId = this.getOpenSkillPanelId();
      if (!openPanelId) {
        return;
      }
      const openPanelEl = this.queryPanelCard(this.root, openPanelId);
      const skillsControlEl = openPanelEl?.querySelector<HTMLElement>(".obsidian-codex__hub-panel-skill-control");
      if (skillsControlEl?.contains(target)) {
        return;
      }
      this.closeSkillPopover(openPanelId);
      this.callbacks.requestRender();
    };
    document.addEventListener("mousedown", this.skillPopoverDismissHandler, true);
  }

  private teardownSkillPopoverDismissHandler(): void {
    if (!this.skillPopoverDismissHandler) {
      return;
    }
    document.removeEventListener("mousedown", this.skillPopoverDismissHandler, true);
    this.skillPopoverDismissHandler = null;
  }

  private getOpenSkillPanelId(): string | null {
    return this.openSkillPanelIds.values().next().value ?? null;
  }

  private openSkillPopover(panelId: string): void {
    this.openSkillPanelIds.clear();
    this.openSkillPanelIds.add(panelId);
  }

  private closeSkillPopover(panelId: string, restoreFocus = false): void {
    this.openSkillPanelIds.delete(panelId);
    if (restoreFocus) {
      this.pendingFocusSkillTogglePanelId = panelId;
    }
  }

  private captureHubBodyState(): void {
    if (!this.hubBodyEl) {
      return;
    }
    this.hadOpenSkillDrawerDuringCapture = this.hubBodyEl.querySelector(".obsidian-codex__hub-panel-skill-drawer") !== null;
    this.preservedBodyScrollTop = this.hubBodyEl.scrollTop;
    if (this.preserveExactScrollOnNextRender) {
      this.preservedElementAnchor = null;
      this.preservedPanelAnchor = null;
      return;
    }
    if (this.preservedPanelAnchor) {
      return;
    }
    const anchorPanelId = this.getAnchorPanelId();
    if (anchorPanelId) {
      this.capturePanelAnchor(anchorPanelId);
    }
  }

  private getAnchorPanelId(): string | null {
    if (this.isCreatePanelPopoverOpen) {
      return null;
    }
    if (this.editingPanelId) {
      return this.editingPanelId;
    }
    for (const panelId of this.openSkillPanelIds) {
      return panelId;
    }
    return null;
  }

  private capturePanelAnchor(panelId: string): void {
    if (!this.hubBodyEl) {
      return;
    }
    const targetCard = this.queryPanelCard(this.hubBodyEl, panelId);
    if (!targetCard) {
      return;
    }
    this.preservedPanelAnchor = {
      panelId,
      offsetTop: Math.max(0, this.getElementOffsetTop(targetCard, this.hubBodyEl) - this.hubBodyEl.scrollTop),
    };
  }

  private captureSkillAnchor(skillName: string): void {
    if (!this.hubBodyEl) {
      return;
    }
    const selector = `[data-skill-name="${this.escapeAttributeValue(skillName)}"]`;
    const targetEl = this.hubBodyEl.querySelector<HTMLElement>(selector);
    if (!targetEl) {
      return;
    }
    this.preservedElementAnchor = {
      selector,
      offsetTop: Math.max(0, this.getElementOffsetTop(targetEl, this.hubBodyEl) - this.hubBodyEl.scrollTop),
    };
  }

  private queryPanelCard(parent: ParentNode, panelId: string): HTMLElement | null {
    return parent.querySelector<HTMLElement>(`${HubRenderer.PANEL_SELECTOR}[data-panel-id="${panelId}"]`);
  }

  private getElementOffsetTop(element: HTMLElement, ancestor: HTMLElement): number {
    let offsetTop = 0;
    let current: HTMLElement | null = element;
    while (current && current !== ancestor) {
      offsetTop += current.offsetTop;
      current = current.offsetParent as HTMLElement | null;
    }
    return offsetTop;
  }

  private escapeAttributeValue(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  private createActionButton(
    parent: HTMLElement,
    label: string,
    action: () => Promise<void>,
    muted = false,
  ): void {
    const button = parent.createEl("button", {
      cls: `obsidian-codex__change-card-btn${muted ? " is-muted" : ""}`,
      text: label,
    });
    button.type = "button";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void action().catch((error: unknown) => {
        new Notice((error as Error).message);
      });
    });
  }
}
