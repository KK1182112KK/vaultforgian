import { describe, expect, it } from "vitest";
import {
  extractPromptMetadata,
  formatPlanModePrompt,
  normalizePromptInput,
} from "../app/promptPipeline";

describe("prompt pipeline helpers", () => {
  it("falls back to selection and attachment prompts only when the draft is empty", () => {
    expect(
      normalizePromptInput("", {
        hasSelection: true,
        attachmentCount: 1,
        selectionPrompt: "selection",
        attachmentPrompt: "attachment",
        selectionAndAttachmentPrompt: "both",
      }),
    ).toBe("both");

    expect(
      normalizePromptInput("", {
        hasSelection: true,
        attachmentCount: 0,
        selectionPrompt: "selection",
        attachmentPrompt: "attachment",
        selectionAndAttachmentPrompt: "both",
      }),
    ).toBe("selection");

    expect(
      normalizePromptInput("  explain this  ", {
        hasSelection: true,
        attachmentCount: 1,
        selectionPrompt: "selection",
        attachmentPrompt: "attachment",
        selectionAndAttachmentPrompt: "both",
      }),
    ).toBe("explain this");
  });

  it("extracts typed mentions without stripping plain hashtags", () => {
    const metadata = extractPromptMetadata(
      "Review this #Focus @note(Notes/A.md) with @skill(lecture-read) and @recipe(/recipe-signals)",
    );
    expect(metadata.cleanedPrompt).toBe("Review this #Focus with and");
    expect(metadata.mentions).toEqual([
      { kind: "note", value: "Notes/A.md" },
      { kind: "skill", value: "lecture-read" },
      { kind: "recipe", value: "/recipe-signals" },
    ]);
  });

  it("captures raw source-bundle path literals as external directory hints", () => {
    const metadata = extractPromptMetadata(
      "Use \\\\wsl.localhost\\Ubuntu\\home\\kenshin\\active\\research\\nonlinear-artstein\\paper\\8 as the source bundle",
    );

    expect(metadata.cleanedPrompt).toContain("\\\\wsl.localhost\\Ubuntu\\home\\kenshin\\active\\research\\nonlinear-artstein\\paper\\8");
    expect(metadata.mentions).toContainEqual({
      kind: "external_dir",
      value: "\\\\wsl.localhost\\Ubuntu\\home\\kenshin\\active\\research\\nonlinear-artstein\\paper\\8",
    });
  });

  it("sanitizes conflicting source-bundle and note path directives before prompt assembly", () => {
    const metadata = extractPromptMetadata(
      "Open @note(Kotari2026_exact-predictor-jets_study-guide.md) and use \\\\wsl.localhost\\Ubuntu\\home\\kenshin\\active\\research\\nonlinear-artstein\\paper\\8 as the source bundle",
    );

    expect(metadata.mentions).toContainEqual({
      kind: "note",
      value: "Kotari2026_exact-predictor-jets_study-guide.md",
    });
    expect(metadata.mentions).toContainEqual({
      kind: "external_dir",
      value: "\\\\wsl.localhost\\Ubuntu\\home\\kenshin\\active\\research\\nonlinear-artstein\\paper\\8",
    });
    expect(metadata.cleanedPrompt).toContain("\\\\wsl.localhost\\Ubuntu\\home\\kenshin\\active\\research\\nonlinear-artstein\\paper\\8");
    expect(metadata.executionPrompt).not.toContain("\\\\wsl.localhost\\Ubuntu\\home\\kenshin\\active\\research\\nonlinear-artstein\\paper\\8");
    expect(metadata.executionPrompt).toContain("[external source path attached separately]");
  });

  it("leaves plan-mode prompts unchanged without auto-prepending grill-me", () => {
    expect(formatPlanModePrompt("Refine this", ["grill-me"])).toBe("Refine this");
    expect(formatPlanModePrompt("$grill-me\n\nRefine this", ["grill-me"])).toBe("$grill-me\n\nRefine this");
    expect(formatPlanModePrompt("Refine this", [])).toBe("Refine this");
  });
});
