import { describe, expect, it } from "vitest";
import { classifyAgenticTurnIntent, normalizePatchIntent } from "../util/agenticTurnPolicy";

describe("agentic turn policy", () => {
  it.each([
    ["補足して", "augment"],
    ["このノートに追記して", "augment"],
    ["Add this as a supporting note.", "augment"],
  ] as const)("classifies additive note requests as augment: %s", (prompt, expected) => {
    expect(classifyAgenticTurnIntent(prompt)).toBe(expected);
  });

  it.each([
    ["この段落を置き換えて", "replace"],
    ["この section を差し替えて", "replace"],
    ["Replace the current paragraph.", "replace"],
  ] as const)("classifies local replacement requests as replace: %s", (prompt, expected) => {
    expect(classifyAgenticTurnIntent(prompt)).toBe(expected);
  });

  it.each([
    ["この行を削除して", "delete"],
    ["その説明を消して", "delete"],
    ["Delete the duplicate paragraph.", "delete"],
  ] as const)("classifies explicit deletion requests as delete: %s", (prompt, expected) => {
    expect(classifyAgenticTurnIntent(prompt)).toBe(expected);
  });

  it.each([
    ["ノート全体を書き換えて", "full_replace"],
    ["全文を置き換えて", "full_replace"],
    ["Rewrite the entire note.", "full_replace"],
  ] as const)("classifies explicit whole-note rewrites as full_replace: %s", (prompt, expected) => {
    expect(classifyAgenticTurnIntent(prompt)).toBe(expected);
  });

  it("defaults non-edit questions to answer", () => {
    expect(classifyAgenticTurnIntent("この式の意味を説明して")).toBe("answer");
  });

  it("normalizes patch operation aliases", () => {
    expect(normalizePatchIntent("append")).toBe("augment");
    expect(normalizePatchIntent("full-replace")).toBe("full_replace");
    expect(normalizePatchIntent("remove")).toBe("delete");
  });
});
