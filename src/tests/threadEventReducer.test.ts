import { describe, expect, it } from "vitest";
import { AgentStore } from "../model/store";
import { ThreadEventReducer, type ThreadEventReducerDeps } from "../app/threadEventReducer";

function createReducer(store: AgentStore, overrides: Partial<Pick<ThreadEventReducerDeps, "shouldSuppressAssistantOutput">> = {}) {
  const queued: Array<{ tabId: string; messageId: string; text: string }> = [];
  const waiting: Array<{ tabId: string; phase: string }> = [];

  const reducer = new ThreadEventReducer({
    store,
    getLocale: () => "en",
    getShowReasoning: () => true,
    findTab: (tabId) => store.getState().tabs.find((tab) => tab.id === tabId) ?? null,
    setWaitingPhase: (tabId, phase, mode) => {
      waiting.push({ tabId, phase });
      store.setWaitingState(tabId, {
        phase,
        text: `${phase}:${mode}`,
      });
    },
    updateAccountUsageFromPatch: () => {},
    queueAssistantArtifactSync: (tabId, messageId, text) => {
      queued.push({ tabId, messageId, text });
    },
    ...overrides,
  });

  return { reducer, queued, waiting };
}

describe("ThreadEventReducer", () => {
  it("records assistant response items and queues artifact sync", () => {
    const store = new AgentStore(null, "/vault", true);
    const tabId = store.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    const { reducer, queued, waiting } = createReducer(store);
    const error = reducer.handleThreadEvent(tabId, {
      type: "response_item",
      timestamp: "2026-04-09T14:00:00Z",
      payload: {
        type: "message",
        role: "assistant",
        phase: "final_answer",
        text: "Finished the note review.",
      },
    });

    const messages = store.getState().tabs.find((tab) => tab.id === tabId)?.messages ?? [];
    expect(error).toBeNull();
    expect(messages.at(-1)?.text).toBe("Finished the note review.");
    expect(queued).toHaveLength(1);
    expect(waiting.at(-1)?.phase).toBe("finalizing");
  });

  it("does not overwrite an earlier assistant message when later turns reuse timestamp and phase", () => {
    const store = new AgentStore(null, "/vault", true);
    const tabId = store.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    const { reducer } = createReducer(store);
    reducer.handleThreadEvent(
      tabId,
      {
        type: "response_item",
        timestamp: "2026-04-09T14:00:00Z",
        payload: {
          type: "message",
          role: "assistant",
          phase: "final_answer",
          text: "Quiz 1/5\n\nFirst question.",
        },
      },
      "visible",
      "turn-1",
    );
    reducer.handleThreadEvent(
      tabId,
      {
        type: "response_item",
        timestamp: "2026-04-09T14:00:00Z",
        payload: {
          type: "message",
          role: "assistant",
          phase: "final_answer",
          text: "Quiz 2/5\n\nSecond question.",
        },
      },
      "visible",
      "turn-2",
    );

    const messages = store.getState().tabs.find((tab) => tab.id === tabId)?.messages.filter((message) => message.kind === "assistant") ?? [];
    expect(messages.map((message) => message.text)).toEqual(["Quiz 1/5\n\nFirst question.", "Quiz 2/5\n\nSecond question."]);
  });

  it("can suppress a duplicate visible assistant output before it reaches transcript history", () => {
    const store = new AgentStore(null, "/vault", true);
    const tabId = store.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    const { reducer, queued } = createReducer(store, {
      shouldSuppressAssistantOutput: (_tabId, text) => text === "Repeated quiz reply.",
    });
    reducer.handleThreadEvent(
      tabId,
      {
        type: "response_item",
        timestamp: "2026-04-09T14:00:00Z",
        payload: {
          type: "message",
          role: "assistant",
          phase: "final_answer",
          text: "Repeated quiz reply.",
        },
      },
      "visible",
      "turn-2",
    );

    const messages = store.getState().tabs.find((tab) => tab.id === tabId)?.messages ?? [];
    expect(messages).toHaveLength(0);
    expect(queued).toHaveLength(0);
  });

  it("applies assistant output suppression to task_complete fallback messages", () => {
    const store = new AgentStore(null, "/vault", true);
    const tabId = store.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    const { reducer, queued } = createReducer(store, {
      shouldSuppressAssistantOutput: (_tabId, text) => text === "Repeated quiz reply.",
    });
    reducer.handleThreadEvent(
      tabId,
      {
        type: "event_msg",
        timestamp: "2026-04-09T14:00:00Z",
        payload: {
          type: "task_complete",
          last_agent_message: "Repeated quiz reply.",
        },
      },
      "visible",
      "turn-2",
    );

    const messages = store.getState().tabs.find((tab) => tab.id === tabId)?.messages ?? [];
    expect(messages).toHaveLength(0);
    expect(queued).toHaveLength(0);
  });

  it("can queue assistant artifacts without inserting visible transcript messages", () => {
    const store = new AgentStore(null, "/vault", true);
    const tabId = store.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    const { reducer, queued, waiting } = createReducer(store);
    const error = reducer.handleThreadEvent(
      tabId,
      {
        type: "response_item",
        timestamp: "2026-04-09T14:00:00Z",
        payload: {
          type: "message",
          role: "assistant",
          phase: "final_answer",
          text: "```obsidian-patch\npath: notes/current.md\nkind: update\nsummary: Repair\n\n---content\nUpdated.\n---end\n```",
        },
      },
      "artifact_only",
    );

    const messages = store.getState().tabs.find((tab) => tab.id === tabId)?.messages ?? [];
    expect(error).toBeNull();
    expect(messages).toHaveLength(0);
    expect(queued).toEqual([
      expect.objectContaining({
        tabId,
        text: "```obsidian-patch\npath: notes/current.md\nkind: update\nsummary: Repair\n\n---content\nUpdated.\n---end\n```",
      }),
    ]);
    expect(waiting.at(-1)?.phase).toBe("finalizing");
  });

  it("does not queue duplicate artifacts from task_complete fallback in artifact-only mode", () => {
    const store = new AgentStore(null, "/vault", true);
    const tabId = store.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    const patchText = "```obsidian-patch\npath: notes/current.md\nkind: update\nsummary: Repair\n\n---content\nUpdated.\n---end\n```";
    const { reducer, queued } = createReducer(store);
    reducer.handleThreadEvent(
      tabId,
      {
        type: "response_item",
        timestamp: "2026-04-09T14:00:00Z",
        payload: {
          type: "message",
          role: "assistant",
          phase: "final_answer",
          text: patchText,
        },
      },
      "artifact_only",
    );
    reducer.handleThreadEvent(
      tabId,
      {
        type: "event_msg",
        timestamp: "2026-04-09T14:00:01Z",
        payload: {
          type: "task_complete",
          last_agent_message: patchText,
        },
      },
      "artifact_only",
    );

    expect(queued).toHaveLength(1);
    expect(queued[0]?.text).toBe(patchText);
  });

  it("suppresses operational sandbox chatter from assistant messages", () => {
    const store = new AgentStore(null, "/vault", true);
    const tabId = store.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    const { reducer, queued } = createReducer(store);
    const error = reducer.handleThreadEvent(tabId, {
      type: "response_item",
      timestamp: "2026-04-09T14:00:00Z",
      payload: {
        type: "message",
        role: "assistant",
        phase: "final_answer",
        text: "The local read failed because the windows sandbox spawn setup refresh failed. I will try a minimal command next.",
      },
    });

    const messages = store.getState().tabs.find((tab) => tab.id === tabId)?.messages ?? [];
    expect(error).toBeNull();
    expect(messages).toHaveLength(0);
    expect(queued).toHaveLength(0);
  });

  it("suppresses note-read troubleshooting chatter after source-pack turns", () => {
    const store = new AgentStore(null, "/vault", true);
    const tabId = store.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    const { reducer, queued } = createReducer(store);
    const error = reducer.handleThreadEvent(tabId, {
      type: "response_item",
      timestamp: "2026-04-09T14:00:00Z",
      payload: {
        type: "message",
        role: "assistant",
        phase: "final_answer",
        text: "対象ノートの現状を確認して、ノート本文と同フォルダ構成を順に確認します。ローカル読み取りで一時的な実行エラーが出たので、単発で再取得します。",
      },
    });

    const messages = store.getState().tabs.find((tab) => tab.id === tabId)?.messages ?? [];
    expect(error).toBeNull();
    expect(messages).toHaveLength(0);
    expect(queued).toHaveLength(0);
  });

  it("keeps substantive analysis when troubleshooting chatter appears in a separate leading block", () => {
    const store = new AgentStore(null, "/vault", true);
    const tabId = store.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    const { reducer, queued } = createReducer(store);
    const error = reducer.handleThreadEvent(tabId, {
      type: "response_item",
      timestamp: "2026-04-09T14:00:00Z",
      payload: {
        type: "message",
        role: "assistant",
        phase: "final_answer",
        text: [
          "The local read failed because the windows sandbox spawn setup refresh failed. I will try a minimal command next.",
          "The main point of Theorem 2.1 is that the predictor state equals the true future state x(t + D).",
        ].join("\n\n"),
      },
    });

    const messages = store.getState().tabs.find((tab) => tab.id === tabId)?.messages ?? [];
    expect(error).toBeNull();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toContain("The main point of Theorem 2.1");
    expect(messages[0]?.text).not.toContain("minimal command");
    expect(queued).toHaveLength(1);
  });

  it("records shell activity from command execution items", () => {
    const store = new AgentStore(null, "/vault", true);
    const tabId = store.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    const { reducer } = createReducer(store);
    reducer.handleThreadEvent(tabId, {
      type: "item.completed",
      item: {
        id: "shell-1",
        type: "command_execution",
        command: "npm test",
        output: "ok",
      },
    });

    const toolLog = store.getState().tabs.find((tab) => tab.id === tabId)?.toolLog ?? [];
    expect(toolLog).toEqual([
      expect.objectContaining({
        callId: "shell-1",
        kind: "shell",
        title: "Run shell command",
        status: "completed",
      }),
    ]);
  });

  it("passes through string turn.failed errors", () => {
    const store = new AgentStore(null, "/vault", true);
    const tabId = store.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    const { reducer } = createReducer(store);
    const error = reducer.handleThreadEvent(tabId, {
      type: "turn.failed",
      error: "raw runtime failure",
    });

    expect(error).toBe("raw runtime failure");
  });

  it("passes through nested turn.failed API errors", () => {
    const store = new AgentStore(null, "/vault", true);
    const tabId = store.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    const { reducer } = createReducer(store);
    const error = reducer.handleThreadEvent(tabId, {
      type: "turn.failed",
      error: {
        error: {
          message: "nested runtime failure",
        },
      },
    });

    expect(error).toBe("nested runtime failure");
  });

  it("passes through item.error payloads without dropping nested messages", () => {
    const store = new AgentStore(null, "/vault", true);
    const tabId = store.getActiveTab()?.id;
    if (!tabId) {
      throw new Error("Missing tab");
    }

    const { reducer } = createReducer(store);
    const error = reducer.handleThreadEvent(tabId, {
      type: "item.completed",
      item: {
        id: "error-1",
        type: "error",
        error: {
          error: {
            message: "item payload failed",
          },
        },
      },
    });

    expect(error).toBe("item payload failed");
  });
});
