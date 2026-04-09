import { describe, expect, it } from "vitest";
import {
  buildSmartSetMirrorMarkdown,
  computeSmartSetDrift,
  executeSmartSetQuery,
  normalizeSmartSetPrompt,
  parseSmartSetQuery,
} from "../util/smartSets";

describe("smart set helpers", () => {
  it("normalizes a natural-language query into a stable JSON DSL", () => {
    const normalized = normalizeSmartSetPrompt("control lectures except archived #class");

    expect(normalized.title).toBe("control lectures except archived #class");
    expect(parseSmartSetQuery(normalized.normalizedQuery)).toEqual({
      includeText: ["control", "lectures"],
      excludeText: ["archived"],
      pathIncludes: [],
      pathExcludes: [],
      tags: ["class"],
      properties: [],
    });
  });

  it("executes a Smart Set query against vault candidates", () => {
    const query = parseSmartSetQuery(
      JSON.stringify({
        includeText: ["control"],
        excludeText: ["archived"],
        pathIncludes: [],
        pathExcludes: [],
        tags: [],
        properties: [],
      }),
    );

    const result = executeSmartSetQuery(query, [
      {
        path: "Courses/Control/Lecture 1.md",
        title: "Lecture 1",
        text: "Control systems introduction",
        tags: [],
        properties: {},
        mtime: 10,
        size: 100,
      },
      {
        path: "Archive/Control.md",
        title: "Archive",
        text: "Archived control note",
        tags: [],
        properties: {},
        mtime: 20,
        size: 200,
      },
    ]);

    expect(result.count).toBe(1);
    expect(result.items[0]?.path).toBe("Courses/Control/Lecture 1.md");
  });

  it("computes added, removed, and changed drift entries", () => {
    const drift = computeSmartSetDrift(
      {
        items: [
          { path: "A.md", title: "A", excerpt: "", mtime: 2, size: 10, score: 1 },
          { path: "B.md", title: "B", excerpt: "", mtime: 1, size: 10, score: 1 },
        ],
        count: 2,
        generatedAt: 2,
      },
      {
        result: {
          items: [
            { path: "A.md", title: "A", excerpt: "", mtime: 1, size: 10, score: 1 },
            { path: "C.md", title: "C", excerpt: "", mtime: 1, size: 10, score: 1 },
          ],
          count: 2,
          generatedAt: 1,
        },
        createdAt: 1,
        reason: "manual",
      },
      3,
    );

    expect(drift?.added.map((item) => item.path)).toEqual(["B.md"]);
    expect(drift?.removed.map((item) => item.path)).toEqual(["C.md"]);
    expect(drift?.changed.map((item) => item.path)).toEqual(["A.md"]);
  });

  it("renders Smart Set mirror markdown with live result and snapshot metadata", () => {
    const markdown = buildSmartSetMirrorMarkdown({
      id: "smart-set-1",
      title: "Control Lectures",
      naturalQuery: "control lectures",
      normalizedQuery: "{\n  \"includeText\": [\"control\"]\n}",
      savedNotePath: "Codex/Smart Sets/control-lectures.md",
      liveResult: {
        items: [{ path: "Courses/Control/Lecture 1.md", title: "Lecture 1", excerpt: "Control", mtime: 1, size: 1, score: 1 }],
        count: 1,
        generatedAt: 1,
      },
      lastSnapshot: null,
      lastDrift: null,
      lastRunAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });

    expect(markdown).toContain("# Control Lectures");
    expect(markdown).toContain("## Normalized Query");
    expect(markdown).toContain("[[Courses/Control/Lecture 1.md]]");
  });
});
