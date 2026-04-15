import { describe, expect, it } from "vitest";
import { isWindowsUncPath, isWslPathLike, normalizeRuntimePath, quoteForBash, splitCommandString, toWslPath, usesWsl } from "../util/command";

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

  it("normalizes WSL UNC paths into Linux paths", () => {
    expect(normalizeRuntimePath("\\\\wsl.localhost\\Ubuntu\\home\\tester\\paper\\8")).toBe("/home/tester/paper/8");
    expect(normalizeRuntimePath("\\\\wsl$\\Ubuntu\\home\\tester\\paper\\8")).toBe("/home/tester/paper/8");
    expect(toWslPath("\\\\wsl.localhost\\Ubuntu\\home\\tester\\paper\\8", ["wsl.exe", "-e", "codex"])).toBe(
      "/home/tester/paper/8",
    );
  });

  it("detects WSL-like source paths", () => {
    expect(isWslPathLike("\\\\wsl.localhost\\Ubuntu\\home\\tester\\paper\\8")).toBe(true);
    expect(isWslPathLike("/home/tester/paper/8")).toBe(true);
    expect(isWslPathLike("~/paper/8")).toBe(true);
    expect(isWslPathLike("C:\\Users\\TestUser\\paper\\8")).toBe(false);
  });

  it("detects Windows UNC paths", () => {
    expect(isWindowsUncPath("\\\\wsl.localhost\\Ubuntu\\home\\tester\\paper\\8")).toBe(true);
    expect(isWindowsUncPath("\\\\server\\share\\folder")).toBe(true);
    expect(isWindowsUncPath("C:\\Users\\TestUser\\paper\\8")).toBe(false);
  });

  it("quotes bash strings safely", () => {
    expect(quoteForBash("a'b")).toBe("'a'\\''b'");
  });

  it("preserves Windows executable paths", () => {
    expect(splitCommandString("C:\\Users\\TestUser\\.codex\\.sandbox-bin\\codex.exe")).toEqual([
      "C:\\Users\\TestUser\\.codex\\.sandbox-bin\\codex.exe",
    ]);
  });
});
