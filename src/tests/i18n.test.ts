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
    expect(getLocalizedCopy("en").commands.openWorkspace).toBe("Open Study workspace");
    expect(getLocalizedCopy("ja").commands.openWorkspace).toBe("Study ワークスペースを開く");
    expect(getLocalizedCopy("ja").workspace.ingestHubSubtitle).toContain("講義資料");
  });
});
