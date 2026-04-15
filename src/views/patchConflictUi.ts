import { Notice, type App } from "obsidian";
import type { CodexService } from "../app/codexService";
import type { LocalizedCopy } from "../util/i18n";
import { PatchConflictError } from "../util/patchConflicts";
import { PatchConflictModal } from "./patchConflictModal";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function openPatchConflictModal(
  app: App,
  service: CodexService,
  copy: LocalizedCopy["workspace"],
  error: PatchConflictError,
): void {
  new PatchConflictModal(
    app,
    error.details,
    {
      title: copy.conflictModalTitle,
      currentContent: copy.conflictCurrentContent,
      codexProposal: copy.conflictCodexProposal,
      overwrite: copy.conflictOverwrite,
      keepCurrent: copy.conflictKeepCurrent,
      openInEditor: copy.conflictOpenInEditor,
      overwriteChangedConfirm: copy.conflictOverwriteChangedConfirm,
    },
    {
      overwrite: (expectedCurrentContentHash, force) =>
        service.overwritePatchProposal(error.details.tabId, error.details.patchId, expectedCurrentContentHash, force),
      openInEditor: () => service.openPatchTarget(error.details.tabId, error.details.patchId),
      onError: (modalError) => {
        new Notice(getErrorMessage(modalError));
      },
    },
  ).open();
}
