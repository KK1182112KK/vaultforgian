import { describe, expect, it } from "vitest";
import {
  isInternalRewriteFollowupPrompt,
  normalizeVisibleUserPromptText,
  sanitizeOperationalAssistantText,
} from "../util/assistantChatter";

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

  it("drops future-tense patch promises that do not include an artifact", () => {
    expect(sanitizeOperationalAssistantText("パッチとして返します。次に修正版を返します。")).toBeNull();
    expect(sanitizeOperationalAssistantText("I will return a patch for this note next.")).toBeNull();
  });

  it("keeps substantive text while stripping internal proposal-repair scaffolding", () => {
    const text = sanitizeOperationalAssistantText([
      "Turn your immediately previous assistant answer in this same thread into exactly one obsidian-patch block.",
      "Output exactly one fenced `obsidian-patch` block and nothing else.",
      "Assistant answer to convert:",
      "Here is the previous summary.",
    ].join("\n\n"));

    expect(text).toBe("Here is the previous summary.");
  });

  it("keeps substantive text and obsidian artifacts while stripping leaked proposal-repair scaffolding", () => {
    const text = sanitizeOperationalAssistantText([
      "Turn your immediately previous assistant answer in this same thread into exactly one obsidian-patch block.",
      "Assistant answer to convert:",
      "Clean up the theorem summary.",
      "```obsidian-patch",
      "path: notes/current.md",
      "kind: update",
      "summary: Tighten the theorem summary",
      "",
      "---content",
      "Updated note body.",
      "---end",
      "```",
    ].join("\n"));

    expect(text).toBe([
      "Clean up the theorem summary.",
      "```obsidian-patch",
      "path: notes/current.md",
      "kind: update",
      "summary: Tighten the theorem summary",
      "",
      "---content",
      "Updated note body.",
      "---end",
      "```",
    ].join("\n"));
  });

  it("does not split or strip chatter-looking text inside fenced code blocks", () => {
    const text = sanitizeOperationalAssistantText([
      "shell 自体の初期化で失敗しています。",
      "",
      "```txt",
      "The local read failed because the windows sandbox spawn setup refresh failed.",
      "",
      "I will try a minimal command next.",
      "```",
    ].join("\n"));

    expect(text).toBe([
      "```txt",
      "The local read failed because the windows sandbox spawn setup refresh failed.",
      "",
      "I will try a minimal command next.",
      "```",
    ].join("\n"));
  });

  it("strips legacy rewrite-followup scaffolding while preserving the converted answer", () => {
    const text = sanitizeOperationalAssistantText([
      "Turn your immediately previous assistant answer in this same thread into exactly one obsidian-patch block.",
      "Target the current session target note if one is set; otherwise target the active note for this turn.",
      "If a selection snapshot is attached, limit the rewrite to that selected section or the nearest matching section instead of rewriting the whole note.",
      "Apply the Formatting bundle: normalize LaTeX, clean up headings, clean up bullet structure, and make wording consistent.",
      "Add concise evidence lines to the patch header when possible using `evidence: kind|label|sourceRef|snippet`.",
      "Prefer vault-note and attachment evidence first. If that is insufficient, you may use web research and mark those evidence lines with `kind` = `web` and a source URL.",
      "Do not ask whether to apply the change. Emit the patch now and keep any visible chat summary to at most 2 short sentences.",
      "Assistant answer to convert: This -3.95 V is the input-side form of the earlier v_{O,min} = -4.65 V result.",
    ].join("\n\n"));

    expect(text).toBe("This -3.95 V is the input-side form of the earlier v_{O,min} = -4.65 V result.");
  });

  it("recognizes and replaces the internal rewrite-followup prompt shape", () => {
    const prompt = [
      "Turn your immediately previous assistant answer in this same thread into exactly one obsidian-patch block.",
      "Target resolution order for this rewrite: an explicitly mentioned note or path, then the selection source note, then prefer the active note for this turn, then the current session target note.",
      "If a selection snapshot is attached, limit the rewrite to that selected section or the nearest matching section instead of rewriting the whole note.",
      "Apply the Formatting bundle: normalize LaTeX, clean up headings, clean up bullet structure, and make wording consistent.",
      "Add concise evidence lines to the patch header when possible using `evidence: kind|label|sourceRef|snippet`.",
      "Prefer vault-note and attachment evidence first. If that is insufficient, you may use web research and mark those evidence lines with `kind` = `web` and a source URL.",
      "Do not ask whether to apply the change. Emit the patch now and keep any visible chat summary to at most 2 short sentences.",
      "Assistant answer to convert:",
      "Summarize Step 1 cleanly.",
    ].join("\n\n");

    expect(isInternalRewriteFollowupPrompt(prompt)).toBe(true);
    expect(normalizeVisibleUserPromptText(prompt, "Apply to note")).toBe("Apply to note");
  });

  it("recognizes and replaces the legacy internal rewrite-followup prompt shape", () => {
    const prompt = [
      "Turn your immediately previous assistant answer in this same thread into exactly one obsidian-patch block.",
      "Target the current session target note if one is set; otherwise target the active note for this turn.",
      "If a selection snapshot is attached, limit the rewrite to that selected section or the nearest matching section instead of rewriting the whole note.",
      "Apply the Formatting bundle: normalize LaTeX, clean up headings, clean up bullet structure, and make wording consistent.",
      "Add concise evidence lines to the patch header when possible using `evidence: kind|label|sourceRef|snippet`.",
      "Prefer vault-note and attachment evidence first. If that is insufficient, you may use web research and mark those evidence lines with `kind` = `web` and a source URL.",
      "Do not ask whether to apply the change. Emit the patch now and keep any visible chat summary to at most 2 short sentences.",
      "Assistant answer to convert:",
      "Summarize Step 1 cleanly.",
    ].join("\n\n");

    expect(isInternalRewriteFollowupPrompt(prompt)).toBe(true);
    expect(normalizeVisibleUserPromptText(prompt, "Apply to note")).toBe("Apply to note");
  });
});
