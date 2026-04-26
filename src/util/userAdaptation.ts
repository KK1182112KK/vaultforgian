import type { PanelAdaptationOverlay, UserAdaptationMemory, UserAdaptationProfile } from "../model/types";

export interface UserAdaptationUpdateInput {
  prompt: string;
  assistantSummary: string;
  appliedChangeSummary: string;
  appliedContent: string;
  panelId: string | null;
  targetNotePath: string | null;
  selectedSkillNames: readonly string[];
  occurredAt?: number;
}

const EXPLANATION_DEPTH_PATTERNS = {
  step_by_step: /\b(step[- ]by[- ]step|walk me through|break it down|詳しく|丁寧に|順番に)\b/i,
  concise: /\b(concise|brief|short|quick summary|簡潔|短く)\b/i,
} as const;

const FOCUS_TAG_PATTERNS: Array<[string, RegExp]> = [
  ["examples", /\b(example|examples|for instance|例)\b/i],
  ["pitfalls", /\b(pitfall|pitfalls|common mistake|mistake|confus(?:e|ion)|誤解|落とし穴)\b/i],
  ["definitions", /\b(definition|define|term|terms|定義)\b/i],
  ["intuition", /\b(intuition|why|reasoning|直感|なぜ)\b/i],
  ["formulas", /\b(formula|equation|latex)\b|\$\$/i],
  ["claims_vs_interpretation", /\b(claim|claims|interpretation|authors?|paper)\b/i],
  ["step_by_step", /\b(step[- ]by[- ]step|順番|手順)\b/i],
];

const NOTE_STYLE_PATTERNS: Array<[string, RegExp]> = [
  ["bullet_lists", /(^|\n)-\s/m],
  ["numbered_steps", /(^|\n)\d+\.\s/m],
  ["preserve_headings", /(^|\n)##?\s/m],
  ["math_blocks", /\$\$/],
  ["pitfall_callouts", /\bpitfall\b|(^|\n)##\s*Pitfall\b/i],
];

const AVOID_PATTERNS: Array<[string, RegExp]> = [
  ["filler", /\b(no fluff|avoid filler|冗長|だらだら)\b/i],
  ["overexplaining", /\b(don't overexplain|too long|長すぎ)\b/i],
];

const AGENTIC_NOTE_STYLE_HINTS = [
  "prefer_augmenting_existing_notes",
  "preserve_existing_note_content",
  "canonical_callout_math",
];

const AGENTIC_AVOID_PATTERNS = [
  "unrequested_deletion",
  "unrequested_full_note_replacement",
];

function unique(values: Iterable<string>): string[] {
  return [...new Set([...values].map((entry) => entry.trim()).filter(Boolean))];
}

function detectExplanationDepth(prompt: string, summary: string): UserAdaptationProfile["explanationDepth"] {
  const haystack = `${prompt}\n${summary}`;
  if (EXPLANATION_DEPTH_PATTERNS.step_by_step.test(haystack)) {
    return "step_by_step";
  }
  if (EXPLANATION_DEPTH_PATTERNS.concise.test(haystack)) {
    return "concise";
  }
  return "balanced";
}

function detectTags(haystack: string, patterns: Array<[string, RegExp]>): string[] {
  return patterns.flatMap(([tag, pattern]) => (pattern.test(haystack) ? [tag] : []));
}

export function normalizeUserAdaptationMemory(memory: UserAdaptationMemory | null | undefined): UserAdaptationMemory | null {
  if (!memory) {
    return null;
  }
  const globalProfile: UserAdaptationProfile | null = memory.globalProfile
    ? {
        explanationDepth:
          memory.globalProfile.explanationDepth === "step_by_step" || memory.globalProfile.explanationDepth === "concise"
            ? memory.globalProfile.explanationDepth
            : "balanced",
        preferredFocusTags: unique(memory.globalProfile.preferredFocusTags ?? []),
        preferredNoteStyleHints: unique(memory.globalProfile.preferredNoteStyleHints ?? []),
        avoidResponsePatterns: unique(memory.globalProfile.avoidResponsePatterns ?? []),
        updatedAt:
          typeof memory.globalProfile.updatedAt === "number" && Number.isFinite(memory.globalProfile.updatedAt)
            ? memory.globalProfile.updatedAt
            : Date.now(),
      }
    : null;
  const panelOverlays = Object.fromEntries(
    Object.entries(memory.panelOverlays ?? {}).flatMap(([panelId, overlay]) => {
      const normalizedPanelId = panelId.trim();
      if (!normalizedPanelId || !overlay) {
        return [];
      }
      const normalized: PanelAdaptationOverlay = {
        panelId: overlay.panelId?.trim() || normalizedPanelId,
        preferredFocusTags: unique(overlay.preferredFocusTags ?? []),
        preferredNoteStyleHints: unique(overlay.preferredNoteStyleHints ?? []),
        preferredSkillNames: unique(overlay.preferredSkillNames ?? []),
        lastAppliedTargetPath: overlay.lastAppliedTargetPath?.trim() || null,
        updatedAt: typeof overlay.updatedAt === "number" && Number.isFinite(overlay.updatedAt) ? overlay.updatedAt : Date.now(),
      };
      return [[normalizedPanelId, normalized] as const];
    }),
  );
  if (!globalProfile && Object.keys(panelOverlays).length === 0) {
    return null;
  }
  return {
    globalProfile,
    panelOverlays,
  };
}

export function cloneUserAdaptationMemory(memory: UserAdaptationMemory | null | undefined): UserAdaptationMemory | null {
  const normalized = normalizeUserAdaptationMemory(memory);
  if (!normalized) {
    return null;
  }
  return {
    globalProfile: normalized.globalProfile
      ? {
          explanationDepth: normalized.globalProfile.explanationDepth,
          preferredFocusTags: [...normalized.globalProfile.preferredFocusTags],
          preferredNoteStyleHints: [...normalized.globalProfile.preferredNoteStyleHints],
          avoidResponsePatterns: [...normalized.globalProfile.avoidResponsePatterns],
          updatedAt: normalized.globalProfile.updatedAt,
        }
      : null,
    panelOverlays: Object.fromEntries(
      Object.entries(normalized.panelOverlays).map(([panelId, overlay]) => [
        panelId,
        {
          panelId: overlay.panelId,
          preferredFocusTags: [...overlay.preferredFocusTags],
          preferredNoteStyleHints: [...overlay.preferredNoteStyleHints],
          preferredSkillNames: [...overlay.preferredSkillNames],
          lastAppliedTargetPath: overlay.lastAppliedTargetPath,
          updatedAt: overlay.updatedAt,
        },
      ]),
    ),
  };
}

export function updateUserAdaptationMemory(
  current: UserAdaptationMemory | null | undefined,
  input: UserAdaptationUpdateInput,
): UserAdaptationMemory | null {
  const normalized = normalizeUserAdaptationMemory(current);
  const occurredAt = typeof input.occurredAt === "number" && Number.isFinite(input.occurredAt) ? input.occurredAt : Date.now();
  const summaryHaystack = [input.prompt, input.assistantSummary, input.appliedChangeSummary, input.appliedContent].join("\n");
  const globalProfile: UserAdaptationProfile = {
    explanationDepth: detectExplanationDepth(input.prompt, summaryHaystack),
    preferredFocusTags: unique([
      ...(normalized?.globalProfile?.preferredFocusTags ?? []),
      ...detectTags(summaryHaystack, FOCUS_TAG_PATTERNS),
    ]),
    preferredNoteStyleHints: unique([
      ...(normalized?.globalProfile?.preferredNoteStyleHints ?? []),
      ...detectTags(summaryHaystack, NOTE_STYLE_PATTERNS),
      ...AGENTIC_NOTE_STYLE_HINTS,
    ]),
    avoidResponsePatterns: unique([
      ...(normalized?.globalProfile?.avoidResponsePatterns ?? []),
      ...detectTags(input.prompt, AVOID_PATTERNS),
      ...AGENTIC_AVOID_PATTERNS,
    ]),
    updatedAt: occurredAt,
  };
  const panelOverlays = { ...(normalized?.panelOverlays ?? {}) };
  if (input.panelId?.trim()) {
    const panelId = input.panelId.trim();
    const prior = panelOverlays[panelId];
    panelOverlays[panelId] = {
      panelId,
      preferredFocusTags: unique([...(prior?.preferredFocusTags ?? []), ...detectTags(summaryHaystack, FOCUS_TAG_PATTERNS)]),
      preferredNoteStyleHints: unique([
        ...(prior?.preferredNoteStyleHints ?? []),
        ...detectTags(summaryHaystack, NOTE_STYLE_PATTERNS),
      ]),
      preferredSkillNames: unique([...(prior?.preferredSkillNames ?? []), ...input.selectedSkillNames]),
      lastAppliedTargetPath: input.targetNotePath?.trim() || prior?.lastAppliedTargetPath || null,
      updatedAt: occurredAt,
    };
  }
  return normalizeUserAdaptationMemory({
    globalProfile,
    panelOverlays,
  });
}

function formatLabelList(label: string, values: readonly string[]): string[] {
  if (values.length === 0) {
    return [];
  }
  return [`- ${label}: ${values.join(", ")}`];
}

function formatExplanationDepth(depth: UserAdaptationProfile["explanationDepth"]): string {
  if (depth === "step_by_step") {
    return "step-by-step";
  }
  if (depth === "concise") {
    return "concise";
  }
  return "balanced";
}

export function buildUserAdaptationMemoryText(
  memory: UserAdaptationMemory | null | undefined,
  panelId: string | null,
): string | null {
  const normalized = normalizeUserAdaptationMemory(memory);
  if (!normalized) {
    return null;
  }
  const lines: string[] = ["User adaptation memory"];
  if (normalized.globalProfile) {
    lines.push("Global profile");
    lines.push(`- Preferred explanation depth: ${formatExplanationDepth(normalized.globalProfile.explanationDepth)}`);
    lines.push(...formatLabelList("Preferred focus tags", normalized.globalProfile.preferredFocusTags.slice(0, 5)));
    lines.push(...formatLabelList("Preferred note style hints", normalized.globalProfile.preferredNoteStyleHints.slice(0, 5)));
    lines.push(...formatLabelList("Avoid response patterns", normalized.globalProfile.avoidResponsePatterns.slice(0, 3)));
  }
  if (panelId?.trim()) {
    const overlay = normalized.panelOverlays[panelId.trim()];
    if (overlay) {
      lines.push(`Panel overlay (${overlay.panelId})`);
      lines.push(...formatLabelList("Focus tags", overlay.preferredFocusTags.slice(0, 5)));
      lines.push(...formatLabelList("Note style hints", overlay.preferredNoteStyleHints.slice(0, 5)));
      lines.push(...formatLabelList("Frequently used skills", overlay.preferredSkillNames.slice(0, 5)));
      if (overlay.lastAppliedTargetPath) {
        lines.push(`- Last applied target note: ${overlay.lastAppliedTargetPath}`);
      }
    }
  }
  return lines.length > 1 ? lines.join("\n") : null;
}
