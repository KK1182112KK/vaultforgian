import { describe, expect, it } from "vitest";
import type { ChatMessage, PendingApproval, ToolCallRecord, WaitingState } from "../model/types";
import {
  buildTranscriptEntries,
  hasRunningTranscriptActivity,
  shouldRenderActivity,
  shouldRenderWaitingEntry,
} from "../util/transcriptEntries";

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

  it("hides generic mcp plumbing activity and keeps waiting visible when it is the only running activity", () => {
    const genericMcp: ToolCallRecord = {
      id: "mcp-1",
      callId: "mcp-1",
      kind: "mcp",
      name: "mcp_tool",
      title: "mcp_tool",
      summary: "mcp_tool",
      argsJson: "{}",
      createdAt: 15,
      updatedAt: 15,
      status: "running",
    };

    expect(shouldRenderActivity(genericMcp)).toBe(false);
    expect(shouldRenderWaitingEntry("busy", waitingState, [genericMcp], [])).toBe(true);

    const entries = buildTranscriptEntries(messages, true, [genericMcp], [], waitingState, "busy");
    expect(entries.some((entry) => entry.type === "activity")).toBe(false);
    expect(entries.at(-1)?.type).toBe("waiting");
  });

  it("keeps meaningful and failed mcp activity visible", () => {
    const meaningfulMcp: ToolCallRecord = {
      id: "mcp-meaningful",
      callId: "mcp-meaningful",
      kind: "mcp",
      name: "vault_search",
      title: "vault_search",
      summary: "Found 3 matching notes",
      argsJson: "{}",
      createdAt: 15,
      updatedAt: 15,
      status: "completed",
    };
    const failedGenericMcp: ToolCallRecord = {
      id: "mcp-failed",
      callId: "mcp-failed",
      kind: "mcp",
      name: "mcp_tool",
      title: "mcp_tool",
      summary: "mcp_tool",
      argsJson: "{}",
      createdAt: 16,
      updatedAt: 16,
      status: "failed",
      resultText: "Permission denied",
    };

    expect(shouldRenderActivity(meaningfulMcp)).toBe(true);
    expect(shouldRenderActivity(failedGenericMcp)).toBe(true);
  });

  it("hides completed plugin-managed note apply activity while keeping failures visible", () => {
    const completedApply: ToolCallRecord = {
      id: "patch-1",
      callId: "patch-1",
      kind: "file",
      name: "write_note",
      title: "Apply note patch",
      summary: "Clarify the right-triangle condition.",
      argsJson: "@@",
      createdAt: 15,
      updatedAt: 16,
      status: "completed",
      resultText: "Pythagorean Theorem.md",
    };
    const failedApply: ToolCallRecord = {
      ...completedApply,
      id: "patch-failed",
      callId: "patch-failed",
      status: "failed",
      resultText: "Patch conflict",
    };
    const completedSkillUpdate: ToolCallRecord = {
      ...completedApply,
      id: "skill-update-1",
      callId: "skill-update-1",
      name: "skill_update",
      title: "Update skill: figma-generate-design",
      summary: "Update learned refinements.",
      resultText: "/vault/skills/figma-generate-design/SKILL.md",
    };

    expect(shouldRenderActivity(completedApply)).toBe(false);
    expect(shouldRenderActivity(completedSkillUpdate)).toBe(false);
    expect(shouldRenderActivity(failedApply)).toBe(true);

    const entries = buildTranscriptEntries(messages, true, [completedApply, completedSkillUpdate], [], null, "ready");
    expect(entries.some((entry) => entry.type === "activity")).toBe(false);
  });

  it("appends a waiting row when no activity is available", () => {
    const entries = buildTranscriptEntries(messages, true, [], [], waitingState, "busy");
    expect(entries.at(-1)?.type).toBe("waiting");
  });
});
