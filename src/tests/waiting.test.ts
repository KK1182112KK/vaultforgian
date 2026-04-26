import { describe, expect, it } from "vitest";
import { pickWaitingCopy } from "../util/waiting";

describe("waiting copy", () => {
  it("uses context-aware safety and readability copy when provided", () => {
    expect(pickWaitingCopy("tools", "normal", 0, { focus: "patch_safety", locale: "en" })).toBe("Checking note safety");
    expect(pickWaitingCopy("tools", "normal", 0, { focus: "readability", locale: "en" })).toBe("Checking Markdown readability");
    expect(pickWaitingCopy("tools", "normal", 0, { focus: "patch_safety", locale: "ja" })).toBe("ノート変更の安全性を確認しています");
  });
});
