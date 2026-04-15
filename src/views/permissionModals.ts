import { App, Modal } from "obsidian";

export interface PermissionOnboardingModalCopy {
  title: string;
  body: string[];
  openSettings: string;
  confirm: string;
}

export interface AutoApplyConsentModalCopy {
  title: string;
  body: string[];
  keepAutomatic: string;
  switchToApproval: string;
  cancel: string;
}

export class PermissionOnboardingModal extends Modal {
  constructor(
    app: App,
    private readonly copy: PermissionOnboardingModalCopy,
    private readonly onConfirm: () => void,
    private readonly onOpenSettings: () => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: this.copy.title });
    for (const paragraph of this.copy.body) {
      contentEl.createEl("p", { text: paragraph });
    }

    const actionsEl = contentEl.createDiv({ cls: "obsidian-codex__modal-actions" });
    const settingsButton = actionsEl.createEl("button", { text: this.copy.openSettings });
    settingsButton.type = "button";
    settingsButton.addEventListener("click", () => {
      this.onOpenSettings();
      this.close();
    });

    const confirmButton = actionsEl.createEl("button", { text: this.copy.confirm });
    confirmButton.type = "button";
    confirmButton.addClass("mod-cta");
    confirmButton.addEventListener("click", () => {
      this.onConfirm();
      this.close();
    });
  }
}

class AutoApplyConsentModal extends Modal {
  private resolver: ((result: "keep" | "switch" | "cancel") => void) | null = null;
  private resolved = false;

  constructor(app: App, private readonly copy: AutoApplyConsentModalCopy) {
    super(app);
  }

  async openAndWait(): Promise<"keep" | "switch" | "cancel"> {
    return await new Promise<"keep" | "switch" | "cancel">((resolve) => {
      this.resolver = resolve;
      this.open();
    });
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: this.copy.title });
    for (const paragraph of this.copy.body) {
      contentEl.createEl("p", { text: paragraph });
    }

    const actionsEl = contentEl.createDiv({ cls: "obsidian-codex__modal-actions" });
    const cancelButton = actionsEl.createEl("button", { text: this.copy.cancel });
    cancelButton.type = "button";
    cancelButton.addEventListener("click", () => this.finish("cancel"));

    const switchButton = actionsEl.createEl("button", { text: this.copy.switchToApproval });
    switchButton.type = "button";
    switchButton.addEventListener("click", () => this.finish("switch"));

    const keepButton = actionsEl.createEl("button", { text: this.copy.keepAutomatic });
    keepButton.type = "button";
    keepButton.addClass("mod-cta");
    keepButton.addEventListener("click", () => this.finish("keep"));
  }

  override onClose(): void {
    if (!this.resolved) {
      this.finish("cancel");
    }
  }

  private finish(result: "keep" | "switch" | "cancel"): void {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    const resolve = this.resolver;
    this.resolver = null;
    this.close();
    resolve?.(result);
  }
}

export async function promptAutoApplyConsent(app: App, copy: AutoApplyConsentModalCopy): Promise<"keep" | "switch" | "cancel"> {
  return await new AutoApplyConsentModal(app, copy).openAndWait();
}
