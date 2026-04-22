export function getRecoveredDraftValue(
  draftBackup: string | null | undefined,
  currentDraft: string | null | undefined,
): string | null {
  if (typeof draftBackup !== "string" || !draftBackup.trim()) {
    return null;
  }
  return currentDraft === "" ? draftBackup : null;
}
