import type { ConversationTabState } from "../model/types";
import { extractSkillReferences } from "./skillRouting";

function normalizeSkillName(value: string): string | null {
  const normalized = value.trim().replace(/^\$+/, "");
  return normalized || null;
}

function toSkillRefs(values: readonly string[]): string[] {
  const refs: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = normalizeSkillName(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    refs.push(`$${normalized}`);
  }

  return refs;
}

export interface TurnSkillSelectionParams {
  explicitSkillRefs: readonly string[];
  mentionSkillRefs: readonly string[];
  workflowSkillRefs: readonly string[];
  tab: ConversationTabState | null;
}

export function collectTurnRequestedSkillRefs(params: TurnSkillSelectionParams): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (value: string) => {
    const normalized = normalizeSkillName(value);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    ordered.push(`$${normalized}`);
  };

  for (const value of params.explicitSkillRefs) {
    for (const reference of extractSkillReferences(value)) {
      push(reference.name);
    }
  }

  for (const value of params.mentionSkillRefs) {
    push(value);
  }

  const panelSelectedSkillRefs =
    params.tab?.activeStudyRecipeId
      ? toSkillRefs([
          ...(params.tab.activeStudySkillNames ?? []),
          ...(params.tab.panelSessionOrigin?.panelId === params.tab.activeStudyRecipeId
            ? params.tab.panelSessionOrigin.selectedSkillNames
            : []),
        ])
      : [];

  for (const value of panelSelectedSkillRefs) {
    push(value);
  }

  for (const value of params.workflowSkillRefs) {
    push(value);
  }

  return ordered;
}
