import { describe, expect, it } from "vitest";
import {
  CALLOUT_MATH_COLLISION_SAMPLE,
  CALLOUT_MATH_HEALED_SAMPLE,
  CALLOUT_MATH_MIXED_CONTEXT_SAMPLE,
  CALLOUT_MATH_SAMPLE,
} from "./fixtures/calloutMathFixture";
import { assessPatchReadability } from "../util/patchReadability";

describe("patchReadability", () => {
  it("auto-heals quoted standalone dollar display-math blocks into quoted double-dollar blocks", () => {
    const result = assessPatchReadability(CALLOUT_MATH_SAMPLE);

    expect(result.qualityState).toBe("auto_healed");
    expect(result.healedByPlugin).toBe(true);
    expect(result.text).toBe(CALLOUT_MATH_HEALED_SAMPLE);
  });

  it("keeps quoted callout math that already uses canonical $$ delimiters clean", () => {
    const result = assessPatchReadability(CALLOUT_MATH_HEALED_SAMPLE);

    expect(result.qualityState).toBe("clean");
    expect(result.text).toBe(CALLOUT_MATH_HEALED_SAMPLE);
    expect(result.qualityIssues).toEqual([]);
  });

  it("keeps quoted delimiter collisions review-required instead of auto-healing them", () => {
    const result = assessPatchReadability(CALLOUT_MATH_COLLISION_SAMPLE);

    expect(result.qualityState).toBe("review_required");
    expect(result.healedByPlugin).toBe(true);
    expect(result.qualityIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "math_delimiter_marker_collision",
          line: 4,
        }),
      ]),
    );
  });

  it("flags mixed quoted and plain display-math delimiters as review-required", () => {
    const result = assessPatchReadability(CALLOUT_MATH_MIXED_CONTEXT_SAMPLE);

    expect(result.qualityState).toBe("review_required");
    expect(result.qualityIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "mixed_display_math_context",
        }),
      ]),
    );
  });

  it("keeps unmatched display math review-required", () => {
    const result = assessPatchReadability(
      [
        "Before",
        "$",
        "I = \\frac{1}{2} I_{\\text{REF}}",
        "After",
      ].join("\n"),
    );

    expect(result.qualityState).toBe("review_required");
    expect(result.qualityIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "display_math_single_dollar" }),
        expect.objectContaining({ code: "unmatched_display_math" }),
      ]),
    );
  });

  it("leaves valid inline math and one-line display math untouched", () => {
    const source = [
      "Inline $x+y$ stays inline.",
      "",
      "$$x^2 + y^2 = z^2$$",
    ].join("\n");

    const result = assessPatchReadability(source);

    expect(result.qualityState).toBe("clean");
    expect(result.text).toBe(source);
    expect(result.qualityIssues).toEqual([]);
  });

  it("flags same-line duplicate Markdown headings as review-required", () => {
    const result = assessPatchReadability(
      [
        "# Pythagorean Theorem",
        "",
        "## Core Idea## Core Idea",
        "### Nested Idea## Nested Idea",
        "",
        "Simple Example: 3-4-5## Simple Example: 3-4-5",
      ].join("\n"),
    );

    expect(result.qualityState).toBe("review_required");
    expect(result.qualityIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "duplicate_heading_fragment",
          line: 3,
        }),
        expect.objectContaining({
          code: "duplicate_heading_fragment",
          line: 4,
        }),
        expect.objectContaining({
          code: "duplicate_heading_fragment",
          line: 6,
        }),
      ]),
    );
  });
});
