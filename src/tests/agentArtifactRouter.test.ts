import { describe, expect, it, vi } from "vitest";
import { AgentArtifactRouter } from "../agent/core/agentArtifactRouter";

describe("AgentArtifactRouter", () => {
  it("parses assistant text once and exposes normalized artifacts to handlers", async () => {
    const onRoute = vi.fn();
    const router = new AgentArtifactRouter({ onRoute });

    const result = await router.routeAssistantText({
      tabId: "tab-1",
      messageId: "assistant-1",
      text: [
        "Done.",
        "```obsidian-suggest",
        "{\"kind\":\"rewrite_followup\",\"summary\":\"Rewrite\",\"question\":\"Apply?\"}",
        "```",
      ].join("\n"),
      visibility: "visible",
      originTurnId: "turn-1",
    });

    expect(result.parsed.suggestion?.summary).toBe("Rewrite");
    expect(result.artifacts.map((artifact) => artifact.kind)).toEqual(["obsidian-suggest"]);
    expect(onRoute).toHaveBeenCalledWith(expect.objectContaining({
      tabId: "tab-1",
      messageId: "assistant-1",
      visibility: "visible",
      originTurnId: "turn-1",
      artifacts: [expect.objectContaining({ kind: "obsidian-suggest" })],
    }));
  });
});
