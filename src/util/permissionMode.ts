export type PermissionMode = "suggest" | "auto-edit" | "full-auto";
import type { SupportedLocale } from "./i18n";

export interface PermissionModeProfile {
  mode: PermissionMode;
  label: string;
  description: string;
  approvalPolicy: "untrusted" | "on-failure" | "never";
  sandboxMode: "read-only" | "workspace-write";
}

export const PERMISSION_MODE_CATALOG: readonly PermissionModeProfile[] = [
  {
    mode: "suggest",
    label: "Suggest",
    description: "Read-only, approval required for actions.",
    approvalPolicy: "untrusted",
    sandboxMode: "read-only",
  },
  {
    mode: "auto-edit",
    label: "Auto Edit",
    description: "Workspace-write with approval fallback.",
    approvalPolicy: "on-failure",
    sandboxMode: "workspace-write",
  },
  {
    mode: "full-auto",
    label: "Full Auto",
    description: "Workspace-write with automatic execution.",
    approvalPolicy: "never",
    sandboxMode: "workspace-write",
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
        label: "Suggest",
        description: "読み取り専用。操作には承認が必要です。",
      },
      {
        ...PERMISSION_MODE_CATALOG[1],
        label: "Auto Edit",
        description: "workspace-write。失敗時は承認にフォールバックします。",
      },
      {
        ...PERMISSION_MODE_CATALOG[2],
        label: "Full Auto",
        description: "workspace-write。自動で実行します。",
      },
    ] as const;
  }
  return PERMISSION_MODE_CATALOG;
}
