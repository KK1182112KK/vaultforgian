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

async function withTempCwd<T>(callback: () => Promise<T>): Promise<T> {
  const dir = await makeTempDir();
  const originalCwd = process.cwd();
  process.chdir(dir);
  try {
    return await callback();
  } finally {
    process.chdir(originalCwd);
  }
}

async function createRelativeDirectoryWithEntries(path: string, entries: readonly string[]): Promise<void> {
  await mkdir(path, { recursive: true });
  await Promise.all(entries.map((entry) => mkdir(join(path, entry), { recursive: true })));
}

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

  it("adds WSL bridge skill roots from discovered UNC home directories on Windows only", async () => {
    const originalUsername = process.env.USERNAME;
    const originalUserProfile = process.env.USERPROFILE;
    process.env.USERNAME = "KK118";
    process.env.USERPROFILE = "C:\\Users\\KK118";
    try {
      await withTempCwd(async () => {
        await createRelativeDirectoryWithEntries("\\\\wsl.localhost", ["Ubuntu"]);
        await createRelativeDirectoryWithEntries("\\\\wsl$", ["Ubuntu"]);
        await createRelativeDirectoryWithEntries("\\\\wsl.localhost\\Ubuntu\\home", ["kenshin"]);
        await createRelativeDirectoryWithEntries("\\\\wsl$\\Ubuntu\\home", ["kenshin"]);

        expect(getDefaultWslBridgeSkillRoots("win32")).toEqual([
          "\\\\wsl.localhost\\Ubuntu\\home\\kenshin\\.codex\\skills",
          "\\\\wsl.localhost\\Ubuntu\\home\\kenshin\\.agents\\skills",
          "\\\\wsl$\\Ubuntu\\home\\kenshin\\.codex\\skills",
          "\\\\wsl$\\Ubuntu\\home\\kenshin\\.agents\\skills",
        ]);
      });
    } finally {
      if (originalUsername === undefined) {
        delete process.env.USERNAME;
      } else {
        process.env.USERNAME = originalUsername;
      }
      if (originalUserProfile === undefined) {
        delete process.env.USERPROFILE;
      } else {
        process.env.USERPROFILE = originalUserProfile;
      }
    }
    expect(getDefaultWslBridgeSkillRoots("linux")).toEqual([]);
  });

  it("falls back to WSL_DISTRO_NAME probes when UNC host enumeration fails", async () => {
    const originalDistro = process.env.WSL_DISTRO_NAME;
    process.env.WSL_DISTRO_NAME = "CustomUbuntu";
    try {
      await withTempCwd(async () => {
        await createRelativeDirectoryWithEntries("\\\\wsl.localhost\\CustomUbuntu\\home", ["kenshin"]);

        expect(getDefaultWslBridgeSkillRoots("win32")).toEqual([
          "\\\\wsl.localhost\\CustomUbuntu\\home\\kenshin\\.codex\\skills",
          "\\\\wsl.localhost\\CustomUbuntu\\home\\kenshin\\.agents\\skills",
        ]);
      });
    } finally {
      if (originalDistro === undefined) {
        delete process.env.WSL_DISTRO_NAME;
      } else {
        process.env.WSL_DISTRO_NAME = originalDistro;
      }
    }
  });

  it("returns no Windows WSL bridge roots when no UNC home directories can be discovered", async () => {
    const originalUsername = process.env.USERNAME;
    const originalUserProfile = process.env.USERPROFILE;
    process.env.USERNAME = "KK118";
    process.env.USERPROFILE = "C:\\Users\\KK118";
    try {
      await withTempCwd(async () => {
        expect(getDefaultWslBridgeSkillRoots("win32")).toEqual([]);
      });
    } finally {
      if (originalUsername === undefined) {
        delete process.env.USERNAME;
      } else {
        process.env.USERNAME = originalUsername;
      }
      if (originalUserProfile === undefined) {
        delete process.env.USERPROFILE;
      } else {
        process.env.USERPROFILE = originalUserProfile;
      }
    }
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
