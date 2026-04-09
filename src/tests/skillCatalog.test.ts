import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { loadInstalledSkillCatalog } from "../util/skillCatalog";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "obsidian-codex-skills-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("skill catalog", () => {
  it("loads skills recursively including dot-directories", async () => {
    const root = await makeTempDir();
    await mkdir(join(root, ".system", "openai-docs"), { recursive: true });
    await mkdir(join(root, "frontend-skill"), { recursive: true });
    await writeFile(join(root, ".system", "openai-docs", "SKILL.md"), "# OpenAI Docs\n\nUse official docs.\n", "utf8");
    await writeFile(join(root, "frontend-skill", "SKILL.md"), "# Frontend\n\nBuild strong UIs.\n", "utf8");

    const catalog = await loadInstalledSkillCatalog([root]);
    expect(catalog.map((entry) => entry.name)).toEqual(["frontend-skill", "openai-docs"]);
    expect(catalog[1]?.description).toBe("Use official docs.");
  });
});
