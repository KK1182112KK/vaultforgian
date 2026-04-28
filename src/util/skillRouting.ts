export interface SkillReference {
  raw: string;
  name: string;
}

const SKILL_PATTERN = /(^|[\s(])\$([A-Za-z][A-Za-z0-9:_-]{1,})(?![A-Za-z0-9:_-]|\$)/g;

export function extractSkillReferences(input: string): SkillReference[] {
  const references: SkillReference[] = [];
  const seen = new Set<string>();

  for (const match of input.matchAll(SKILL_PATTERN)) {
    const name = match[2]?.trim();
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    references.push({
      raw: `$${name}`,
      name,
    });
  }

  return references;
}

export function hasExplicitSkillRequest(input: string): boolean {
  return extractSkillReferences(input).length > 0;
}
