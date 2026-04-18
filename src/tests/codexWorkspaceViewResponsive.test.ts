// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { CodexWorkspaceView } from "../views/codexWorkspaceView";

function createHarness(initialCollapsed = false) {
  let collapsed = initialCollapsed;
  let shellWidth = 960;
  let contentWidth = 960;
  let windowWidth = 1400;
  const syncInputHeight = vi.fn();
  const service = {
    getStudyHubState: vi.fn(() => ({
      lastOpenedAt: null,
      isCollapsed: collapsed,
    })),
    setStudyHubCollapsed: vi.fn((next: boolean) => {
      collapsed = next;
    }),
  };

  const view = new CodexWorkspaceView({} as never, service as never) as unknown as {
    syncResponsiveHubCollapse: (widths: { paneWidth: number; windowWidth: number }) => void;
    syncResponsiveHubManualState: () => void;
    onResize: () => void;
    windowResizeHandler: () => void;
    shellEl: HTMLDivElement;
    contentEl: HTMLDivElement;
    composerRenderer: { syncInputHeight: () => void };
  };
  view.shellEl = document.createElement("div");
  view.contentEl = document.createElement("div");
  view.composerRenderer = { syncInputHeight };
  vi.spyOn(view.shellEl, "getBoundingClientRect").mockImplementation(
    () => ({ width: shellWidth } as DOMRect),
  );
  vi.spyOn(view.contentEl, "getBoundingClientRect").mockImplementation(
    () => ({ width: contentWidth } as DOMRect),
  );
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    get: () => windowWidth,
  });

  return {
    view,
    service,
    syncInputHeight,
    getCollapsed: () => collapsed,
    setCollapsed: (next: boolean) => {
      collapsed = next;
    },
    setShellWidth: (next: number) => {
      shellWidth = next;
    },
    setContentWidth: (next: number) => {
      contentWidth = next;
    },
    setWindowWidth: (next: number) => {
      windowWidth = next;
    },
  };
}

describe("CodexWorkspaceView responsive hub collapse", () => {
  it("auto-collapses an open hub on narrow widths and restores it when wide again", () => {
    const { view, service, getCollapsed } = createHarness(false);

    view.syncResponsiveHubCollapse({ paneWidth: 840, windowWidth: 1400 });
    expect(getCollapsed()).toBe(true);
    expect(service.setStudyHubCollapsed).toHaveBeenNthCalledWith(1, true);

    view.syncResponsiveHubCollapse({ paneWidth: 920, windowWidth: 1400 });
    expect(getCollapsed()).toBe(false);
    expect(service.setStudyHubCollapsed).toHaveBeenNthCalledWith(2, false);
  });

  it("preserves an already-collapsed hub across narrow and wide transitions", () => {
    const { view, service, getCollapsed } = createHarness(true);

    view.syncResponsiveHubCollapse({ paneWidth: 840, windowWidth: 1400 });
    expect(getCollapsed()).toBe(true);
    expect(service.setStudyHubCollapsed).not.toHaveBeenCalled();

    view.syncResponsiveHubCollapse({ paneWidth: 920, windowWidth: 1400 });
    expect(getCollapsed()).toBe(true);
    expect(service.setStudyHubCollapsed).not.toHaveBeenCalled();
  });

  it("treats manual narrow-width toggles as the new restored state", () => {
    const { view, service, getCollapsed, setCollapsed } = createHarness(false);

    view.syncResponsiveHubCollapse({ paneWidth: 840, windowWidth: 1400 });
    expect(getCollapsed()).toBe(true);
    expect(service.setStudyHubCollapsed).toHaveBeenNthCalledWith(1, true);

    setCollapsed(false);
    view.syncResponsiveHubManualState();

    view.syncResponsiveHubCollapse({ paneWidth: 920, windowWidth: 1400 });
    expect(getCollapsed()).toBe(false);
    expect(service.setStudyHubCollapsed).toHaveBeenCalledTimes(1);
  });

  it("uses onResize to react to shell width changes", () => {
    const { view, service, getCollapsed, setShellWidth, syncInputHeight } = createHarness(false);

    setShellWidth(840);
    view.onResize();
    expect(getCollapsed()).toBe(true);
    expect(service.setStudyHubCollapsed).toHaveBeenNthCalledWith(1, true);
    expect(syncInputHeight).toHaveBeenCalledTimes(1);

    setShellWidth(920);
    view.onResize();
    expect(getCollapsed()).toBe(false);
    expect(service.setStudyHubCollapsed).toHaveBeenNthCalledWith(2, false);
    expect(syncInputHeight).toHaveBeenCalledTimes(2);
  });

  it("auto-collapses when the window is narrow even if the pane stays wide", () => {
    const { view, service, getCollapsed, setShellWidth, setWindowWidth, syncInputHeight } = createHarness(false);

    setShellWidth(980);
    setWindowWidth(1080);
    view.onResize();

    expect(getCollapsed()).toBe(true);
    expect(service.setStudyHubCollapsed).toHaveBeenNthCalledWith(1, true);
    expect(syncInputHeight).toHaveBeenCalledTimes(1);

    setWindowWidth(1320);
    view.onResize();
    expect(getCollapsed()).toBe(false);
    expect(service.setStudyHubCollapsed).toHaveBeenNthCalledWith(2, false);
  });

  it("stays collapsed until both pane and window are wide again", () => {
    const { view, service, getCollapsed, setShellWidth, setWindowWidth } = createHarness(false);

    setShellWidth(980);
    setWindowWidth(1080);
    view.onResize();
    expect(getCollapsed()).toBe(true);

    setWindowWidth(1320);
    setShellWidth(840);
    view.onResize();
    expect(getCollapsed()).toBe(true);
    expect(service.setStudyHubCollapsed).toHaveBeenCalledTimes(1);

    setShellWidth(980);
    view.onResize();
    expect(getCollapsed()).toBe(false);
    expect(service.setStudyHubCollapsed).toHaveBeenCalledTimes(2);
  });

  it("reacts through the window resize handler", () => {
    const { view, service, getCollapsed, setWindowWidth, syncInputHeight } = createHarness(false);

    setWindowWidth(1080);
    view.windowResizeHandler();
    expect(getCollapsed()).toBe(true);
    expect(service.setStudyHubCollapsed).toHaveBeenNthCalledWith(1, true);
    expect(syncInputHeight).toHaveBeenCalledTimes(1);
  });
});
