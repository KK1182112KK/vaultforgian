import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { isUserOwnedSkillDefinition, loadInstalledSkillCatalog } from "../util/skillCatalog";

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
    await writeFile(
      join(root, ".system", "openai-docs", "SKILL.md"),
      "---\nname: openai-docs\ndescription: \"Use official docs.\"\n---\n\n# OpenAI Docs\n",
      "utf8",
    );
    await writeFile(join(root, "frontend-skill", "SKILL.md"), "# Frontend\n\nBuild strong UIs.\n", "utf8");

    const catalog = await loadInstalledSkillCatalog([root]);
    expect(catalog.map((entry) => entry.name)).toEqual(["frontend-skill", "openai-docs"]);
    expect(catalog[1]?.description).toBe("Use official docs.");
  });

  it("prefixes cached plugin skills with the plugin name", async () => {
    const root = await makeTempDir();
    const pluginSkillDir = join(root, "openai-curated", "github", "hash123", "skills", "gh-fix-ci");
    await mkdir(pluginSkillDir, { recursive: true });
    await writeFile(
      join(pluginSkillDir, "SKILL.md"),
      "---\nname: gh-fix-ci\ndescription: \"Fix failing GitHub Actions checks.\"\n---\n",
      "utf8",
    );

    const catalog = await loadInstalledSkillCatalog([root]);
    expect(catalog).toEqual([
      expect.objectContaining({
        name: "github:gh-fix-ci",
        description: "Fix failing GitHub Actions checks.",
      }),
    ]);
  });

  it("stops descending once the configured traversal depth is exceeded", async () => {
    const root = await makeTempDir();
    const deepSkillDir = join(root, "a", "b", "c", "d", "e", "depth-skill");
    await mkdir(deepSkillDir, { recursive: true });
    await writeFile(join(deepSkillDir, "SKILL.md"), "# Depth Skill\n\nToo deep.\n", "utf8");

    const catalog = await loadInstalledSkillCatalog([root], { maxDepth: 4 });
    expect(catalog).toEqual([]);
  });

  it("caps discovered skill files in large trees", async () => {
    const root = await makeTempDir();
    for (const name of ["alpha-skill", "beta-skill", "gamma-skill", "omega-skill"]) {
      const skillDir = join(root, name);
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), `# ${name}\n\n${name} description.\n`, "utf8");
    }

    const catalog = await loadInstalledSkillCatalog([root], { maxFiles: 2 });
    expect(catalog).toHaveLength(2);
    expect(catalog.map((entry) => entry.name)).toEqual(["alpha-skill", "beta-skill"]);
  });

  it("treats plugin cache skills as non-user-owned", () => {
    expect(
      isUserOwnedSkillDefinition({
        name: "github:gh-fix-ci",
        description: "Fix failing GitHub Actions checks.",
        path: "/home/tester/.codex/plugins/cache/openai-curated/github/hash123/skills/gh-fix-ci/SKILL.md",
      }),
    ).toBe(false);

    expect(
      isUserOwnedSkillDefinition({
        name: "frontend-skill",
        description: "Design strong frontend UIs",
        path: "/home/tester/.codex/skills/frontend-skill/SKILL.md",
      }),
    ).toBe(true);
  });
});
