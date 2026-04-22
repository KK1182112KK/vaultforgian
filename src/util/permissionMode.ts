export type PermissionMode = "suggest" | "auto-edit" | "full-auto";
import type { SupportedLocale } from "./i18n";

export type NoteApplyPolicy = "manual" | "approval" | "auto";

export interface PermissionModeProfile {
  mode: PermissionMode;
  label: string;
  description: string;
  approvalPolicy: "untrusted" | "on-failure" | "never";
  sandboxMode: "read-only";
  noteApplyPolicy: NoteApplyPolicy;
  planExecutionEnabled: boolean;
}

export const PERMISSION_MODE_CATALOG: readonly PermissionModeProfile[] = [
  {
    mode: "suggest",
    label: "Suggest only",
    description: "Codex can prepare note changes, but it will not apply them automatically.",
    approvalPolicy: "untrusted",
    sandboxMode: "read-only",
    noteApplyPolicy: "manual",
    planExecutionEnabled: false,
  },
  {
    mode: "auto-edit",
    label: "Review before applying",
    description: "Note changes stay in review until you approve them.",
    approvalPolicy: "on-failure",
    sandboxMode: "read-only",
    noteApplyPolicy: "approval",
    planExecutionEnabled: false,
  },
  {
    mode: "full-auto",
    label: "Apply automatically",
    description: "Apply note changes automatically unless the plugin pauses for readability or safety review first.",
    approvalPolicy: "never",
    sandboxMode: "read-only",
    noteApplyPolicy: "auto",
    planExecutionEnabled: true,
  },
] as const;

export function normalizePermissionMode(value: string | null | undefined): PermissionMode | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "autoedit") {
    return "auto-edit";
  }
  return PERMISSION_MODE_CATALOG.some((entry) => entry.mode === normalized) ? (normalized as PermissionMode) : null;
}

export function getPermissionModeProfile(mode: PermissionMode): PermissionModeProfile {
  return PERMISSION_MODE_CATALOG.find((entry) => entry.mode === mode) ?? PERMISSION_MODE_CATALOG[0];
}

export function getPermissionModeCatalog(locale: SupportedLocale = "en"): readonly PermissionModeProfile[] {
  if (locale === "ja") {
    return [
      {
        ...PERMISSION_MODE_CATALOG[0],
        label: "提案のみ",
        description: "Codex はノート変更を提案できますが、自動適用はしません。",
      },
      {
        ...PERMISSION_MODE_CATALOG[1],
        label: "適用前に確認",
        description: "ノート変更は承認 UI を通してから適用します。",
      },
      {
        ...PERMISSION_MODE_CATALOG[2],
        label: "自動で適用",
        description: "可読性や安全性の確認が必要な場合を除き、ノート変更を自動で適用します。",
      },
    ] as const;
  }
  return PERMISSION_MODE_CATALOG;
}
