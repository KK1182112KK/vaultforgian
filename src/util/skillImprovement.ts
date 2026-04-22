import type { InstalledSkillDefinition } from "./skillCatalog";
import type { SkillFeedbackRecord, SkillImprovementProposal } from "../model/types";
import { buildUnifiedDiff } from "./unifiedDiff";
import { hashPatchContent } from "./patchConflicts";

const LEARNED_SECTION_HEADING = "## Learned execution refinements";
const LEARNED_SECTION_START = "<!-- panel-studio-learned:start -->";
const LEARNED_SECTION_END = "<!-- panel-studio-learned:end -->";

export interface SkillImprovementInput {
  skill: InstalledSkillDefinition;
  currentContent: string;
  feedback: SkillFeedbackRecord;
}

const PROCEDURE_BULLET_PATTERNS: Array<[string, RegExp]> = [
  ["When rewriting study notes, organize the explanation as an explicit step-by-step sequence before adding supporting detail.", /\b(step[- ]by[- ]step|walk me through|順番|手順)\b/i],
  ["Prefer concise bullet groups when the user asks for a clearer note structure.", /\b(bullet|bullets|list|箇条書き)\b/i],
  ["Name at least one likely confusion or pitfall when clarifying dense study material.", /\b(pitfall|mistake|confus(?:e|ion)|誤解|落とし穴)\b/i],
  ["Separate source claims from interpretation when shaping paper-reading notes.", /\b(claim|claims|interpretation|paper|authors?)\b/i],
  ["Keep mathematical notation in canonical LaTeX blocks when normalizing technical notes.", /\b(formula|equation|latex)\b|\$\$/i],
  ["Resolve the target note first and keep the final edit aligned with the requested scope.", /\b(rewrite|edit|apply|note)\b/i],
];

function unique(values: Iterable<string>): string[] {
  return [...new Set([...values].map((entry) => entry.trim()).filter(Boolean))];
}

function collectProcedureBullets(feedback: SkillFeedbackRecord): string[] {
  const haystack = [
    feedback.prompt,
    feedback.summary,
    feedback.appliedChangeSummary ?? "",
    feedback.conversationSummary ?? "",
  ].join("\n");
  const bullets = PROCEDURE_BULLET_PATTERNS.flatMap(([bullet, pattern]) => (pattern.test(haystack) ? [bullet] : []));
  return unique(bullets);
}

function readExistingManagedBullets(content: string): string[] {
  const managedMatch = content.match(
    new RegExp(`${LEARNED_SECTION_START}[\\s\\S]*?\\n([\\s\\S]*?)\\n${LEARNED_SECTION_END}`, "m"),
  );
  if (!managedMatch?.[1]) {
    return [];
  }
  return unique(
    managedMatch[1]
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).trim()),
  );
}

function buildManagedSection(bullets: readonly string[]): string {
  return [
    LEARNED_SECTION_HEADING,
    LEARNED_SECTION_START,
    ...bullets.map((bullet) => `- ${bullet}`),
    LEARNED_SECTION_END,
  ].join("\n");
}

function updateManagedSection(currentContent: string, bullets: readonly string[]): string {
  const nextSection = buildManagedSection(bullets);
  const managedPattern = new RegExp(
    `${LEARNED_SECTION_HEADING}\\n${LEARNED_SECTION_START}[\\s\\S]*?\\n${LEARNED_SECTION_END}`,
    "m",
  );
  if (managedPattern.test(currentContent)) {
    return currentContent.replace(managedPattern, nextSection).replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  }
  const trimmed = currentContent.trimEnd();
  const separator = trimmed.length > 0 ? "\n\n" : "";
  return `${trimmed}${separator}${nextSection}\n`;
}

function buildFeedbackSummary(feedback: SkillFeedbackRecord, bullets: readonly string[]): string {
  const lines = [
    `Based on the approved edit for ${feedback.targetNotePath ?? "the target note"}, refine ${feedback.summary ? "the skill procedure" : "this skill"}.`,
    feedback.summary ? `Observed outcome: ${feedback.summary}` : null,
    feedback.attributionReason ? `Attribution: ${feedback.attributionReason}` : null,
    bullets.length > 0 ? `Proposed learned refinements: ${bullets.join(" ")}` : null,
  ].filter((entry): entry is string => Boolean(entry));
  return lines.join("\n");
}

export function buildSkillImprovementProposal(input: SkillImprovementInput): SkillImprovementProposal | null {
  const newBullets = collectProcedureBullets(input.feedback);
  if (newBullets.length === 0) {
    return null;
  }
  const mergedBullets = unique([...readExistingManagedBullets(input.currentContent), ...newBullets]);
  const nextContent = updateManagedSection(input.currentContent, mergedBullets);
  if (nextContent === input.currentContent) {
    return null;
  }
  return {
    skillName: input.skill.name,
    skillPath: input.skill.path,
    baseContent: input.currentContent,
    baseContentHash: hashPatchContent(input.currentContent),
    nextContent,
    feedbackSummary: buildFeedbackSummary(input.feedback, newBullets),
    attribution: input.feedback,
  };
}

export function buildSkillImprovementDiff(proposal: SkillImprovementProposal): string {
  return buildUnifiedDiff(proposal.skillPath, proposal.baseContent, proposal.nextContent);
}
