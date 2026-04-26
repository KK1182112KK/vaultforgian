import { describe, expect, it } from "vitest";
import { classifyTurnIntent, resolveNoteSuggestionPolicy } from "../util/turnIntent";

describe("classifyTurnIntent", () => {
  it("classifies greetings as smalltalk without note suggestions", () => {
    const intent = classifyTurnIntent({
      prompt: "\u3053\u3093\u306b\u3061\u306f",
      composeMode: "chat",
      allowVaultWrite: false,
      hasNoteTarget: true,
      hasSelection: false,
      hasNoteSourcePack: false,
      hasAttachmentContent: false,
    });

    expect(intent.kind).toBe("smalltalk");
    expect(resolveNoteSuggestionPolicy(intent)).toBe("never");
  });

  it("classifies note-grounded explanation as eligible for note suggestions", () => {
    const intent = classifyTurnIntent({
      prompt: "Summarize this note",
      composeMode: "chat",
      allowVaultWrite: false,
      hasNoteTarget: true,
      hasSelection: false,
      hasNoteSourcePack: true,
      hasAttachmentContent: false,
    });

    expect(intent.kind).toBe("note_answer");
    expect(resolveNoteSuggestionPolicy(intent)).toBe("eligible");
  });

  it("classifies explicit note changes as note edits", () => {
    const intent = classifyTurnIntent({
      prompt: "Improve this note.",
      composeMode: "chat",
      allowVaultWrite: true,
      hasNoteTarget: true,
      hasSelection: false,
      hasNoteSourcePack: true,
      hasAttachmentContent: false,
    });

    expect(intent.kind).toBe("note_edit");
    expect(resolveNoteSuggestionPolicy(intent)).toBe("eligible");
  });
});
