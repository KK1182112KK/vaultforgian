import { describe, expect, it } from "vitest";
import { quoteForBash, splitCommandString, toWslPath, usesWsl } from "../util/command";

describe("command utils", () => {
  it("splits quoted command strings", () => {
    expect(splitCommandString('wsl.exe -e "codex beta" --flag')).toEqual([
      "wsl.exe",
      "-e",
      "codex beta",
      "--flag",
    ]);
  });

  it("detects WSL launchers", () => {
    expect(usesWsl(["wsl.exe", "-e", "codex"])).toBe(true);
    expect(usesWsl(["codex"])).toBe(false);
  });

  it("converts Windows paths for WSL Codex", () => {
    expect(toWslPath("C:\\Obsidian\\My brain sync", ["wsl.exe", "-e", "codex"])).toBe(
      "/mnt/c/Obsidian/My brain sync",
    );
  });

  it("quotes bash strings safely", () => {
    expect(quoteForBash("a'b")).toBe("'a'\\''b'");
  });

  it("preserves Windows executable paths", () => {
    expect(splitCommandString("C:\\Users\\KK118\\.codex\\.sandbox-bin\\codex.exe")).toEqual([
      "C:\\Users\\KK118\\.codex\\.sandbox-bin\\codex.exe",
    ]);
  });
});
