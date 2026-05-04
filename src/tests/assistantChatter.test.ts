import { describe, expect, it } from "vitest";
import {
  isInternalRewriteFollowupPrompt,
  normalizeVisibleUserPromptText,
  sanitizeOperationalAssistantText,
} from "../util/assistantChatter";
import {
  isTrailingNoteReflectionInvitationText,
  stripTrailingNoteReflectionInvitation,
} from "../util/noteReflectionGuards";

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

  it("drops leaked conversation-start and skill-guide process chatter", () => {
    expect(
      sanitizeOperationalAssistantText(
        "\u4f1a\u8a71\u306e\u958b\u59cb\u30eb\u30fc\u30eb\u3060\u3051\u78ba\u8a8d\u3057\u3066\u304b\u3089\u8fd4\u3057\u307e\u3059\u3002\u95a2\u9023\u3059\u308b\u30b9\u30ad\u30eb\u30ac\u30a4\u30c9\u3092\u77ed\u304f\u898b\u3066\u3001\u5fc5\u8981\u306a\u3089\u305d\u306e\u7bc4\u56f2\u3067\u9032\u3081\u307e\u3059\u3002",
      ),
    ).toBeNull();

    expect(
      sanitizeOperationalAssistantText(
        [
          "I will check the conversation start rules and related skill guides first.",
          "",
          "\u3053\u3093\u306b\u3061\u306f\u3002\u4f55\u3092\u624b\u4f1d\u3044\u307e\u3057\u3087\u3046\u304b\uff1f",
        ].join("\n"),
      ),
    ).toBe("\u3053\u3093\u306b\u3061\u306f\u3002\u4f55\u3092\u624b\u4f1d\u3044\u307e\u3057\u3087\u3046\u304b\uff1f");
  });

  it("drops leaked superpowers startup narration while preserving the actual reply", () => {
    expect(
      sanitizeOperationalAssistantText(
        [
          "superpowers:using-superpowers applies here because it is defined to run at conversation start. I\u2019m loading only that skill\u2019s instructions, then I\u2019ll answer directly.",
          "",
          "\u3053\u3093\u306b\u3061\u306f\u3002\u4eca\u65e5\u306f\u4f55\u3092\u898b\u307e\u3059\u304b\uff1f",
        ].join("\n"),
      ),
    ).toBe("\u3053\u3093\u306b\u3061\u306f\u3002\u4eca\u65e5\u306f\u4f55\u3092\u898b\u307e\u3059\u304b\uff1f");
  });

  it("keeps direct answers about superpowers skills", () => {
    expect(sanitizeOperationalAssistantText("superpowers:using-superpowers is a startup skill that loads shared workflow guidance.")).toBe(
      "superpowers:using-superpowers is a startup skill that loads shared workflow guidance.",
    );
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

describe("note reflection invitation guard", () => {
  it("strips note rewrite/apply invitations but preserves neutral skill checkpoints", () => {
    expect(isTrailingNoteReflectionInvitationText("Want me to rewrite this note now?")).toBe(true);
    expect(isTrailingNoteReflectionInvitationText("This step is complete. Continue to the next study step?")).toBe(false);
    expect(isTrailingNoteReflectionInvitationText("ここまでで一段落です。次に進みますか？")).toBe(false);

    expect(
      stripTrailingNoteReflectionInvitation(
        ["Summary body.", "", "Want me to apply this to the note now?"].join("\n"),
      ),
    ).toBe("Summary body.");
    expect(
      stripTrailingNoteReflectionInvitation(
        ["Summary body.", "", "This step is complete. Continue to the next study step?"].join("\n"),
      ),
    ).toBe(["Summary body.", "", "This step is complete. Continue to the next study step?"].join("\n"));
    expect(
      stripTrailingNoteReflectionInvitation(["要約本文。", "", "ここまでで一段落です。次に進みますか？"].join("\n")),
    ).toBe(["要約本文。", "", "ここまでで一段落です。次に進みますか？"].join("\n"));
  });
});
