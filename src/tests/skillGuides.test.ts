import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { buildRequestedSkillGuideText, resolveRequestedSkillDefinitions } from "../util/skillGuides";
import type { InstalledSkillDefinition } from "../util/skillCatalog";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createSkill(rootName: string, description: string, body: string): Promise<InstalledSkillDefinition> {
  const root = await mkdtemp(join(tmpdir(), "obsidian-codex-study-skill-guide-"));
  tempRoots.push(root);
  const skillDir = join(root, rootName);
  await mkdir(skillDir, { recursive: true });
  const path = join(skillDir, "SKILL.md");
  await writeFile(path, body, "utf8");
  return {
    name: rootName,
    description,
    path,
  };
}

describe("skill guides", () => {
  it("builds requested skill guides in order without duplicates", async () => {
    const deepRead = await createSkill("deep-read", "Read papers deeply.", "# Deep Read\nUse this skill.");
    const deepResearch = await createSkill("deep-research", "Research deeply.", "# Deep Research\nUse this too.");

    const text = await buildRequestedSkillGuideText(
      ["$deep-read", "deep-research", "deep-read"],
      [deepRead, deepResearch],
    );

    expect(text).toContain("Requested skill guides:");
    expect(text).toContain("Skill guide: $deep-read");
    expect(text).toContain("Skill guide: $deep-research");
    expect(text).toContain("# Deep Read\nUse this skill.");
    expect(text).toContain("# Deep Research\nUse this too.");
    expect(text?.indexOf("Skill guide: $deep-read")).toBeLessThan(text?.indexOf("Skill guide: $deep-research") ?? 0);
    expect(text?.match(/Skill guide: \$deep-read/g)).toHaveLength(1);
  });

  it("skips missing and unreadable guides while keeping readable ones", async () => {
    const deepRead = await createSkill("deep-read", "Read papers deeply.", "# Deep Read\nUse this skill.");
    const unreadable: InstalledSkillDefinition = {
      name: "deep-research",
      description: "Research deeply.",
      path: join(tempRoots[0] ?? tmpdir(), "missing", "SKILL.md"),
    };

    const guide = await buildRequestedSkillGuideText(
      ["deep-research", "deep-read", "missing-skill"],
      [unreadable, deepRead],
    );

    expect(guide).toContain("Skill guide: $deep-read");
    expect(guide).not.toContain("Skill guide: $deep-research");
    expect(guide).not.toContain("missing-skill");
  });

  it("does not try to load unrelated installed skills", async () => {
    const deepRead = await createSkill("deep-read", "Read papers deeply.", "# Deep Read\nUse this skill.");
    const unrelatedMissing: InstalledSkillDefinition = {
      name: "unused-skill",
      description: "Should not be loaded.",
      path: join(tempRoots[0] ?? tmpdir(), "unused-skill", "SKILL.md"),
    };

    const guide = await buildRequestedSkillGuideText(["deep-read"], [unrelatedMissing, deepRead]);

    expect(guide).toContain("Skill guide: $deep-read");
    expect(guide).not.toContain("unused-skill");
  });

  it("uses the first installed definition when duplicate skill names exist", async () => {
    const preferred = await createSkill("deep-read", "Read papers deeply.", "# Deep Read\nPreferred guide.");
    const duplicate = await createSkill("deep-read", "Read papers deeply.", "# Deep Read\nDuplicate guide.");

    const guide = await buildRequestedSkillGuideText(["deep-read"], [preferred, duplicate]);

    expect(guide).toContain("Preferred guide.");
    expect(guide).not.toContain("Duplicate guide.");
  });

  it("returns null when no readable requested skill guides are found", async () => {
    const guide = await buildRequestedSkillGuideText(["missing-skill", "$also-missing"], []);
    expect(guide).toBeNull();
  });

  it("hydrates requested skill definitions once when the current catalog is cold", async () => {
    const panelSkill = await createSkill("panel-test-skill", "Panel-only skill.", "# Panel Test Skill\nUse this guide.");
    let refreshCalls = 0;

    const definitions = await resolveRequestedSkillDefinitions(["panel-test-skill"], [], {
      refreshInstalledSkills: async () => {
        refreshCalls += 1;
        return [panelSkill];
      },
    });

    expect(definitions).toEqual([panelSkill]);
    expect(refreshCalls).toBe(1);
  });

  it("replaces paper-study ingestion skills with runtime contracts when attachment text is already present", async () => {
    const deepRead = await createSkill("deep-read", "Read papers deeply.", "# Deep Read\nOriginal ingest steps.");
    const builder = await createSkill(
      "study-material-builder",
      "Build study materials.",
      "# Study Material Builder\nInspect the source bundle.",
    );

    const guide = await buildRequestedSkillGuideText(["deep-read", "study-material-builder"], [deepRead, builder], {
      paperStudyAttachmentTurn: true,
    });

    expect(guide).toContain("Skill guide: $deep-read");
    expect(guide).toContain("Runtime-resolved contract for this turn:");
    expect(guide).toContain("Do not normalize paths, copy the PDF, call shell tools");
    expect(guide).toContain("Replace Workflow 1 source-bundle inspection");
    expect(guide).not.toContain("Original ingest steps.");
    expect(guide).not.toContain("Inspect the source bundle.");
  });

  it("emits runtime fallback contracts for known paper-study skills when the catalog is unavailable", async () => {
    const guide = await buildRequestedSkillGuideText(["deep-read", "study-material-builder", "deep-research"], [], {
      paperStudyAttachmentTurn: true,
    });

    expect(guide).toContain("Skill guide: $deep-read");
    expect(guide).toContain("Path: (runtime-resolved attachment contract)");
    expect(guide).toContain("Do not normalize paths, copy the PDF, call shell tools");
    expect(guide).toContain("Skill guide: $study-material-builder");
    expect(guide).toContain("Replace Workflow 1 source-bundle inspection");
    expect(guide).toContain("Skill guide: $deep-research");
    expect(guide).toContain("Use the attached source package as the primary evidence bundle");
  });
});
