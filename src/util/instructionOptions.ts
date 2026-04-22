import type { SupportedLocale } from "./i18n";

export const BUILT_IN_INSTRUCTION_OPTIONS = [
  "brief",
  "steps",
  "safe",
  "diff",
  "focus",
  "research",
  "strict",
  "concise",
] as const;

export type BuiltInInstructionOption = (typeof BUILT_IN_INSTRUCTION_OPTIONS)[number];

export interface InstructionOptionDefinition {
  label: BuiltInInstructionOption;
  token: `#${BuiltInInstructionOption}`;
  description: string;
}

const EN_DESCRIPTIONS: Record<BuiltInInstructionOption, string> = {
  brief: "Keep the answer short and centered on the essentials.",
  steps: "Prefer a strategy-first, step-by-step structure.",
  safe: "Be more careful with claims, risk, and uncertainty.",
  diff: "Emphasize changes, deltas, and what is different.",
  focus: "Stay tightly scoped to the main point only.",
  research: "Prioritize evidence, sources, and research framing.",
  strict: "Avoid guessing and keep the answer precise.",
  concise: "Trim repetition and keep the wording compact.",
};

const JA_DESCRIPTIONS: Record<BuiltInInstructionOption, string> = {
  brief: "短く、要点中心で返します。",
  steps: "方針から手順へ、段階的に返します。",
  safe: "断定を抑えて、慎重に返します。",
  diff: "変更点や差分を中心に返します。",
  focus: "重要な論点だけに絞って返します。",
  research: "根拠や調査観点を重視して返します。",
  strict: "推測を抑えて、厳密に返します。",
  concise: "冗長さを減らして、簡潔に返します。",
};

export function getInstructionOptions(locale: SupportedLocale): InstructionOptionDefinition[] {
  const descriptions = locale === "ja" ? JA_DESCRIPTIONS : EN_DESCRIPTIONS;
  return BUILT_IN_INSTRUCTION_OPTIONS.map((label) => ({
    label,
    token: `#${label}`,
    description: descriptions[label],
  }));
}
