import { describe, expect, it } from "vitest";
import { buildVaultNoteSourcePackText } from "../util/sourceAcquisition";

describe("buildVaultNoteSourcePackText", () => {
  it("includes frontmatter summary and headings for attached notes", () => {
    const text = buildVaultNoteSourcePackText(
      [
        {
          path: "papers/2026/example.md",
          role: "Target note",
          content: [
            "---",
            'type: "study-guide"',
            'topic: "Exact Predictor Jets"',
            "---",
            "# Start Here",
            "",
            "Body paragraph.",
            "",
            "## Next",
            "More details.",
          ].join("\n"),
        },
      ],
      { locale: "en" },
    );

    expect(text).toContain("Vault note source pack:");
    expect(text).toContain("Target note: papers/2026/example.md");
    expect(text).toContain("Coverage: full note body");
    expect(text).toContain("Frontmatter summary:");
    expect(text).toContain("- type: \"study-guide\"");
    expect(text).toContain("- topic: \"Exact Predictor Jets\"");
    expect(text).toContain("Outline:");
    expect(text).toContain("- # Start Here");
    expect(text).toContain("- ## Next");
  });

  it("uses a larger default budget for single-note source packs", () => {
    const content = `# Heading\n\n${"A".repeat(50_000)}\n\n## Tail\nVisible ending.`;
    const text = buildVaultNoteSourcePackText(
      [
        {
          path: "papers/2026/large.md",
          role: "Target note",
          content,
        },
      ],
      { locale: "en" },
    );

    expect(text).toContain("Visible ending.");
    expect(text).not.toContain("...[truncated for note source pack]");
  });

  it("annotates coverage when a note source pack must still be truncated", () => {
    const content = [
      "# Start Here",
      "",
      "Opening explanation.",
      "",
      "## Section A",
      "A".repeat(170_000),
      "",
      "## Tail",
      "Hidden ending.",
    ].join("\n");
    const text = buildVaultNoteSourcePackText(
      [
        {
          path: "papers/2026/huge.md",
          role: "Target note",
          content,
        },
      ],
      { locale: "en" },
    );

    expect(text).toContain("Coverage: excerpted note sections within 160000 chars of");
    expect(text).toContain("...[truncated for note source pack]");
    expect(text).toContain("Hidden ending.");
  });

  it("prioritizes sections that match prompt terms", () => {
    const content = [
      "# Start Here",
      "",
      "Opening explanation.",
      "",
      "## Background",
      "A".repeat(110_000),
      "",
      "## Section 5",
      "Important theorem bridge.",
      "",
      "## Tail",
      "Review ending.",
    ].join("\n");
    const text = buildVaultNoteSourcePackText(
      [
        {
          path: "papers/2026/prioritized.md",
          role: "Target note",
          content,
        },
      ],
      { locale: "en", priorityTerms: ["section", "theorem"] },
    );

    expect(text).toContain("## Section 5");
    expect(text).toContain("Important theorem bridge.");
  });
});
