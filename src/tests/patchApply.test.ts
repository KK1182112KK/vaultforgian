import { describe, expect, it } from "vitest";
import { applyAnchorReplacements, normalizeForComparison } from "../util/patchApply";

describe("applyAnchorReplacements", () => {
  it("inserts between unique before/after anchors without mutating them", () => {
    const base = "# Heading\n\nIntro paragraph.\n\n## Section\n\nBody text.\n";
    const result = applyAnchorReplacements(base, [
      {
        anchorBefore: "Intro paragraph.\n\n",
        anchorAfter: "## Section",
        replacement: "New paragraph between intro and section.\n\n",
      },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toContain("Intro paragraph.\n\nNew paragraph between intro and section.\n\n## Section");
    }
  });

  it("appends after an anchor when only anchorBefore is provided", () => {
    const base = "# Title\n\nFirst line.\nSecond line.\n";
    const result = applyAnchorReplacements(base, [
      {
        anchorBefore: "First line.\n",
        anchorAfter: "",
        replacement: "Inserted line.\n",
      },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe("# Title\n\nFirst line.\nInserted line.\nSecond line.\n");
    }
  });

  it("reports anchor_not_found when the anchor is absent", () => {
    const result = applyAnchorReplacements("hello world", [
      { anchorBefore: "missing", anchorAfter: "", replacement: "x" },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.reason).toBe("anchor_not_found");
    }
  });

  it("reports anchor_ambiguous when the anchor appears more than once", () => {
    const base = "alpha beta alpha gamma alpha";
    const result = applyAnchorReplacements(base, [
      { anchorBefore: "alpha", anchorAfter: "", replacement: "x" },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.reason).toBe("anchor_ambiguous");
    }
  });

  it("normalizes CRLF in base text to LF", () => {
    const base = "line1\r\nline2\r\nline3\r\n";
    const result = applyAnchorReplacements(base, [
      { anchorBefore: "line1\n", anchorAfter: "line2", replacement: "INSERTED\n" },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe("line1\nINSERTED\nline2\nline3\n");
    }
  });
});

describe("normalizeForComparison", () => {
  it("collapses CRLF to LF and strips trailing whitespace on each line", () => {
    expect(normalizeForComparison("a\r\nb \nc\t\n")).toBe("a\nb\nc\n");
  });

  it("returns empty string for null/undefined", () => {
    expect(normalizeForComparison(null)).toBe("");
    expect(normalizeForComparison(undefined)).toBe("");
  });
});
