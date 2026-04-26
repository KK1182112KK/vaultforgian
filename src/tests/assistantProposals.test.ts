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
    expect(parsed.hasProposalMarkers).toBe(true);
    expect(parsed.hasMalformedProposal).toBe(false);
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

  it("extracts and hides obsidian-plan ready blocks", () => {
    const parsed = extractAssistantProposals(
      [
        "Plan is ready.",
        "",
        "```obsidian-plan",
        JSON.stringify({
          status: "ready_to_implement",
          summary: "Update the renderer and add tests.",
        }),
        "```",
      ].join("\n"),
    );

    expect(parsed.displayText).toBe("Plan is ready.");
    expect(parsed.plan).toEqual({
      status: "ready_to_implement",
      summary: "Update the renderer and add tests.",
    });
  });

  it("extracts and hides obsidian-suggest rewrite-followup blocks", () => {
    const parsed = extractAssistantProposals(
      [
        "Here is the explanation.",
        "",
        "Want me to reflect this in the note?",
        "",
        "```obsidian-suggest",
        JSON.stringify({
          kind: "rewrite_followup",
          summary: "Turn the explanation into a formatting-focused note patch.",
          question: "Want me to reflect this in the note?",
        }),
        "```",
      ].join("\n"),
    );

    expect(parsed.displayText).toBe("Here is the explanation.\n\nWant me to reflect this in the note?");
    expect(parsed.suggestion).toEqual({
      kind: "rewrite_followup",
      summary: "Turn the explanation into a formatting-focused note patch.",
      question: "Want me to reflect this in the note?",
    });
  });

  it("extracts and hides obsidian-study-checkpoint blocks", () => {
    const parsed = extractAssistantProposals(
      [
        "Fourier transforms let you study a signal by frequency content.",
        "",
        "Quick check: what changes when you move from time domain to frequency domain?",
        "",
        "```obsidian-study-checkpoint",
        JSON.stringify({
          workflow: "lecture",
          mastered: ["Fourier transforms decompose signals into frequencies."],
          unclear: ["How phase differs from magnitude in the transform output."],
          next_step: "Contrast one signal in time domain and frequency domain.",
          confidence_note: "The learner can explain the headline idea but not the interpretation details yet.",
        }),
        "```",
      ].join("\n"),
    );

    expect(parsed.displayText).toBe(
      "Fourier transforms let you study a signal by frequency content.\n\nQuick check: what changes when you move from time domain to frequency domain?",
    );
    expect(parsed.studyCheckpoint).toEqual({
      workflow: "lecture",
      mastered: ["Fourier transforms decompose signals into frequencies."],
      unclear: ["How phase differs from magnitude in the transform output."],
      nextStep: "Contrast one signal in time domain and frequency domain.",
      confidenceNote: "The learner can explain the headline idea but not the interpretation details yet.",
    });
  });

  it("extracts and hides obsidian-diagram blocks", () => {
    const parsed = extractAssistantProposals(
      [
        "Generated a circuit diagram.",
        "",
        "```obsidian-diagram",
        JSON.stringify({
          title: "Average Load Power",
          alt: "A source feeding a load resistor with the RMS relation highlighted.",
          caption: "Average power uses the RMS value across the load.",
          targetPath: "notes/power.md",
          insertMode: "auto",
          svg: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect x="40" y="40" width="560" height="280" fill="white" stroke="black"/></svg>',
        }),
        "```",
      ].join("\n"),
    );

    expect(parsed.displayText).toBe("Generated a circuit diagram.");
    expect(parsed.diagrams).toEqual([
      expect.objectContaining({
        title: "Average Load Power",
        alt: "A source feeding a load resistor with the RMS relation highlighted.",
        caption: "Average power uses the RMS value across the load.",
        targetPath: "notes/power.md",
        insertMode: "auto",
        svg: expect.stringContaining("<svg"),
      }),
    ]);
  });

  it.each([
    ["obsidian-ops", { ops: [{ kind: "rename", path: "" }] }, "ops"],
    ["obsidian-plan", { status: "drafting" }, "plan"],
    ["obsidian-suggest", { kind: "unknown" }, "suggestion"],
    ["obsidian-study-checkpoint", { workflow: "lecture", mastered: "not an array" }, "studyCheckpoint"],
    ["obsidian-diagram", { title: "Missing SVG", alt: "No SVG", insertMode: "auto" }, "diagrams"],
  ] as const)("marks invalid %s blocks as malformed", (blockType, payload, resultKey) => {
    const parsed = extractAssistantProposals(
      [
        "Visible answer.",
        "",
        `\`\`\`${blockType}`,
        JSON.stringify(payload),
        "```",
      ].join("\n"),
    );

    expect(parsed.displayText).toBe("Visible answer.");
    expect(parsed.hasProposalMarkers).toBe(true);
    expect(parsed.hasMalformedProposal).toBe(true);
    if (resultKey === "ops") {
      expect(parsed.ops).toHaveLength(0);
    } else if (resultKey === "diagrams") {
      expect(parsed.diagrams).toHaveLength(0);
    } else {
      expect(parsed[resultKey]).toBeNull();
    }
  });

  it("hides malformed trailing proposal fragments from display text", () => {
    const text = [
      "I cleaned up the formulas and review section.",
      "",
      '"path": "Notes/Test.md",',
      '"replacement": "Updated body"',
      "}",
    ].join("\n");

    const parsed = extractAssistantProposals(text);

    expect(parsed.displayText).toBe("I cleaned up the formulas and review section.");
    expect(parsed.sanitizedDisplayText).toBe("I cleaned up the formulas and review section.");
    expect(parsed.hasProposalMarkers).toBe(true);
    expect(parsed.hasMalformedProposal).toBe(true);
    expect(parsed.patches).toHaveLength(0);
  });

  it("parses a delimiter-format obsidian-patch with math and multi-line replacement", () => {
    const text = [
      "Here is the cleanup.",
      "",
      "```obsidian-patch",
      "path: Notes/Paper.md",
      "kind: update",
      "summary: Convert ASCII math to LaTeX in Core Equations",
      "",
      "---anchorBefore",
      "## Core Equations",
      "The key inequality is",
      "---anchorAfter",
      "Follows from Theorem 5.",
      "---replacement",
      "## Core Equations",
      "",
      "The key inequality is",
      "$$\\|e(t)\\|^2 \\leq C\\|e(0)\\|^2 e^{-\\alpha t}$$",
      "",
      "Follows from Theorem 5.",
      "---end",
      "```",
    ].join("\n");

    const parsed = extractAssistantProposals(text);

    expect(parsed.displayText).toBe("Here is the cleanup.");
    expect(parsed.hasMalformedProposal).toBe(false);
    expect(parsed.patches).toHaveLength(1);
    const patch = parsed.patches[0];
    expect(patch.targetPath).toBe("Notes/Paper.md");
    expect(patch.kind).toBe("update");
    expect(patch.summary).toBe("Convert ASCII math to LaTeX in Core Equations");
    expect(patch.anchors).toHaveLength(1);
    const anchor = patch.anchors![0];
    expect(anchor.anchorBefore).toBe("## Core Equations\nThe key inequality is");
    expect(anchor.anchorAfter).toBe("Follows from Theorem 5.");
    expect(anchor.replacement).toContain("$$\\|e(t)\\|^2 \\leq C\\|e(0)\\|^2 e^{-\\alpha t}$$");
    expect(anchor.replacement.startsWith("## Core Equations\n\nThe key inequality is\n")).toBe(true);
    expect(anchor.replacement.endsWith("\nFollows from Theorem 5.")).toBe(true);
  });

  it("parses delimiter evidence header lines for a patch", () => {
    const parsed = extractAssistantProposals(
      [
        "```obsidian-patch",
        "path: Notes/Signals.md",
        "kind: update",
        "summary: Tighten notation",
        "evidence: vault_note|Lecture 15|Courses/Lecture 15.md|Faraday law is introduced in integral form.",
        "evidence: web|NIST reference|https://www.nist.gov/|Notation reference used to normalize symbols.",
        "---content",
        "# Signals",
        "---end",
        "```",
      ].join("\n"),
    );

    expect(parsed.patches[0]?.evidence).toEqual([
      {
        kind: "vault_note",
        label: "Lecture 15",
        sourceRef: "Courses/Lecture 15.md",
        snippet: "Faraday law is introduced in integral form.",
      },
      {
        kind: "web",
        label: "NIST reference",
        sourceRef: "https://www.nist.gov/",
        snippet: "Notation reference used to normalize symbols.",
      },
    ]);
  });

  it("parses patch operation headers as patch intent", () => {
    const parsed = extractAssistantProposals(
      [
        "```obsidian-patch",
        "path: Notes/Appendix.md",
        "kind: update",
        "operation: augment",
        "summary: Add a supporting derivation",
        "---anchorBefore",
        "## Dissipation",
        "---anchorAfter",
        "",
        "---replacement",
        "",
        "Additional derivation.",
        "---end",
        "```",
      ].join("\n"),
    );

    expect(parsed.patches[0]?.intent).toBe("augment");
  });

  it("parses JSON patch operation aliases as patch intent", () => {
    const parsed = extractAssistantProposals(
      [
        "```obsidian-patch",
        JSON.stringify({
          path: "Notes/Whole.md",
          kind: "update",
          operation: "full-replace",
          content: "# Rewritten",
        }),
        "```",
      ].join("\n"),
    );

    expect(parsed.patches[0]?.intent).toBe("full_replace");
  });

  it("parses multi-anchor delimiter patches", () => {
    const text = [
      "```obsidian-patch",
      "path: Notes/Multi.md",
      "kind: update",
      "summary: Two regions",
      "---anchorBefore",
      "region one start",
      "---anchorAfter",
      "region one end",
      "---replacement",
      "REPLACED ONE",
      "---end",
      "---anchorBefore",
      "region two start",
      "---anchorAfter",
      "region two end",
      "---replacement",
      "REPLACED TWO",
      "---end",
      "```",
    ].join("\n");

    const parsed = extractAssistantProposals(text);

    expect(parsed.patches).toHaveLength(1);
    expect(parsed.patches[0].anchors).toHaveLength(2);
    expect(parsed.patches[0].anchors![0].replacement).toBe("REPLACED ONE");
    expect(parsed.patches[0].anchors![1].replacement).toBe("REPLACED TWO");
  });

  it("parses delimiter create patches with content body", () => {
    const text = [
      "```obsidian-patch",
      "path: Notes/New.md",
      "kind: create",
      "summary: Create new note",
      "---content",
      "# New Note",
      "",
      "Body with $$math$$ and \"quotes\".",
      "---end",
      "```",
    ].join("\n");

    const parsed = extractAssistantProposals(text);

    expect(parsed.patches).toHaveLength(1);
    const patch = parsed.patches[0];
    expect(patch.kind).toBe("create");
    expect(patch.targetPath).toBe("Notes/New.md");
    expect(patch.proposedText).toBe('# New Note\n\nBody with $$math$$ and "quotes".');
    expect(patch.anchors).toBeUndefined();
  });

  it("tolerates missing trailing ---end at EOF", () => {
    const text = [
      "```obsidian-patch",
      "path: Notes/NoEnd.md",
      "kind: update",
      "---anchorBefore",
      "before text",
      "---anchorAfter",
      "after text",
      "---replacement",
      "replaced text",
      "```",
    ].join("\n");

    const parsed = extractAssistantProposals(text);

    expect(parsed.patches).toHaveLength(1);
    expect(parsed.patches[0].anchors![0].replacement).toBe("replaced text");
  });

  it("falls back to delimiter parser when JSON parse fails but body is delimiter-shaped", () => {
    const text = [
      "```obsidian-patch",
      "path: Notes/Fallback.md",
      "kind: update",
      "summary: fallback",
      "---anchorBefore",
      "x",
      "---anchorAfter",
      "y",
      "---replacement",
      "z",
      "---end",
      "```",
    ].join("\n");

    const parsed = extractAssistantProposals(text);

    expect(parsed.hasMalformedProposal).toBe(false);
    expect(parsed.patches).toHaveLength(1);
  });

  it("flags invalid fenced proposal blocks as malformed", () => {
    const text = [
      "I prepared the patch.",
      "",
      "```obsidian-patch",
      '{"path":"Notes/Test.md","replacement":"missing closing brace"',
      "```",
    ].join("\n");

    const parsed = extractAssistantProposals(text);

    expect(parsed.displayText).toBe("I prepared the patch.");
    expect(parsed.hasProposalMarkers).toBe(true);
    expect(parsed.hasMalformedProposal).toBe(true);
    expect(parsed.patches).toHaveLength(0);
  });
});
