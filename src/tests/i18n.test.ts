import { describe, expect, it } from "vitest";
import {
  getLocalizedCopy,
  normalizeSupportedLocale,
  normalizeUiLanguageSetting,
  resolveUiLocale,
} from "../util/i18n";

describe("i18n helpers", () => {
  it("normalizes supported locales and ui language settings", () => {
    expect(normalizeSupportedLocale("ja-JP")).toBe("ja");
    expect(normalizeSupportedLocale("en-US")).toBe("en");
    expect(normalizeSupportedLocale(undefined)).toBe("en");

    expect(normalizeUiLanguageSetting("app")).toBe("app");
    expect(normalizeUiLanguageSetting("ja")).toBe("ja");
    expect(normalizeUiLanguageSetting("en")).toBe("en");
    expect(normalizeUiLanguageSetting("fr")).toBeNull();
  });

  it("resolves app-following ui language with fallback to english", () => {
    expect(resolveUiLocale("app", "ja-JP")).toBe("ja");
    expect(resolveUiLocale("app", "fr-FR")).toBe("en");
    expect(resolveUiLocale("en", "ja-JP")).toBe("en");
  });

  it("returns localized copy tables", () => {
    expect(getLocalizedCopy("en").commands.openWorkspace).toBe("Open VaultForgian workspace");
    expect(getLocalizedCopy("ja").commands.openWorkspace).toBe("VaultForgian ワークスペースを開く");
    expect(getLocalizedCopy("en").workspace.ingestHubTitle).toBe("Panel Studio");
    expect(getLocalizedCopy("ja").workspace.ingestHubSubtitle).toContain("編集ハブ");
    expect(getLocalizedCopy("ja").workspace.panelPromptPlaceholder).toContain("講義");
    expect(getLocalizedCopy("en").service.patchApplied("notes/source.md")).toBe("Applied: notes/source.md.");
  });
});
