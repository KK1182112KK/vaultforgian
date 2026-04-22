import { homedir } from "node:os";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { expandHomePath, getDefaultWslBridgeSkillRoots, normalizeConfiguredSkillRoots } from "../util/skillRoots";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "obsidian-codex-skill-roots-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("skill root helpers", () => {
  it("expands home-relative paths and removes duplicates", () => {
    expect(
      normalizeConfiguredSkillRoots([
        "~/skills",
        " /tmp/custom-skills ",
        "~/skills",
        "",
      ]),
    ).toEqual([`${homedir()}/skills`, "/tmp/custom-skills"]);
  });

  it("leaves absolute paths unchanged", () => {
    expect(expandHomePath("/var/tmp/skills")).toBe("/var/tmp/skills");
  });

  it("adds WSL bridge skill roots on Windows only", () => {
    expect(getDefaultWslBridgeSkillRoots("win32")).toEqual([
      "\\\\wsl.localhost\\Ubuntu\\home\\kenshin\\.codex\\skills",
      "\\\\wsl.localhost\\Ubuntu\\home\\kenshin\\.agents\\skills",
      "\\\\wsl$\\Ubuntu\\home\\kenshin\\.codex\\skills",
      "\\\\wsl$\\Ubuntu\\home\\kenshin\\.agents\\skills",
    ]);
    expect(getDefaultWslBridgeSkillRoots("linux")).toEqual([]);
  });

  it("rejects extra roots outside the allowed local roots", async () => {
    const allowedRoot = await makeTempDir();
    const outsideRoot = await makeTempDir();
    await mkdir(join(allowedRoot, "safe-skills"));
    await mkdir(join(outsideRoot, "outside-skills"));

    expect(
      normalizeConfiguredSkillRoots(
        [
          join(allowedRoot, "safe-skills"),
          join(outsideRoot, "outside-skills"),
          "relative/skills",
        ],
        { allowedRoots: [allowedRoot] },
      ),
    ).toEqual([join(allowedRoot, "safe-skills")]);
  });

  it("rejects symlinked extra roots that escape the allowed root", async () => {
    const allowedRoot = await makeTempDir();
    const outsideRoot = await makeTempDir();
    const escapedTarget = join(outsideRoot, "escaped-skills");
    const symlinkPath = join(allowedRoot, "link-out");
    await mkdir(escapedTarget, { recursive: true });
    await symlink(escapedTarget, symlinkPath, process.platform === "win32" ? "junction" : "dir");

    expect(
      normalizeConfiguredSkillRoots([symlinkPath], { allowedRoots: [allowedRoot] }),
    ).toEqual([]);
  });
});
