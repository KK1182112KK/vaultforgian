import { homedir } from "node:os";
import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type ObsidianCodexPlugin from "../main";
import { DEFAULT_PRIMARY_MODEL, type PluginSettings } from "../model/types";
import { normalizeCodexRuntime, sanitizeCodexExecutablePath, isUnsafeCodexExecutablePath } from "../util/codexLauncher";
import { coerceModelForPicker, getFallbackModelCatalog } from "../util/models";
import { getPermissionModeCatalog } from "../util/permissionMode";
import { formatReasoningEffortLabel, REASONING_EFFORT_ORDER } from "../util/reasoning";
import { normalizeConfiguredSkillRoots } from "../util/skillRoots";

export class CodexSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: ObsidianCodexPlugin) {
    super(app, plugin);
  }

  override display(): void {
    const { containerEl } = this;
    const settings = this.plugin.settings;
    const locale = this.plugin.getResolvedLocale();
    const copy = this.plugin.getLocalizedCopy();
    containerEl.empty();
    containerEl.createEl("h2", { text: copy.settings.title });
    const runtimeIssue = this.plugin.getRuntimeIssue();
    if (runtimeIssue) {
      const warningEl = containerEl.createDiv({ cls: "obsidian-codex__settings-warning" });
      warningEl.createEl("strong", {
        cls: "obsidian-codex__settings-warning-title",
        text: copy.settings.runtimeWarningTitle,
      });
      warningEl.createDiv({
        cls: "obsidian-codex__settings-warning-body",
        text: runtimeIssue,
      });
    }

    new Setting(containerEl)
      .setName(copy.settings.languageName)
      .setDesc(copy.settings.languageDesc)
      .addDropdown((component) => {
        component.addOption("app", copy.settings.languageFollowApp);
        component.addOption("en", copy.settings.languageEnglish);
        component.addOption("ja", copy.settings.languageJapanese);
        component.setValue(settings.uiLanguage);
        component.onChange(async (value) => {
          await this.update({
            uiLanguage: value as PluginSettings["uiLanguage"],
          });
        });
      });

    new Setting(containerEl)
      .setName(copy.settings.authenticationName)
      .setDesc(copy.settings.authenticationDesc);

    new Setting(containerEl)
      .setName(copy.settings.codexModelName)
      .setDesc(copy.settings.codexModelDesc)
      .addText((component) => {
        component.setValue(settings.codex.model);
        component.onChange(async (value) => {
          const model = coerceModelForPicker(getFallbackModelCatalog(), value.trim() || DEFAULT_PRIMARY_MODEL);
          await this.update({
            defaultModel: model,
            codex: {
              ...settings.codex,
              model,
            },
          });
        });
      });

    new Setting(containerEl)
      .setName(copy.settings.defaultReasoningEffortName)
      .setDesc(copy.settings.defaultReasoningEffortDesc)
      .addDropdown((component) => {
        for (const effort of REASONING_EFFORT_ORDER) {
          component.addOption(effort, formatReasoningEffortLabel(effort, locale));
        }
        component.setValue(settings.defaultReasoningEffort);
        component.onChange(async (value) => {
          await this.update({
            defaultReasoningEffort: settings.defaultReasoningEffort === value ? settings.defaultReasoningEffort : (value as PluginSettings["defaultReasoningEffort"]),
          });
        });
      });

    new Setting(containerEl)
      .setName(copy.settings.permissionModeName)
      .setDesc(copy.settings.permissionModeDesc)
      .addDropdown((component) => {
        for (const mode of getPermissionModeCatalog(locale)) {
          component.addOption(mode.mode, `${mode.label} · ${mode.description}`);
        }
        component.setValue(settings.permissionMode);
        component.onChange(async (value) => {
          await this.update({
            permissionMode: value as PluginSettings["permissionMode"],
          });
        });
      });

    new Setting(containerEl)
      .setName(copy.settings.codexRuntimeName)
      .setDesc(copy.settings.codexRuntimeDesc)
      .addDropdown((component) => {
        component.addOption("native", "Native");
        component.addOption("wsl", "WSL");
        component.setValue(settings.codex.runtime);
        component.onChange(async (value) => {
          this.plugin.clearBlockedLegacyLauncherWarning();
          await this.update({
            codex: {
              ...settings.codex,
              runtime: normalizeCodexRuntime(value),
            },
          });
        });
      });

    new Setting(containerEl)
      .setName(copy.settings.codexExecutableName)
      .setDesc(copy.settings.codexExecutableDesc)
      .addText((component) => {
        component.setValue(settings.codex.executablePath);
        component.onChange(async (value) => {
          const executablePath = sanitizeCodexExecutablePath(value);
          if (isUnsafeCodexExecutablePath(executablePath)) {
            new Notice(
              locale === "ja"
                ? "Codex executable path には実行ファイルだけを指定してください。shell launcher は使えません。"
                : "Codex executable path must point to a single executable. Shell launchers are not allowed.",
            );
            component.setValue(settings.codex.executablePath);
            return;
          }
          this.plugin.clearBlockedLegacyLauncherWarning();
          await this.update({
            codex: {
              ...settings.codex,
              executablePath,
            },
          });
        });
      });

    new Setting(containerEl)
      .setName(copy.settings.extraSkillRootsName)
      .setDesc(copy.settings.extraSkillRootsDesc)
      .addTextArea((component) => {
        component.setValue(settings.extraSkillRoots.join("\n"));
        component.inputEl.rows = 4;
        component.onChange(async (value) => {
          const vaultBasePath = ((this.app.vault as { adapter?: { basePath?: string } }).adapter?.basePath?.trim() ?? "");
          await this.update({
            extraSkillRoots: normalizeConfiguredSkillRoots(value.split(/\r?\n/), {
              allowedRoots: [vaultBasePath, homedir()],
            }),
          });
        });
      });

    new Setting(containerEl)
      .setName(copy.settings.showReasoningName)
      .setDesc(copy.settings.showReasoningDesc)
      .addToggle((component) => {
        component.setValue(settings.showReasoning);
        component.onChange(async (value) => {
          await this.update({ showReasoning: value });
        });
      });

    new Setting(containerEl)
      .setName(copy.settings.autoRestoreTabsName)
      .setDesc(copy.settings.autoRestoreTabsDesc)
      .addToggle((component) => {
        component.setValue(settings.autoRestoreTabs);
        component.onChange(async (value) => {
          await this.update({ autoRestoreTabs: value });
        });
      });
  }

  private async update(partial: Partial<PluginSettings>): Promise<void> {
    this.plugin.settings = {
      ...this.plugin.settings,
      ...partial,
      codex: {
        ...this.plugin.settings.codex,
        ...(partial.codex ?? {}),
      },
    };
    await this.plugin.savePluginState();
    this.plugin.refreshRuntimeSettings();
  }
}
