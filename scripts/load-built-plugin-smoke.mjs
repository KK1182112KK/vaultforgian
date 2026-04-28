import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveProjectRoot } from "./lib/project-root.mjs";

const projectRoot = resolveProjectRoot(import.meta.url);
const mainJsPath = path.join(projectRoot, "main.js");

const OBSIDIAN_STUB_SOURCE = `
class ChainableComponent {
  setName() { return this; }
  setDesc() { return this; }
  setPlaceholder() { return this; }
  setValue() { return this; }
  setDisabled() { return this; }
  setButtonText() { return this; }
  setCta() { return this; }
  setWarning() { return this; }
  setTooltip() { return this; }
  setIcon() { return this; }
  onClick() { return this; }
  onChange() { return this; }
  addButton(callback) { callback?.(this); return this; }
  addExtraButton(callback) { callback?.(this); return this; }
  addText(callback) { callback?.(this); return this; }
  addTextArea(callback) { callback?.(this); return this; }
  addDropdown(callback) { callback?.(this); return this; }
  addToggle(callback) { callback?.(this); return this; }
  addSearch(callback) { callback?.(this); return this; }
  then(callback) { callback?.(this); return this; }
}

class Plugin {
  constructor(app, manifest) {
    this.app = app;
    this.manifest = manifest;
  }
  registerView() {}
  registerEvent() {}
  registerInterval() {}
  registerDomEvent() {}
  addSettingTab() {}
  addCommand() {}
  addRibbonIcon() {
    return {
      remove() {},
      addClass() {},
      removeClass() {},
    };
  }
  addStatusBarItem() {
    return {
      setText() {},
      empty() {},
      remove() {},
    };
  }
  loadData() { return Promise.resolve({}); }
  saveData() { return Promise.resolve(); }
}

class PluginSettingTab extends ChainableComponent {
  constructor(app, plugin) {
    super();
    this.app = app;
    this.plugin = plugin;
    this.containerEl = {
      empty() {},
      createDiv() { return this; },
      createEl() { return this; },
      appendChild() {},
      addClass() {},
      removeClass() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
    };
  }
}

class Modal extends ChainableComponent {
  constructor(app) {
    super();
    this.app = app;
    this.contentEl = {
      empty() {},
      createDiv() { return this; },
      createEl() { return this; },
      appendChild() {},
    };
  }
  open() {}
  close() {}
}

class Notice {
  constructor() {}
}

const baseExports = {
  Plugin,
  PluginSettingTab,
  Modal,
  Notice,
  Setting: ChainableComponent,
  ButtonComponent: ChainableComponent,
  DropdownComponent: ChainableComponent,
  ExtraButtonComponent: ChainableComponent,
  SearchComponent: ChainableComponent,
  TextAreaComponent: ChainableComponent,
  TextComponent: ChainableComponent,
  ToggleComponent: ChainableComponent,
  Component: class {},
  ItemView: class {},
  MarkdownView: class {},
  MarkdownRenderChild: class {},
  WorkspaceLeaf: class {},
  TFile: class {},
  TFolder: class {},
  Menu: class {
    addItem(callback) {
      callback?.(new ChainableComponent());
      return this;
    }
  },
  MarkdownRenderer: {
    render: async () => {},
    renderMarkdown: async () => {},
  },
  Platform: {
    isMacOS: false,
    isMobile: false,
  },
  Scope: class {},
  addIcon() {},
  debounce(fn) { return fn; },
  getLanguage() { return "en"; },
  normalizePath(value) { return value; },
  parseFrontMatterAliases() { return []; },
  parseYaml() { return {}; },
  requestUrl: async () => ({ json: null, text: "" }),
  sanitizeHTMLToDom() { return { querySelector: () => null }; },
  setIcon() {},
  stringifyYaml() { return ""; },
};

module.exports = new Proxy(baseExports, {
  get(target, prop) {
    if (prop in target) {
      return target[prop];
    }
    class Fallback extends ChainableComponent {}
    target[prop] = Fallback;
    return Fallback;
  },
});
`;

function runNode(commandArgs, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, commandArgs, {
      cwd: projectRoot,
      env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Bundle smoke exited with code ${code ?? "unknown"}.`));
    });
  });
}

function resolvePluginExport(candidate) {
  const seen = new Set();
  let current = candidate;
  while (current && (typeof current === "object" || typeof current === "function") && !seen.has(current)) {
    if (typeof current === "function") {
      return current;
    }
    seen.add(current);
    if (typeof current.default === "function") {
      return current.default;
    }
    if (current.default && current.default !== current) {
      current = current.default;
      continue;
    }
    if (current["module.exports"] && current["module.exports"] !== current) {
      current = current["module.exports"];
      continue;
    }
    break;
  }
  return null;
}

async function main() {
  await stat(mainJsPath);
  const stubRoot = await mkdtemp(path.join(tmpdir(), "vaultforgian-bundle-smoke-"));
  try {
    const obsidianDir = path.join(stubRoot, "node_modules", "obsidian");
    await mkdir(obsidianDir, { recursive: true });
    await writeFile(path.join(obsidianDir, "index.js"), OBSIDIAN_STUB_SOURCE, "utf8");

    const smokeScript = `
      const { pathToFileURL } = require("node:url");
      const mainJsPath = ${JSON.stringify(mainJsPath)};
      const createAppStub = () => ({
        vault: {
          adapter: { basePath: "/vault" },
          configDir: ".obsidian",
          getAbstractFileByPath: () => null,
          cachedRead: async () => "",
          create: async () => ({ path: "" }),
          modify: async () => {},
          createFolder: async () => {},
        },
        fileManager: {
          renameFile: async () => {},
          processFrontMatter: async (_file, updater) => updater({}),
        },
        metadataCache: {
          resolvedLinks: {},
          unresolvedLinks: {},
        },
        workspace: {
          on: () => ({}) ,
          onLayoutReady: (callback) => callback?.(),
          detachLeavesOfType: () => {},
          getLeavesOfType: () => [],
          getLeaf: () => ({ openFile: async () => {} }),
          getMostRecentLeaf: () => null,
          getActiveFile: () => null,
        },
      });
      (async () => {
        const loaded = await import(pathToFileURL(mainJsPath).href);
        const PluginClass = (${resolvePluginExport.toString()})(loaded);
        if (typeof PluginClass !== "function") {
          throw new Error("Built main.js did not export a plugin class.");
        }
        const instance = new PluginClass(createAppStub(), {
          id: "obsidian-codex-study",
          name: "VaultForgian",
          version: "0.0.0-smoke",
        });
        if (!instance || typeof instance !== "object") {
          throw new Error("Built plugin constructor did not create an instance.");
        }
        if (typeof instance.onload === "function") {
          await instance.onload();
        }
        if (typeof instance.onunload === "function") {
          await instance.onunload();
        }
      })().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      });
    `;

    await runNode(["-e", smokeScript], {
      ...process.env,
      NODE_PATH: path.join(stubRoot, "node_modules"),
    });
    console.log("Bundle load smoke passed.");
  } finally {
    await rm(stubRoot, { recursive: true, force: true });
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
