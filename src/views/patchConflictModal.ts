import { App, Modal } from "obsidian";
import type { PatchConflictDetails } from "../util/patchConflicts";

export interface PatchConflictModalCopy {
  title: (path: string) => string;
  currentContent: string;
  codexProposal: string;
  overwrite: string;
  keepCurrent: string;
  openInEditor: string;
  overwriteChangedConfirm: string;
}

export class PatchConflictModal extends Modal {
  constructor(
    app: App,
    private readonly details: PatchConflictDetails,
    private readonly copy: PatchConflictModalCopy,
    private readonly actions: {
      overwrite: (expectedCurrentContentHash: string | null, force: boolean) => Promise<"applied" | "changed">;
      openInEditor: () => Promise<void>;
      onError: (error: unknown) => void;
    },
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: this.copy.title(this.details.targetPath) });

    contentEl.createEl("pre", {
      cls: "obsidian-codex__conflict-diff",
      text: this.details.unifiedDiff || this.details.targetPath,
    });

    const panesEl = contentEl.createDiv({ cls: "obsidian-codex__conflict-panes" });
    const currentEl = panesEl.createDiv({ cls: "obsidian-codex__conflict-pane" });
    currentEl.createEl("h4", { text: this.copy.currentContent });
    currentEl.createEl("pre", {
      cls: "obsidian-codex__conflict-pane-body",
      text: this.details.currentContent ?? "",
    });

    const proposalEl = panesEl.createDiv({ cls: "obsidian-codex__conflict-pane" });
    proposalEl.createEl("h4", { text: this.copy.codexProposal });
    proposalEl.createEl("pre", {
      cls: "obsidian-codex__conflict-pane-body",
      text: this.details.proposedText,
    });

    const actionsEl = contentEl.createDiv({ cls: "obsidian-codex__modal-actions" });
    const keepButton = actionsEl.createEl("button", { text: this.copy.keepCurrent });
    keepButton.type = "button";
    keepButton.addEventListener("click", () => this.close());

    const openButton = actionsEl.createEl("button", { text: this.copy.openInEditor });
    openButton.type = "button";
    openButton.addEventListener("click", () => {
      void this.actions.openInEditor().catch((error: unknown) => {
        this.actions.onError(error);
      });
    });

    const overwriteButton = actionsEl.createEl("button", { text: this.copy.overwrite });
    overwriteButton.type = "button";
    overwriteButton.addClass("mod-cta");
    overwriteButton.addEventListener("click", () => {
      void this.handleOverwrite();
    });
  }

  private async handleOverwrite(): Promise<void> {
    try {
      let result = await this.actions.overwrite(this.details.openedCurrentContentHash, false);
      if (result === "changed") {
        if (!window.confirm(this.copy.overwriteChangedConfirm)) {
          return;
        }
        result = await this.actions.overwrite(this.details.openedCurrentContentHash, true);
      }
      if (result === "applied") {
        this.close();
      }
    } catch (error) {
      this.actions.onError(error);
    }
  }
}
