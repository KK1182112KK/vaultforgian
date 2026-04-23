import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ItemView, Modal, Setting, TextAreaComponent } from "./setup/obsidian";

describe("obsidian test setup", () => {
  const previousDocument = globalThis.document;
  const previousDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");

  beforeEach(() => {
    // These constructor guards should work even when no DOM is present.
    Reflect.deleteProperty(globalThis, "document");
  });

  afterEach(() => {
    if (previousDocumentDescriptor) {
      Object.defineProperty(globalThis, "document", previousDocumentDescriptor);
      return;
    }
    if (previousDocument !== undefined) {
      Object.assign(globalThis, { document: previousDocument });
      return;
    }
    Reflect.deleteProperty(globalThis, "document");
  });

  it("constructs ItemView and Modal without a DOM", () => {
    const itemView = new ItemView(null);
    const modal = new Modal({});

    expect(itemView.contentEl).toBeTruthy();
    expect(modal.contentEl).toBeTruthy();
    expect(() => modal.close()).not.toThrow();
  });

  it("constructs TextAreaComponent and Setting without a DOM", () => {
    const textarea = new TextAreaComponent();
    const container = { appendChild: vi.fn() } as unknown as HTMLElement;
    const setting = new Setting(container);

    expect(textarea.inputEl).toBeTruthy();
    expect(() =>
      setting.addTextArea((component) => component.setValue("draft")).addButton((button) => {
        button.setButtonText("Save");
        button.setCta();
        button.onClick(() => {});
      }),
    ).not.toThrow();
  });
});
