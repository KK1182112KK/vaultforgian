import type { PatchIntent } from "../model/types";

export type AgenticTurnIntent = "answer" | PatchIntent;

const PATCH_INTENT_ALIASES: Record<PatchIntent, readonly string[]> = {
  augment: [
    "augment",
    "append",
    "add",
    "insert",
    "supplement",
    "support",
    "supporting_note",
    "追記",
    "追加",
    "補足",
    "付け加え",
  ],
  replace: [
    "replace",
    "rewrite",
    "local_replace",
    "revise",
    "update",
    "edit",
    "置き換え",
    "置換",
    "差し替え",
    "修正",
  ],
  delete: [
    "delete",
    "remove",
    "erase",
    "drop",
    "削除",
    "消す",
    "消して",
  ],
  full_replace: [
    "full_replace",
    "full-replace",
    "full replace",
    "replace_all",
    "rewrite_all",
    "whole_note",
    "entire_note",
    "全文",
    "全体",
    "ノート全体",
  ],
  create: [
    "create",
    "new",
    "新規",
    "作成",
  ],
};

function normalizeAlias(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/gu, "_");
}

export function normalizePatchIntent(value: string | null | undefined): PatchIntent | null {
  const normalized = normalizeAlias(value ?? "");
  if (!normalized) {
    return null;
  }
  const orderedIntents: PatchIntent[] = ["full_replace", "delete", "augment", "replace", "create"];
  for (const intent of orderedIntents) {
    if (PATCH_INTENT_ALIASES[intent].some((alias) => normalizeAlias(alias) === normalized)) {
      return intent;
    }
  }
  for (const intent of orderedIntents) {
    if (PATCH_INTENT_ALIASES[intent].some((alias) => normalized.includes(normalizeAlias(alias)))) {
      return intent;
    }
  }
  return null;
}

const FULL_REPLACE_PATTERNS = [
  /ノート全体/u,
  /全文/u,
  /全体.*(?:書き換|置き換|差し替)/u,
  /(?:rewrite|replace)\s+(?:the\s+)?(?:entire|whole)\s+(?:note|file|document)/iu,
  /(?:entire|whole)\s+(?:note|file|document)/iu,
];

const DELETE_PATTERNS = [
  /削除/u,
  /消して/u,
  /消す/u,
  /\b(?:delete|remove|erase|drop)\b/iu,
];

const AUGMENT_PATTERNS = [
  /補足/u,
  /追記/u,
  /追加/u,
  /付け加/u,
  /\b(?:append|add|augment|supplement|insert)\b/iu,
  /\bsupporting\s+note\b/iu,
];

const REPLACE_PATTERNS = [
  /置き換/u,
  /差し替/u,
  /\b(?:replace|rewrite|revise)\b/iu,
];

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function classifyAgenticTurnIntent(prompt: string | null | undefined): AgenticTurnIntent {
  const text = prompt?.trim() ?? "";
  if (!text) {
    return "answer";
  }
  if (matchesAny(text, FULL_REPLACE_PATTERNS)) {
    return "full_replace";
  }
  if (matchesAny(text, DELETE_PATTERNS)) {
    return "delete";
  }
  if (matchesAny(text, AUGMENT_PATTERNS)) {
    return "augment";
  }
  if (matchesAny(text, REPLACE_PATTERNS)) {
    return "replace";
  }
  return "answer";
}

export function resolvePatchIntent(params: {
  explicitIntent?: PatchIntent | null;
  patchKind: "create" | "update";
  turnIntent: AgenticTurnIntent;
}): PatchIntent {
  if (params.explicitIntent) {
    return params.explicitIntent;
  }
  if (params.patchKind === "create") {
    return "create";
  }
  return params.turnIntent === "answer" || params.turnIntent === "create" ? "augment" : params.turnIntent;
}
