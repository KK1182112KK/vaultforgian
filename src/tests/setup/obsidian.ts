export class Notice {
  static messages: string[] = [];
  readonly message: string;

  constructor(message: string) {
    this.message = message;
    Notice.messages.push(message);
  }

  static reset(): void {
    Notice.messages = [];
  }
}

export class MenuItem {
  title = "";
  icon = "";
  disabled = false;
  private clickHandler: (() => void) | null = null;

  setTitle(title: string): this {
    this.title = title;
    return this;
  }

  setIcon(icon: string): this {
    this.icon = icon;
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.disabled = disabled;
    return this;
  }

  onClick(handler: () => void): this {
    this.clickHandler = handler;
    return this;
  }

  trigger(): void {
    if (!this.disabled) {
      this.clickHandler?.();
    }
  }
}

export class Menu {
  static lastShown: { items: MenuItem[]; position: { x: number; y: number } } | null = null;
  readonly items: MenuItem[] = [];

  addItem(callback: (item: MenuItem) => void): this {
    const item = new MenuItem();
    callback(item);
    this.items.push(item);
    return this;
  }

  showAtPosition(position: { x: number; y: number }): this {
    Menu.lastShown = { items: [...this.items], position };
    return this;
  }

  static reset(): void {
    Menu.lastShown = null;
  }
}

export class Component {}

export class View extends Component {
  constructor(public readonly leaf: unknown) {
    super();
  }

  getDisplayText(): string {
    return "";
  }

  getIcon(): string {
    return "";
  }

  onResize(): void {}
}

export class ItemView extends View {
  contentEl: HTMLDivElement;
  app: unknown;

  constructor(leaf: unknown) {
    super(leaf);
    this.contentEl = typeof document !== "undefined" ? document.createElement("div") : ({} as HTMLDivElement);
    this.app = {};
  }

  getViewType(): string {
    return "item-view";
  }

  async onOpen(): Promise<void> {}

  async onClose(): Promise<void> {}
}

export class Modal {
  modalEl: HTMLDivElement;
  contentEl: HTMLDivElement;

  constructor(public readonly app: unknown) {
    this.modalEl = typeof document !== "undefined" ? document.createElement("div") : ({} as HTMLDivElement);
    this.contentEl = typeof document !== "undefined" ? document.createElement("div") : ({} as HTMLDivElement);
    if (typeof document !== "undefined") {
      this.modalEl.appendChild(this.contentEl);
    }
  }

  onOpen(): void {}

  onClose(): void {}

  open(): void {
    if (typeof document !== "undefined") {
      document.body.appendChild(this.modalEl);
    }
    this.onOpen();
  }

  close(): void {
    this.onClose();
    this.modalEl.remove?.();
  }
}

export class TextAreaComponent {
  inputEl: HTMLTextAreaElement;

  constructor() {
    this.inputEl =
      typeof document !== "undefined"
        ? document.createElement("textarea")
        : ({
            value: "",
            placeholder: "",
            addEventListener() {},
          } as unknown as HTMLTextAreaElement);
  }

  setPlaceholder(value: string): this {
    this.inputEl.placeholder = value;
    return this;
  }

  setValue(value: string): this {
    this.inputEl.value = value;
    return this;
  }

  getValue(): string {
    return this.inputEl.value;
  }
}

export class Setting {
  private readonly settingEl: HTMLDivElement;
  private readonly controlEl: HTMLDivElement;

  constructor(containerEl: HTMLElement) {
    this.settingEl =
      typeof document !== "undefined"
        ? document.createElement("div")
        : ({ dataset: {}, appendChild() {} } as unknown as HTMLDivElement);
    this.controlEl =
      typeof document !== "undefined"
        ? document.createElement("div")
        : ({ appendChild() {} } as unknown as HTMLDivElement);
    this.settingEl.appendChild?.(this.controlEl);
    containerEl.appendChild?.(this.settingEl);
  }

  setName(name: string): this {
    this.settingEl.dataset.name = name;
    return this;
  }

  setDesc(description: string): this {
    this.settingEl.dataset.desc = description;
    return this;
  }

  addTextArea(callback: (component: TextAreaComponent) => void): this {
    const component = new TextAreaComponent();
    this.controlEl.appendChild(component.inputEl);
    callback(component);
    return this;
  }

  addButton(callback: (button: { setButtonText(text: string): unknown; setCta(): unknown; onClick(fn: () => void): unknown }) => void): this {
    const buttonEl =
      typeof document !== "undefined"
        ? document.createElement("button")
        : ({ textContent: "", classList: { add() {} }, addEventListener() {} } as unknown as HTMLButtonElement);
    this.controlEl.appendChild?.(buttonEl);
    const api = {
      setButtonText: (text: string) => {
        buttonEl.textContent = text;
        return api;
      },
      setCta: () => {
        buttonEl.classList.add("mod-cta");
        return api;
      },
      onClick: (fn: () => void) => {
        buttonEl.addEventListener("click", fn);
        return api;
      },
    };
    callback(api);
    return this;
  }
}

export class MarkdownRenderer {
  static async render(_app: unknown, markdown: string, element: HTMLElement): Promise<void> {
    element.textContent = markdown;
  }
}

export class MarkdownView extends Component {
  file = null;
  editor = null;
}

export class TFile {
  constructor(public readonly path: string) {}
}

export function setIcon(element: HTMLElement, icon: string): void {
  element.dataset.icon = icon;
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
}

type CreateElementOptions = {
  cls?: string;
  text?: string;
  attr?: Record<string, string>;
};

function applyOptions(element: HTMLElement, options: CreateElementOptions = {}): void {
  if (options.cls) {
    element.className = options.cls;
  }
  if (options.text !== undefined) {
    element.textContent = options.text;
  }
  for (const [key, value] of Object.entries(options.attr ?? {})) {
    element.setAttribute(key, value);
  }
}

function installCreateMethods(): void {
  if (typeof HTMLElement === "undefined") {
    return;
  }
  const proto = HTMLElement.prototype as HTMLElement & {
    createDiv?: (options?: CreateElementOptions) => HTMLDivElement;
    createSpan?: (options?: CreateElementOptions) => HTMLSpanElement;
    createEl?: <K extends keyof HTMLElementTagNameMap>(tag: K, options?: CreateElementOptions) => HTMLElementTagNameMap[K];
    empty?: () => void;
    addClass?: (...classes: string[]) => void;
    removeClass?: (...classes: string[]) => void;
    toggleClass?: (className: string, force?: boolean) => void;
  };

  if (!proto.createDiv) {
    proto.createDiv = function createDiv(options: CreateElementOptions = {}): HTMLDivElement {
      const element = document.createElement("div");
      applyOptions(element, options);
      this.appendChild(element);
      return element;
    };
  }

  if (!proto.createSpan) {
    proto.createSpan = function createSpan(options: CreateElementOptions = {}): HTMLSpanElement {
      const element = document.createElement("span");
      applyOptions(element, options);
      this.appendChild(element);
      return element;
    };
  }

  if (!proto.createEl) {
    proto.createEl = function createEl<K extends keyof HTMLElementTagNameMap>(
      tag: K,
      options: CreateElementOptions = {},
    ): HTMLElementTagNameMap[K] {
      const element = document.createElement(tag);
      applyOptions(element, options);
      this.appendChild(element);
      return element;
    };
  }

  if (!proto.empty) {
    proto.empty = function empty(): void {
      this.replaceChildren();
    };
  }

  if (!proto.addClass) {
    proto.addClass = function addClass(...classes: string[]): void {
      this.classList.add(...classes);
    };
  }

  if (!proto.removeClass) {
    proto.removeClass = function removeClass(...classes: string[]): void {
      this.classList.remove(...classes);
    };
  }

  if (!proto.toggleClass) {
    proto.toggleClass = function toggleClass(className: string, force?: boolean): void {
      this.classList.toggle(className, force);
    };
  }
}

export function installObsidianDomHelpers(): void {
  installCreateMethods();
}
