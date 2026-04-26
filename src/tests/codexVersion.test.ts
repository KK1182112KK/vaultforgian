import { describe, expect, it } from "vitest";
import {
  compareCodexVersions,
  extractModelCacheClientVersion,
  isCodexUpgradeRequiredError,
  isModelRuntimeCompatible,
  parseCodexCliVersion,
} from "../util/codexVersion";

describe("codex version helpers", () => {
  it("parses and compares Codex CLI versions", () => {
    expect(parseCodexCliVersion("codex-cli 0.119.0-alpha.28\n")).toBe("0.119.0-alpha.28");
    expect(parseCodexCliVersion("codex-cli 0.125.0\n")).toBe("0.125.0");
    expect(compareCodexVersions("0.119.0-alpha.28", "0.125.0")).toBeLessThan(0);
    expect(compareCodexVersions("0.125.0", "0.125.0-alpha.3")).toBeGreaterThan(0);
  });

  it("extracts the model cache client version", () => {
    expect(extractModelCacheClientVersion(JSON.stringify({ client_version: "0.125.0", models: [] }))).toBe("0.125.0");
    expect(extractModelCacheClientVersion("{not json")).toBeNull();
  });

  it("detects stale runtimes for GPT-5.5", () => {
    expect(
      isModelRuntimeCompatible("gpt-5.5", {
        cliVersion: "0.119.0-alpha.28",
        modelCacheClientVersion: "0.125.0",
      }),
    ).toBe(false);
    expect(
      isModelRuntimeCompatible("gpt-5.4", {
        cliVersion: "0.119.0-alpha.28",
        modelCacheClientVersion: "0.125.0",
      }),
    ).toBe(true);
    expect(
      isModelRuntimeCompatible("gpt-5.5", {
        cliVersion: "0.125.0",
        modelCacheClientVersion: "0.125.0",
      }),
    ).toBe(true);
    expect(
      isModelRuntimeCompatible("gpt-5.5", {
        cliVersion: "0.123.0",
        modelCacheClientVersion: null,
      }),
    ).toBe(false);
  });

  it("detects upgrade-required model errors", () => {
    expect(isCodexUpgradeRequiredError("The 'gpt-5.5' model requires a newer version of Codex.")).toBe(true);
    expect(isCodexUpgradeRequiredError("ordinary runtime failure")).toBe(false);
  });
});
