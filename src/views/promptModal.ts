import { App, Modal, Setting, TextAreaComponent } from "obsidian";

export interface PromptModalCopy {
  fieldLabel: string;
  cancel: string;
  send: string;
}

const DEFAULT_COPY: PromptModalCopy = {
  fieldLabel: "Prompt",
  cancel: "Cancel",
  send: "Send",
};

export class PromptModal extends Modal {
  private textArea!: TextAreaComponent;

  constructor(
    app: App,
    private readonly title: string,
    private readonly placeholder: string,
    private readonly onSubmit: (value: string) => void,
    private readonly description = "Leave blank to use the default note-review prompt.",
    private readonly copy: PromptModalCopy = DEFAULT_COPY,
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: this.title });
    new Setting(contentEl)
      .setName(this.copy.fieldLabel)
      .setDesc(this.description)
      .addTextArea((component) => {
        this.textArea = component;
        component.setPlaceholder(this.placeholder);
        component.inputEl.rows = 6;
        component.inputEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            this.submit();
          }
        });
      });

    new Setting(contentEl)
      .addButton((button) => {
        button.setButtonText(this.copy.cancel).onClick(() => this.close());
      })
      .addButton((button) => {
        button.setCta().setButtonText(this.copy.send).onClick(() => this.submit());
      });

    window.setTimeout(() => this.textArea.inputEl.focus(), 0);
  }

  private submit(): void {
    this.onSubmit(this.textArea.getValue());
    this.close();
  }
}
