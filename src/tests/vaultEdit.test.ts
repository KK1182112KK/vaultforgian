import { describe, expect, it } from "vitest";
import { allowsVaultWrite } from "../util/vaultEdit";

describe("allowsVaultWrite", () => {
  it.each([
    "Improve this note.",
    "Translate this note into Japanese.",
    "Reformat this note.",
    "Expand this note with examples.",
    "Clean up this note.",
    "Summarize this into the note.",
  ])("accepts common edit phrasing: %s", (prompt) => {
    expect(allowsVaultWrite(prompt)).toBe(true);
  });

  it.each([
    "Summarize this note.",
    "Explain this lecture.",
    "Teach me how this proof works.",
  ])("does not over-trigger on explanation-only phrasing: %s", (prompt) => {
    expect(allowsVaultWrite(prompt)).toBe(false);
  });
});
