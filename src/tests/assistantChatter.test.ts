import { describe, expect, it } from "vitest";
import { sanitizeOperationalAssistantText } from "../util/assistantChatter";

describe("sanitizeOperationalAssistantText", () => {
  it("drops status-only troubleshooting chatter blocks", () => {
    expect(sanitizeOperationalAssistantText("shell 自体の初期化で失敗しています。")).toBeNull();
    expect(sanitizeOperationalAssistantText("このターンでは vault 内のファイルにアクセスできない状態です。")).toBeNull();
    expect(sanitizeOperationalAssistantText("bash: line 1: codex: command not found")).toBeNull();
    expect(sanitizeOperationalAssistantText("対象ノートの現状を確認して、構成の弱い箇所を洗い出します。")).toBeNull();
    expect(sanitizeOperationalAssistantText("現時点ではまだ Kotari2026_exact-predictor-jets_study-guide.md を読めていません。")).toBeNull();
  });

  it("preserves later substantive analysis after stripping leading troubleshooting chatter", () => {
    const text = sanitizeOperationalAssistantText([
      "source bundle として受け取りました。起動条件を変えて再試行します。",
      "The predictor defect closes quadratically once the history mismatch is bounded by E_t.",
    ].join("\n\n"));

    expect(text).toBe("The predictor defect closes quadratically once the history mismatch is bounded by E_t.");
  });

  it("keeps substantive note analysis that is not operational chatter", () => {
    const text = sanitizeOperationalAssistantText("This note is hard to follow because the theorem map appears too late.");
    expect(text).toBe("This note is hard to follow because the theorem map appears too late.");
  });
});
