import { describe, expect, it } from "vitest";
import { applyComposerSuggestion, matchComposerSuggestions, type ComposerSuggestion } from "../util/composerSuggestions";
import type { InstalledSkillDefinition } from "../util/skillCatalog";
import type { SlashCommandDefinition } from "../util/slashCommandCatalog";

const slashCommands: SlashCommandDefinition[] = [
  { command: "/note", label: "Current note", description: "Attach the current note" },
  { command: "/COMMIT", label: "COMMIT", description: "Custom Codex prompt" },
  { command: "/grill-me", label: "grill-me", description: "Skill alias", source: "skill_alias", mode: "skill_alias" },
];

const skills: InstalledSkillDefinition[] = [
  { name: "frontend-skill", description: "Design strong frontend UIs", path: "/tmp/frontend/SKILL.md" },
  { name: "openai-docs", description: "Use official OpenAI docs", path: "/tmp/openai-docs/SKILL.md" },
];

const mentions: ComposerSuggestion[] = [
  {
    kind: "mention",
    token: "@note(Notes/AI.md)",
    label: "AI",
    description: "Notes/AI.md",
  },
  {
    kind: "mention",
    token: "@set(Control Lectures)",
    label: "Control Lectures",
    description: "Smart Set",
  },
];

describe("composer suggestions", () => {
  it("matches slash commands from the current command token", () => {
    expect(matchComposerSuggestions("/", 1, slashCommands, skills).map((entry) => entry.token)).toEqual([
      "/note",
      "/COMMIT",
      "/grill-me",
    ]);
    expect(matchComposerSuggestions("/co", 3, slashCommands, skills).map((entry) => entry.token)).toEqual(["/COMMIT"]);
    expect(matchComposerSuggestions("/gr", 3, slashCommands, skills).map((entry) => entry.token)).toEqual(["/grill-me"]);
    expect(matchComposerSuggestions("/COMMIT do it", 13, slashCommands, skills)).toEqual([]);
  });

  it("matches skill references near the cursor", () => {
    expect(matchComposerSuggestions("use $fron", 9, slashCommands, skills).map((entry) => entry.token)).toEqual(["$frontend-skill"]);
  });

  it("matches mention references near the cursor", () => {
    expect(matchComposerSuggestions("look at @no", 11, slashCommands, skills, mentions).map((entry) => entry.token)).toEqual([
      "@note(Notes/AI.md)",
    ]);
  });

  it("applies slash and skill suggestions into the textarea value", () => {
    const slashSuggestion: ComposerSuggestion = {
      kind: "slash",
      token: "/COMMIT",
      label: "COMMIT",
      description: "Custom Codex prompt",
    };
    const skillSuggestion: ComposerSuggestion = {
      kind: "skill",
      token: "$frontend-skill",
      label: "frontend-skill",
      description: "Design strong frontend UIs",
    };
    const mentionSuggestion: ComposerSuggestion = mentions[0]!;

    expect(applyComposerSuggestion("/co", 3, slashSuggestion)).toEqual({
      value: "/COMMIT ",
      cursor: 8,
    });
    expect(applyComposerSuggestion("use $fron", 9, skillSuggestion)).toEqual({
      value: "use $frontend-skill ",
      cursor: 20,
    });
    expect(applyComposerSuggestion("look at @no", 11, mentionSuggestion)).toEqual({
      value: "look at @note(Notes/AI.md) ",
      cursor: 27,
    });
  });
});
