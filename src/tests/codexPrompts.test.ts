import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { expandCodexPrompt, loadCodexPromptCatalog, resolveCodexPromptCommand } from "../util/codexPrompts";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "obsidian-codex-prompts-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("codex prompt catalog", () => {
  it("loads custom prompts with metadata and aliases", async () => {
    const root = await makeTempDir();
    await mkdir(join(root, "speckit"), { recursive: true });
    await writeFile(
      join(root, "commit.md"),
      ["name: COMMIT", "description: Build a commit message", "", "Write a commit for:", "", "$ARGUMENTS"].join("\n"),
      "utf8",
    );
    await writeFile(join(root, "speckit", "specify.md"), "Create a spec.\n", "utf8");

    const catalog = await loadCodexPromptCatalog([root]);
    expect(catalog.map((entry) => entry.command)).toEqual(["/COMMIT", "/specify"]);
    expect(catalog[0]?.aliases).toEqual(["/prompts:commit"]);
    expect(catalog[1]?.aliases).toEqual(["/prompts:speckit.specify"]);
    expect(catalog[0]?.description).toBe("Build a commit message");
  });

  it("resolves and expands prompt arguments", async () => {
    const root = await makeTempDir();
    await writeFile(
      join(root, "review.md"),
      ["description: Review the changes", "", "Review this work carefully.", "Focus:", "$1", "Notes:", "$ARGUMENTS"].join("\n"),
      "utf8",
    );

    const catalog = await loadCodexPromptCatalog([root]);
    const prompt = resolveCodexPromptCommand("/prompts:review", catalog);
    expect(prompt?.command).toBe("/review");
    expect(expandCodexPrompt(prompt!, "tests only")).toContain("Focus:\ntests");
    expect(expandCodexPrompt(prompt!, "tests only")).toContain("Notes:\ntests only");
  });
});
