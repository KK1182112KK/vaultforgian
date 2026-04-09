import { describe, expect, it } from "vitest";
import { extractAssistantProposals, stripAssistantProposalBlocks } from "../util/assistantProposals";

describe("assistant proposal parsing", () => {
  it("extracts patch and ops blocks and strips them from display text", () => {
    const text = [
      "I found two concrete changes.",
      "",
      "```obsidian-patch",
      JSON.stringify({
        patches: [
          {
            path: "Notes/Target.md",
            summary: "Tighten the note body",
            content: "# Updated\n\nBody",
          },
        ],
      }),
      "```",
      "",
      "```obsidian-ops",
      JSON.stringify({
        ops: [
          {
            kind: "rename",
            path: "Notes/Target.md",
            destinationPath: "Notes/Renamed.md",
            summary: "Rename the note",
          },
        ],
      }),
      "```",
    ].join("\n");

    const parsed = extractAssistantProposals(text);

    expect(parsed.displayText).toBe("I found two concrete changes.");
    expect(parsed.patches).toEqual([
      expect.objectContaining({
        targetPath: "Notes/Target.md",
        summary: "Tighten the note body",
        proposedText: "# Updated\n\nBody",
      }),
    ]);
    expect(parsed.ops).toEqual([
      expect.objectContaining({
        kind: "rename",
        targetPath: "Notes/Target.md",
        destinationPath: "Notes/Renamed.md",
      }),
    ]);
    expect(stripAssistantProposalBlocks(text)).toBe("I found two concrete changes.");
  });

  it("normalizes common op aliases", () => {
    const parsed = extractAssistantProposals(
      [
        "```obsidian-ops",
        JSON.stringify({
          ops: [
            {
              kind: "property:set",
              file: "Notes/Target.md",
              key: "status",
              value: "done",
            },
            {
              kind: "task",
              path: "Notes/Tasks.md",
              text: "Ship it",
              checked: true,
            },
          ],
        }),
        "```",
      ].join("\n"),
    );

    expect(parsed.ops).toEqual([
      expect.objectContaining({
        kind: "property_set",
        targetPath: "Notes/Target.md",
        propertyKey: "status",
        propertyValue: "done",
      }),
      expect.objectContaining({
        kind: "task_update",
        targetPath: "Notes/Tasks.md",
        taskText: "Ship it",
        checked: true,
      }),
    ]);
  });
});
