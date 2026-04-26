import { describe, expect, it } from "vitest";
import {
  clampMaxChatTabs,
  combineSettings,
  extractLocalSettings,
  extractVaultSettings,
  normalizeLocalSettings,
  parseEnvironmentEntries,
} from "../util/pluginSettings";
import { DEFAULT_LOCAL_SETTINGS, DEFAULT_SETTINGS, DEFAULT_VAULT_SETTINGS } from "../model/types";

describe("pluginSettings helpers", () => {
  it("splits combined settings into vault and local shapes and recombines without aliasing arrays", () => {
    const combined = {
      ...DEFAULT_SETTINGS,
      preferredName: "Kenshin",
      excludedTags: ["private", "draft"],
      vimMappings: ["map j scrollDown"],
      extraSkillRoots: ["/vault/skills"],
      mcpServers: [
        {
          id: "github",
          name: "GitHub",
          transport: "stdio" as const,
          command: "codex-github",
          args: ["serve"],
          env: ["TOKEN=abc"],
          enabled: true,
        },
      ],
      customEnv: ["OPENAI_API_KEY=test"],
      securityPolicy: {
        ...DEFAULT_LOCAL_SETTINGS.securityPolicy,
        commandBlacklistEnabled: true,
        allowedExportPaths: ["/tmp/export"],
      },
    };

    const vaultSettings = extractVaultSettings(combined);
    const localSettings = extractLocalSettings(combined);
    const roundTrip = combineSettings(vaultSettings, localSettings);

    expect(vaultSettings).toMatchObject({
      preferredName: "Kenshin",
      excludedTags: ["private", "draft"],
      vimMappings: ["map j scrollDown"],
    });
    expect(localSettings).toMatchObject({
      extraSkillRoots: ["/vault/skills"],
      customEnv: ["OPENAI_API_KEY=test"],
      mcpServers: [
        expect.objectContaining({
          id: "github",
          command: "codex-github",
        }),
      ],
      securityPolicy: expect.objectContaining({
        commandBlacklistEnabled: true,
        allowedExportPaths: ["/tmp/export"],
      }),
    });
    expect(roundTrip).toEqual(combined);

    expect(roundTrip.excludedTags).not.toBe(combined.excludedTags);
    expect(roundTrip.vimMappings).not.toBe(combined.vimMappings);
    expect(roundTrip.extraSkillRoots).not.toBe(combined.extraSkillRoots);
    expect(roundTrip.customEnv).not.toBe(combined.customEnv);
    expect(roundTrip.securityPolicy.allowedExportPaths).not.toBe(combined.securityPolicy.allowedExportPaths);
  });

  it("normalizes local settings and rejects invalid values", () => {
    const normalized = normalizeLocalSettings(
      {
        mcpServers: [
          { id: "one", name: " One ", command: " codex-one ", args: [" serve "], env: [" TOKEN=1 "], enabled: true },
          { id: "one", name: "Duplicate", command: "ignored" },
          { id: "", name: "", command: "missing-name" },
          { id: "blank-command", name: "Blank Command", command: "   ", enabled: true },
        ],
        pluginOverrides: [{ key: " skill-a ", enabled: false }, { key: " skill-a ", enabled: true }],
        customEnv: [" export FOO=1 ", "FOO=1", "BAD ENTRY"],
      } as never,
      { allowedRoots: ["/allowed"] },
    );

    expect(normalized.extraSkillRoots).toEqual([]);
    expect(normalized.mcpServers).toEqual([
      {
        id: "one",
        name: "One",
        transport: "stdio",
        command: "codex-one",
        args: ["serve"],
        env: ["TOKEN=1"],
        enabled: true,
      },
      {
        id: "blank-command",
        name: "Blank Command",
        transport: "stdio",
        command: "",
        args: [],
        env: [],
        enabled: false,
      },
    ]);
    expect(normalized.pluginOverrides).toEqual([{ key: "skill-a", enabled: false }]);
    expect(normalized.customEnv).toEqual(["export FOO=1", "FOO=1", "BAD ENTRY"]);
  });

  it("parses environment entries and clamps the chat tab limit", () => {
    expect(
      parseEnvironmentEntries([
        "OPENAI_API_KEY=test",
        " export LANG=en_US.UTF-8 ",
        "INVALID",
        "1BAD=value",
      ]),
    ).toEqual({
      OPENAI_API_KEY: "test",
      LANG: "en_US.UTF-8",
    });

    expect(clampMaxChatTabs(2)).toBe(3);
    expect(clampMaxChatTabs(99)).toBe(10);
    expect(clampMaxChatTabs(Number.NaN)).toBe(DEFAULT_VAULT_SETTINGS.maxChatTabs);
  });
});
