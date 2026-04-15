import { describe, expect, it } from "vitest";
import { isUnsafeCodexExecutablePath, migrateLegacyCodexLauncher } from "../util/codexLauncher";

describe("codex launcher migration", () => {
  it("blocks legacy shell launchers and quarantines the original value", () => {
    const migrated = migrateLegacyCodexLauncher("bash -lc codex");

    expect(migrated.runtime).toBe("native");
    expect(migrated.executablePath).toBe("codex");
    expect(migrated.blockedLegacyCommand).toBe("bash -lc codex");
  });

  it("accepts a direct WSL executable launcher", () => {
    const migrated = migrateLegacyCodexLauncher("wsl.exe -e codex");

    expect(migrated.runtime).toBe("wsl");
    expect(migrated.executablePath).toBe("codex");
    expect(migrated.blockedLegacyCommand).toBeNull();
  });

  it("treats shell-oriented executable paths as unsafe", () => {
    expect(isUnsafeCodexExecutablePath("cmd /c codex")).toBe(true);
    expect(isUnsafeCodexExecutablePath("powershell -Command codex")).toBe(true);
    expect(isUnsafeCodexExecutablePath("codex.exe")).toBe(false);
  });
});
