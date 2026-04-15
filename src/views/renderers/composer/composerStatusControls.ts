import { setIcon } from "obsidian";
import type { AccountUsageSummary } from "../../../model/types";
import { sortReasoningEffortsDescending } from "../../../util/reasoning";
import { getVisibleUsageMeters } from "../../../util/usageDisplay";
import { buildStatusBarDisplayState } from "../viewModels/workspaceViewModels";
import {
  compactModelLabel,
  displayEffortLabel,
  isTabStreaming,
  type StatusMenuOption,
} from "../workspaceViewShared";
import type { ComposerElements, ComposerSharedState } from "./types";

export class ComposerStatusControls {
  private statusMenuOwnerTabId: string | null = null;

  constructor(
    private readonly elements: ComposerElements,
    private readonly state: ComposerSharedState,
  ) {
    this.elements.modelButtonEl.addEventListener("click", (event) => {
      event.stopPropagation();
      this.showModelPicker(this.elements.modelButtonEl);
    });
    this.elements.thinkingButtonEl.addEventListener("click", (event) => {
      event.stopPropagation();
      this.showThinkingPicker(this.elements.thinkingButtonEl);
    });
    this.elements.modifierControlEl.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.showModifierPicker(this.elements.modifierControlEl);
    });
    this.elements.fastModeControlEl.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.toggleFastMode();
    });
    this.elements.yoloControlEl.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.elements.yoloControlEl.disabled) {
        return;
      }
      const nextMode = this.context?.service.getPermissionMode() === "full-auto" ? "auto-edit" : "full-auto";
      if (nextMode) {
        void this.context?.service.setPermissionMode(nextMode);
      }
    });
  }

  private get context() {
    return this.state.context;
  }

  private toggleFastMode(): void {
    const context = this.context;
    const tabId = context?.activeTab?.id;
    if (!context || !tabId || this.elements.fastModeControlEl.disabled) {
      return;
    }
    context.service.setTabFastMode(tabId, !Boolean(context.activeTab?.fastMode));
  }

  render(): void {
    const context = this.context;
    if (!context) {
      return;
    }
    const activeTabId = context.activeTab?.id ?? null;
    if (this.statusMenuOwnerTabId && this.statusMenuOwnerTabId !== activeTabId) {
      this.closeStatusMenu();
    }

    this.elements.modelButtonEl.ariaLabel = context.copy.workspace.selectModel;
    this.elements.modelButtonEl.title = context.copy.workspace.selectModel;
    this.elements.thinkingButtonEl.ariaLabel = context.copy.workspace.selectThinkingLevel;
    this.elements.thinkingButtonEl.title = context.copy.workspace.selectThinkingLevel;
    this.elements.fastModeControlEl.ariaLabel = context.copy.workspace.toggleFastMode;
    this.elements.yoloControlEl.ariaLabel = context.copy.workspace.toggleYolo;
    this.elements.yoloControlEl.title = context.copy.workspace.toggleYolo;
    this.elements.modifierControlEl.ariaLabel = context.copy.workspace.addModifier;
    this.elements.modifierControlEl.title = context.copy.workspace.addModifier;
    this.elements.modifierControlEl.textContent = `+ ${context.copy.workspace.addModifier}`;
    this.elements.sendButton.dataset.smoke = "composer-send";
    this.elements.modifierControlEl.dataset.smoke = "composer-modifier-trigger";
    this.elements.modelButtonEl.dataset.smoke = "composer-model-trigger";
    this.elements.thinkingButtonEl.dataset.smoke = "composer-thinking-trigger";
    this.elements.fastModeControlEl.dataset.smoke = "composer-fastmode";
    this.elements.yoloControlEl.dataset.smoke = "composer-yolo";
    this.elements.fastModeTextEl.textContent = context.copy.workspace.fastMode;

    const yoloText = this.elements.yoloControlEl.querySelector(".obsidian-codex__yolo-text");
    if (yoloText) {
      yoloText.textContent = context.copy.workspace.yolo;
    }

    const catalog = context.state.availableModels.length > 0 ? context.state.availableModels : context.service.getAvailableModels();
    if (context.activeTab?.id) {
      context.service.ensureAccountUsage(context.activeTab.id);
    }
    const statusState = buildStatusBarDisplayState(
      context.activeTab,
      catalog,
      context.state.accountUsage ?? null,
      context.service.getPermissionMode(),
      context.locale,
      context.copy.workspace,
    );

    this.elements.modelValueEl.textContent = statusState.modelLabel;
    this.elements.modelValueEl.setAttribute("aria-label", `${context.copy.workspace.modelMenuTitle}: ${statusState.modelLabel}`);
    this.elements.thinkingValueEl.textContent = statusState.reasoningLabel;
    this.elements.thinkingValueEl.setAttribute("aria-label", `${context.copy.workspace.thinkingMenuTitle}: ${statusState.reasoningLabel}`);
    this.elements.fastModeControlEl.classList.toggle("is-active", statusState.fastModeActive);
    this.elements.fastModeControlEl.disabled = statusState.streaming || !context.activeTab;
    this.elements.fastModeControlEl.ariaPressed = String(statusState.fastModeActive);
    this.elements.executionStateEl.dataset.smoke = "composer-execution-state";
    this.elements.executionStateEl.textContent = statusState.effectivePermissionState;
    this.elements.executionStateEl.classList.add("is-visible");
    this.renderUsageMeters(context.state.accountUsage ?? null);
    this.elements.statusBarEl.classList.toggle("is-streaming", statusState.streaming);
    this.elements.yoloControlEl.classList.toggle("is-active", statusState.yoloActive);
    this.elements.yoloControlEl.disabled = statusState.streaming || !context.activeTab;
    this.elements.planWarningEl.dataset.smoke = "composer-plan-warning";
    this.elements.planWarningEl.textContent = statusState.showPlanYoloWarning ? context.copy.workspace.planYoloWarning : "";
    this.elements.planWarningEl.classList.toggle("is-visible", statusState.showPlanYoloWarning);
    this.elements.fastModeControlEl.title = statusState.streaming
      ? context.copy.workspace.fastModeStreamingTooltip
      : `${context.copy.workspace.fastMode} · ${context.copy.workspace.fastModeHint}`;
    this.elements.fastModeControlEl.ariaLabel = this.elements.fastModeControlEl.title;
    this.elements.yoloControlEl.title = context.copy.workspace.toggleYolo;
    this.elements.yoloControlEl.ariaLabel = this.elements.yoloControlEl.title;

    if (
      statusState.streaming &&
      this.state.statusMenuAnchorEl &&
      (this.state.statusMenuAnchorEl === this.elements.modelButtonEl || this.state.statusMenuAnchorEl === this.elements.thinkingButtonEl)
    ) {
      this.closeStatusMenu();
    }
  }

  closeStatusMenu(): void {
    this.state.statusMenuEl?.remove();
    this.state.statusMenuEl = null;
    this.state.statusMenuAnchorEl?.classList.remove("is-open");
    this.state.statusMenuAnchorEl = null;
    this.statusMenuOwnerTabId = null;
    if (this.state.statusMenuCloseHandler) {
      document.removeEventListener("click", this.state.statusMenuCloseHandler);
      this.state.statusMenuCloseHandler = null;
    }
  }

  private closeStatusMenuWithFocusRestore(restoreFocus = false): void {
    const anchor = this.state.statusMenuAnchorEl;
    this.closeStatusMenu();
    if (restoreFocus) {
      anchor?.focus();
    }
  }

  private focusStatusMenuItem(items: HTMLDivElement[], index: number): void {
    const nextItem = items[index];
    if (!nextItem) {
      return;
    }
    nextItem.focus();
    nextItem.scrollIntoView({ block: "nearest" });
  }

  private renderUsageMeters(accountUsage: AccountUsageSummary | null): void {
    const context = this.context!;
    this.elements.usageMetersEl.empty();
    const meters = getVisibleUsageMeters(accountUsage);
    this.elements.usageMetersEl.classList.add("is-visible");
    this.elements.usageMetersEl.dataset.smoke = "composer-usage";
    delete this.elements.usageMetersEl.dataset.usageFreshness;

    const headerEl = this.elements.usageMetersEl.createDiv({ cls: "obsidian-codex__usage-header" });
    headerEl.createSpan({ cls: "obsidian-codex__usage-title", text: context.copy.workspace.usageTitle });
    const planTypeLabel = accountUsage?.limits.planType ? String(accountUsage.limits.planType).toUpperCase() : null;
    if (planTypeLabel) {
      headerEl.createSpan({ cls: "obsidian-codex__usage-meta", text: planTypeLabel });
    }

    if (!meters.length) {
      this.elements.usageMetersEl.classList.add("is-empty");
      this.elements.usageMetersEl.createDiv({ cls: "obsidian-codex__usage-empty", text: context.copy.workspace.noUsageYet });
      return;
    }

    this.elements.usageMetersEl.classList.remove("is-empty");
    for (const meter of meters) {
      const rowEl = this.elements.usageMetersEl.createDiv({ cls: "obsidian-codex__usage-meter" });
      rowEl.dataset.smoke = "composer-usage-meter";
      rowEl.dataset.usageKey = meter.key;
      rowEl.createSpan({ cls: "obsidian-codex__usage-meter-label", text: meter.label });
      const barEl = rowEl.createDiv({
        cls: "obsidian-codex__usage-meter-bar",
        attr: {
          role: "meter",
          "aria-label": context.copy.workspace.usageRemainingAria(meter.label),
          "aria-valuemin": "0",
          "aria-valuemax": "100",
          "aria-valuenow": String(meter.percent),
          title: context.copy.workspace.usageTitleTooltip(
            meter.displayPercent,
            meter.displayUsedPercent,
            null,
          ),
        },
      });
      barEl.createDiv({
        cls: "obsidian-codex__usage-meter-spent",
        attr: { style: `width:${meter.usedPercent}%` },
      });
      barEl.createDiv({
        cls: "obsidian-codex__usage-meter-fill",
        attr: { style: `width:${meter.percent}%` },
      });
      rowEl.createSpan({ cls: "obsidian-codex__usage-meter-value", text: `${meter.displayPercent}%` });
    }
  }

  private showModelPicker(anchor: HTMLElement): void {
    const context = this.context;
    if (!context?.activeTab || isTabStreaming(context.activeTab.status)) {
      return;
    }
    const ownerTabId = context.activeTab.id;
    const models = context.state.availableModels.length > 0 ? context.state.availableModels : context.service.getAvailableModels();
    const options = models.map((model) => ({
      label: compactModelLabel(model.slug, model.displayName),
      selected: model.slug === context.activeTab!.model,
      onSelect: () => {
        if (this.context?.activeTab?.id !== ownerTabId) {
          return;
        }
        void context.service.setTabModel(ownerTabId, model.slug);
      },
    }));
    this.showStatusMenu(anchor, context.copy.workspace.modelMenuTitle, options, { ownerTabId });
  }

  private showThinkingPicker(anchor: HTMLElement): void {
    const context = this.context;
    if (!context?.activeTab || isTabStreaming(context.activeTab.status)) {
      return;
    }
    const ownerTabId = context.activeTab.id;
    const models = context.state.availableModels.length > 0 ? context.state.availableModels : context.service.getAvailableModels();
    const selectedModel =
      models.find((entry) => entry.slug === context.activeTab!.model) ??
      models[0] ?? {
        slug: context.activeTab.model,
        displayName: context.activeTab.model,
        defaultReasoningLevel: "medium" as const,
        supportedReasoningLevels: ["low", "medium", "high", "xhigh"] as const,
      };
    const options = sortReasoningEffortsDescending(selectedModel.supportedReasoningLevels).map((level) => ({
      label: displayEffortLabel(level, context.locale),
      selected: level === context.activeTab!.reasoningEffort,
      iconText: "\u25CC",
      onSelect: () => {
        if (this.context?.activeTab?.id !== ownerTabId) {
          return;
        }
        void context.service.setTabReasoningEffort(ownerTabId, level);
      },
    }));
    this.showStatusMenu(anchor, context.copy.workspace.thinkingMenuTitle, options, { ownerTabId });
  }

  private showModifierPicker(anchor: HTMLElement): void {
    const context = this.context;
    if (!context?.activeTab) {
      return;
    }
    const ownerTabId = context.activeTab.id;
    const selectedLabels = new Set((context.activeTab.instructionChips ?? []).map((chip) => chip.label.toLowerCase()));
    const options = context.service.getInstructionOptions().map((option) => ({
      label: `#${option.label}`,
      description: option.description,
      selected: selectedLabels.has(option.label.toLowerCase()),
      onSelect: () => {
        if (this.context?.activeTab?.id !== ownerTabId) {
          return;
        }
        context.service.addInstructionChips(ownerTabId, [option.label]);
      },
    }));
    this.showStatusMenu(anchor, context.copy.workspace.modifiers, options, {
      container: this.elements.root,
      width: 312,
      placement: "above",
      menuClassName: "obsidian-codex__status-menu obsidian-codex__status-menu--modifier",
      menuSmokeId: "composer-modifier-menu",
      ownerTabId,
    });
  }

  private showStatusMenu(
    anchor: HTMLElement,
    title: string,
    options: StatusMenuOption[],
    config: {
      container?: HTMLElement;
      width?: number;
      placement?: "above" | "below";
      menuClassName?: string;
      menuSmokeId?: string;
      ownerTabId?: string | null;
    } = {},
  ): void {
    if (this.state.statusMenuAnchorEl === anchor) {
      this.closeStatusMenu();
      return;
    }
    this.closeStatusMenu();
    anchor.classList.add("is-open");

    const container = config.container ?? this.elements.statusBarEl;
    const placement = config.placement ?? "above";
    const menuWidth = config.width ?? 248;
    const menu = container.createDiv({ cls: config.menuClassName ?? "obsidian-codex__status-menu" });
    if (config.menuSmokeId) {
      menu.dataset.smoke = config.menuSmokeId;
    }
    menu.createDiv({ cls: "obsidian-codex__status-menu-title", text: title });
    const scrollEl = menu.createDiv({ cls: "obsidian-codex__status-menu-scroll" });
    const items: HTMLDivElement[] = [];
    for (const option of options) {
      const item = scrollEl.createDiv({ cls: `obsidian-codex__status-menu-item${option.selected ? " is-selected" : ""}` });
      item.tabIndex = 0;
      items.push(item);
      const leading = item.createSpan({ cls: "obsidian-codex__status-menu-leading", text: option.iconText ?? "" });
      if (!option.iconText) {
        leading.addClass("is-empty");
      }
      const body = item.createDiv({ cls: "obsidian-codex__status-menu-item-body" });
      body.createSpan({ cls: "obsidian-codex__status-menu-label", text: option.label });
      if (option.description) {
        body.createDiv({ cls: "obsidian-codex__status-menu-description", text: option.description });
      }
      const check = item.createSpan({ cls: "obsidian-codex__status-menu-check" });
      if (option.selected) {
        setIcon(check, "check");
      }
      item.addEventListener("click", (event) => {
        event.stopPropagation();
        option.onSelect();
        this.closeStatusMenu();
      });
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          option.onSelect();
          this.closeStatusMenu();
        }
      });
    }
    const focusItemByOffset = (offset: number) => {
      if (items.length === 0) {
        return;
      }
      const activeIndex = items.findIndex((item) => item === document.activeElement);
      const currentIndex = activeIndex >= 0 ? activeIndex : Math.max(0, options.findIndex((option) => option.selected));
      const nextIndex = Math.max(0, Math.min(items.length - 1, currentIndex + offset));
      this.focusStatusMenuItem(items, nextIndex);
    };
    menu.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.closeStatusMenuWithFocusRestore(true);
        return;
      }
      if (event.key === "Tab") {
        this.closeStatusMenu();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusItemByOffset(1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        focusItemByOffset(-1);
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        this.focusStatusMenuItem(items, 0);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        this.focusStatusMenuItem(items, items.length - 1);
      }
    });

    menu.style.width = `${menuWidth}px`;
    menu.style.bottom = "auto";

    const statusRect = container.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const left = Math.max(0, Math.min(anchorRect.left - statusRect.left, Math.max(0, statusRect.width - menuWidth)));
    menu.style.left = `${left}px`;
    const top =
      placement === "below"
        ? anchorRect.bottom - statusRect.top + 6
        : anchorRect.top - statusRect.top - menu.offsetHeight - 8;
    menu.style.top = `${top}px`;

    this.state.statusMenuEl = menu;
    this.state.statusMenuAnchorEl = anchor;
    this.statusMenuOwnerTabId = config.ownerTabId ?? this.context?.activeTab?.id ?? null;
    this.state.statusMenuCloseHandler = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && !menu.contains(target) && !anchor.contains(target)) {
        this.closeStatusMenu();
      }
    };

    window.setTimeout(() => {
      if (this.state.statusMenuCloseHandler) {
        document.addEventListener("click", this.state.statusMenuCloseHandler);
      }
      const selectedIndex = Math.max(0, options.findIndex((option) => option.selected));
      this.focusStatusMenuItem(items, selectedIndex);
    }, 0);
  }
}
