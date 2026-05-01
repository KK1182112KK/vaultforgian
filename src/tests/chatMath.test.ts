import { describe, expect, it } from "vitest";
import {
  formatChatMathFallback,
  normalizeAssistantMathForMarkdown,
  prepareChatMarkdownForMathRender,
  splitChatMathSegments,
} from "../util/chatMath";

describe("chat math normalization", () => {
  it("wraps raw equation bullets in markdown math delimiters", () => {
    const text = normalizeAssistantMathForMarkdown(
      [
        "Close.",
        "",
        "- 6^2 + 8^2 = 36 + 64 = 100",
        "- That means c^2 = 100",
        "- So c = \\sqrt{100} = 10",
      ].join("\n"),
    );

    expect(text).toContain("- $6^2 + 8^2 = 36 + 64 = 100$");
    expect(text).toContain("- That means $c^2 = 100$");
    expect(text).toContain("- So $c = \\sqrt{100} = 10$");
  });

  it("does not rewrite code fences or already-delimited math", () => {
    const text = normalizeAssistantMathForMarkdown(
      [
        "Already clear: $c^2 = 25$",
        "```text",
        "6^2 + 8^2 = 100",
        "```",
      ].join("\n"),
    );

    expect(text).toContain("Already clear: $c^2 = 25$");
    expect(text).toContain("```text\n6^2 + 8^2 = 100\n```");
  });

  it("splits inline and display math into renderable segments", () => {
    const segments = splitChatMathSegments("Use $a^2 + b^2 = c^2$ and $$c = \\sqrt{100}$$.");

    expect(segments).toEqual([
      { kind: "text", text: "Use " },
      { kind: "math", text: "a^2 + b^2 = c^2", display: false },
      { kind: "text", text: " and " },
      { kind: "math", text: "c = \\sqrt{100}", display: true },
      { kind: "text", text: "." },
    ]);
  });

  it("splits long inline derivations without leaking dollar delimiters", () => {
    const segments = splitChatMathSegments(
      "Correct. $c = \\sqrt{8^2 + 15^2} = \\sqrt{64 + 225} = \\sqrt{289} = 17$ One more.",
    );

    expect(segments).toEqual([
      { kind: "text", text: "Correct. " },
      {
        kind: "math",
        text: "c = \\sqrt{8^2 + 15^2} = \\sqrt{64 + 225} = \\sqrt{289} = 17",
        display: false,
      },
      { kind: "text", text: " One more." },
    ]);
  });

  it("formats math fallback without markdown delimiters", () => {
    expect(formatChatMathFallback("a^2 + b^2 = c^2")).toBe("a² + b² = c²");
    expect(formatChatMathFallback("c = \\sqrt{100}")).toBe("c = √100");
  });

  it("does not treat ordinary money or plain numbers as renderable chat math", () => {
    expect(splitChatMathSegments("Price is $5 and the answer is $3$.")).toEqual([
      { kind: "text", text: "Price is $5 and the answer is $3$." },
    ]);
  });

  it("replaces chat math with placeholders before markdown rendering", () => {
    const prepared = prepareChatMarkdownForMathRender(
      ["The answer is $a^2 + b^2 = c^2$.", "", "```text", "$c^2$ stays code", "```", "", "Price is $5."].join("\n"),
    );

    expect(prepared.markdown).not.toContain("$a^2");
    expect(prepared.markdown).toContain(prepared.placeholders[0]?.token);
    expect(prepared.markdown).toContain("obsidian-codex__chat-math-placeholder");
    expect(prepared.markdown).toContain("data-codex-chat-math-token");
    expect(prepared.placeholders[0]?.token).toMatch(/^NFCODEXCHATMATH[a-z0-9]+X0TOKEN$/iu);
    expect(prepared.markdown).toContain("$c^2$ stays code");
    expect(prepared.markdown).toContain("Price is $5.");
    expect(prepared.placeholders).toEqual([
      expect.objectContaining({
        text: "a^2 + b^2 = c^2",
        display: false,
      }),
    ]);
  });

  it("keeps literal placeholder-like text scoped away from generated math tokens", () => {
    const prepared = prepareChatMarkdownForMathRender(
      [
        "Literal old token NOTEFORGECHATMATH0TOKEN stays text.",
        "Literal new token NFCODEXCHATMATHmanualX0TOKEN stays text.",
        "Actual math is $a^2 + b^2 = c^2$.",
      ].join("\n"),
    );

    const generatedToken = prepared.placeholders[0]?.token;
    expect(generatedToken).toBeDefined();
    expect(generatedToken).not.toBe("NOTEFORGECHATMATH0TOKEN");
    expect(generatedToken).not.toBe("NFCODEXCHATMATHmanualX0TOKEN");
    expect(prepared.markdown).toContain("NOTEFORGECHATMATH0TOKEN stays text");
    expect(prepared.markdown).toContain("NFCODEXCHATMATHmanualX0TOKEN stays text");
    expect(prepared.markdown).toContain(generatedToken);
  });
});
