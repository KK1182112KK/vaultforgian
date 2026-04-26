// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { ComposerStatusControls } from "../../views/renderers/composer/composerStatusControls";
import type { ComposerElements, ComposerSharedState } from "../../views/renderers/composer/types";

function createElements(): ComposerElements {
  const root = document.createElement("div");
  const div = () => document.createElement("div");
  const span = () => document.createElement("span");
  const button = () => document.createElement("button");
  return {
    root,
    composerFlagsEl: div(),
    tabBarEl: div(),
    slashMenuEl: div(),
    contextRowEl: div(),
    referenceDocEl: div(),
    instructionRowEl: div(),
    selectionPreviewEl: div(),
    attachmentsRowEl: div(),
    changesTrayEl: div(),
    planModeTextEl: div(),
    workflowBriefEl: div(),
    inputRowEl: div(),
    attachButtonEl: button(),
    inputEl: document.createElement("textarea"),
    sendButton: button(),
    sendIconEl: span(),
    fileInputEl: document.createElement("input"),
    statusBarEl: div(),
    statusPrimaryEl: div(),
    statusHeaderEl: div(),
    statusControlsEl: div(),
    statusTogglesEl: div(),
    modelGroupEl: div(),
    modelButtonEl: button(),
    modelValueEl: span(),
    executionStateEl: div(),
    usageMetersEl: div(),
    planWarningEl: div(),
    learningModeControlEl: button(),
    learningModeTextEl: span(),
    fastModeControlEl: button(),
    fastModeTextEl: span(),
    thinkingButtonEl: button(),
    thinkingValueEl: span(),
    yoloControlEl: button(),
  };
}

function createState(): ComposerSharedState {
  return {
    context: null,
    composerSuggestions: [],
    composerSelectedIndex: 0,
    statusMenuEl: null,
    statusMenuAnchorEl: null,
    statusMenuCloseHandler: null,
    historyByTab: new Map(),
    lastAppliedDraftByTab: new Map(),
    lastRenderedTabId: null,
    applyingPatchIds: new Set(),
    isSending: false,
    isApplyingHistoryDraft: false,
  };
}

describe("ComposerStatusControls", () => {
  it("removes constructor event listeners on dispose", () => {
    const elements = createElements();
    const controls = new ComposerStatusControls(elements, createState()) as ComposerStatusControls & { dispose?: () => void };
    const removers = [
      vi.spyOn(elements.modelButtonEl, "removeEventListener"),
      vi.spyOn(elements.thinkingButtonEl, "removeEventListener"),
      vi.spyOn(elements.learningModeControlEl, "removeEventListener"),
      vi.spyOn(elements.fastModeControlEl, "removeEventListener"),
      vi.spyOn(elements.yoloControlEl, "removeEventListener"),
    ];

    expect(typeof controls.dispose).toBe("function");
    controls.dispose?.();

    for (const remover of removers) {
      expect(remover).toHaveBeenCalledWith("click", expect.any(Function));
    }
  });
});
