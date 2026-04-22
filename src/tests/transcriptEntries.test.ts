import { describe, expect, it } from "vitest";
import type { ChatMessage, PendingApproval, ToolCallRecord, WaitingState } from "../model/types";
import { buildTranscriptEntries, hasRunningTranscriptActivity, shouldRenderWaitingEntry } from "../util/transcriptEntries";

describe("transcript entry helpers", () => {
  const messages: ChatMessage[] = [
    {
      id: "user-1",
      kind: "user",
      text: "hello",
      createdAt: 10,
    },
    {
      id: "reason-1",
      kind: "reasoning",
      text: "thinking",
      createdAt: 20,
    },
  ];

  const toolLog: ToolCallRecord[] = [
    {
      id: "tool-1",
      callId: "call-1",
      kind: "shell",
      name: "command_execution",
      title: "Run shell command",
      summary: "npm test",
      argsJson: "{}",
      createdAt: 15,
      updatedAt: 15,
      status: "running",
    },
  ];

  const approvals: PendingApproval[] = [
    {
      id: "approval-1",
      tabId: "tab-1",
      callId: "call-approve",
      toolName: "run_shell",
      title: "Run shell command",
      description: "Needs approval",
      details: "npm install",
      createdAt: 14,
    },
  ];

  const waitingState: WaitingState = {
    phase: "tools",
    text: "Using tools",
  };

  it("detects running activity from tools or approvals", () => {
    expect(hasRunningTranscriptActivity(toolLog, [])).toBe(true);
    expect(hasRunningTranscriptActivity([], approvals)).toBe(true);
    expect(hasRunningTranscriptActivity([], [])).toBe(false);
  });

  it("suppresses tool waiting rows when activity already exists", () => {
    expect(shouldRenderWaitingEntry("busy", waitingState, toolLog, [])).toBe(false);
    expect(shouldRenderWaitingEntry("busy", waitingState, [], approvals)).toBe(false);
    expect(shouldRenderWaitingEntry("busy", waitingState, [], [])).toBe(true);
  });

  it("keeps tool waiting rows visible when only hidden shell activity is running", () => {
    expect(shouldRenderWaitingEntry("busy", waitingState, toolLog, [], ["shell"])).toBe(true);
  });

  it("keeps non-tool waiting rows visible", () => {
    expect(
      shouldRenderWaitingEntry(
        "busy",
        {
          phase: "reasoning",
          text: "Reasoning",
        },
        toolLog,
        approvals,
      ),
    ).toBe(true);
  });

  it("merges transcript entries in chronological order and hides reasoning when requested", () => {
    const entries = buildTranscriptEntries(messages, false, toolLog, approvals, waitingState, "busy");
    expect(entries.map((entry) => entry.type)).toEqual(["message", "approval", "activity"]);
    expect(entries[0]?.type === "message" ? entries[0].message.id : null).toBe("user-1");
    expect(entries[1]?.type === "approval" ? entries[1].approval.id : null).toBe("approval-1");
    expect(entries[2]?.type === "activity" ? entries[2].activity.callId : null).toBe("call-1");
  });

  it("can hide selected activity kinds without changing message ordering", () => {
    const entries = buildTranscriptEntries(messages, true, toolLog, approvals, waitingState, "busy", ["shell"]);
    expect(entries.map((entry) => entry.type)).toEqual(["message", "approval", "message"]);
  });

  it("appends a waiting row when no activity is available", () => {
    const entries = buildTranscriptEntries(messages, true, [], [], waitingState, "busy");
    expect(entries.at(-1)?.type).toBe("waiting");
  });
});
