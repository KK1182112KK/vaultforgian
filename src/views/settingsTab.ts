import { homedir } from "node:os";
import { App, Modal, Notice, PluginSettingTab, Setting, TextAreaComponent, TextComponent } from "obsidian";
import type ObsidianCodexPlugin from "../main";
import { DEFAULT_PRIMARY_MODEL, type PluginSettings, type StudyRecipe } from "../model/types";
import { normalizeCodexRuntime, sanitizeCodexExecutablePath, isUnsafeCodexExecutablePath } from "../util/codexLauncher";
import { makeId } from "../util/id";
import { coerceModelForPicker, getFallbackModelCatalog } from "../util/models";
import { getPermissionModeCatalog } from "../util/permissionMode";
import { formatReasoningEffortLabel, REASONING_EFFORT_ORDER } from "../util/reasoning";
import { buildStudyRecipeCommandAlias } from "../util/studyRecipes";
import { normalizeConfiguredSkillRoots } from "../util/skillRoots";
import { compactModelLabel } from "./renderers/workspaceViewShared";
import {
  normalizeEnvironmentSnippets,
  normalizeLineList,
  normalizeMcpServers,
  parseMultilineText,
  stringifyMultilineText,
} from "../util/pluginSettings";
import { PromptModal } from "./promptModal";

type RecipeDraft = Pick<StudyRecipe, "title" | "description" | "commandAlias" | "promptTemplate" | "linkedSkillNames">;

class RecipeEditorModal extends Modal {
  private titleComponent!: TextComponent;
  private descriptionComponent!: TextComponent;
  private aliasComponent!: TextComponent;
  private promptComponent!: TextAreaComponent;
  private skillsComponent!: TextAreaComponent;

  constructor(
    app: App,
    private readonly locale: "en" | "ja",
    private readonly initial: RecipeDraft,
    private readonly onSubmit: (value: RecipeDraft) => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    const isJa = this.locale === "ja";
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", {
      text: isJa ? "カスタムコマンドを編集" : "Edit custom command",
    });

    new Setting(contentEl)
      .setName(isJa ? "タイトル" : "Title")
      .addText((component) => {
        this.titleComponent = component;
        component.setValue(this.initial.title);
      });

    new Setting(contentEl)
      .setName(isJa ? "説明" : "Description")
      .addText((component) => {
        this.descriptionComponent = component;
        component.setValue(this.initial.description);
      });

    new Setting(contentEl)
      .setName(isJa ? "コマンド" : "Command alias")
      .setDesc(isJa ? "空欄ならタイトルから自動生成します。" : "Leave blank to generate from the title.")
      .addText((component) => {
        this.aliasComponent = component;
        component.setValue(this.initial.commandAlias);
      });

    new Setting(contentEl)
      .setName(isJa ? "プロンプト" : "Prompt template")
      .addTextArea((component) => {
        this.promptComponent = component;
        component.inputEl.rows = 8;
        component.setValue(this.initial.promptTemplate);
      });

    new Setting(contentEl)
      .setName(isJa ? "リンクする skills" : "Linked skills")
      .setDesc(isJa ? "1 行に 1 つずつ入力します。" : "One skill name per line.")
      .addTextArea((component) => {
        this.skillsComponent = component;
        component.inputEl.rows = 6;
        component.setValue(this.initial.linkedSkillNames.join("\n"));
      });

    new Setting(contentEl)
      .addButton((button) => {
        button.setButtonText(isJa ? "キャンセル" : "Cancel").onClick(() => this.close());
      })
      .addButton((button) => {
        button.setCta().setButtonText(isJa ? "保存" : "Save").onClick(() => this.submit());
      });
  }

  private submit(): void {
    this.onSubmit({
      title: this.titleComponent.getValue().trim(),
      description: this.descriptionComponent.getValue().trim(),
      commandAlias: this.aliasComponent.getValue().trim(),
      promptTemplate: this.promptComponent.getValue(),
      linkedSkillNames: parseMultilineText(this.skillsComponent.getValue()),
    });
    this.close();
  }
}

export class CodexSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: ObsidianCodexPlugin) {
    super(app, plugin);
  }

  override display(): void {
    const { containerEl } = this;
    const settings = this.plugin.settings;
    const locale = this.plugin.getResolvedLocale();
    const copy = this.plugin.getLocalizedCopy();
    const isJa = locale === "ja";
    const t = (ja: string, en: string) => (isJa ? ja : en);
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

    this.renderSection(containerEl, copy.settings.languageName);
    new Setting(containerEl)
      .setName(copy.settings.languageName)
      .setDesc(copy.settings.languageDesc)
      .addDropdown((component) => {
        component.addOption("app", copy.settings.languageFollowApp);
        component.addOption("en", copy.settings.languageEnglish);
        component.addOption("ja", copy.settings.languageJapanese);
        component.setValue(settings.uiLanguage);
        component.onChange(async (value) => {
          await this.plugin.updateSettings({
            uiLanguage: value as PluginSettings["uiLanguage"],
          });
        });
      });

    this.renderSection(containerEl, t("Runtime と account", "Runtime & account"));
    const authState = this.plugin.getAuthState();
    const runtimeSummary = [
      authState === "ready" ? t("ログイン済み", "Logged in") : t("ログインが必要", "Login required"),
      settings.codex.runtime === "wsl" ? "WSL" : "Native",
      settings.codex.executablePath,
      ...this.plugin.getRuntimeStatusSummaryParts(),
      runtimeIssue ? t("要確認", "Needs attention") : t("Ready", "Ready"),
    ].join(" · ");
    new Setting(containerEl)
      .setName(t("Codex runtime 状態", "Codex runtime status"))
      .setDesc(runtimeSummary)
      .addButton((button) => {
        button.setButtonText(t("再確認", "Refresh")).onClick(async () => {
          await this.plugin.refreshRuntimeMetadata();
          this.display();
        });
      });
    new Setting(containerEl)
      .setName(copy.settings.codexRuntimeName)
      .setDesc(t("この plugin が Codex CLI を起動する実行環境です。", "Where this plugin launches the Codex CLI from."))
      .addDropdown((component) => {
        component.addOption("native", "Native");
        component.addOption("wsl", "WSL");
        component.setValue(settings.codex.runtime);
        component.onChange(async (value) => {
          this.plugin.clearBlockedLegacyLauncherWarning();
          await this.plugin.updateSettings({
            codex: {
              ...settings.codex,
              runtime: normalizeCodexRuntime(value),
            },
          });
        });
      });
    new Setting(containerEl)
      .setName(copy.settings.codexExecutableName)
      .setDesc(t("起動する `codex` 実行ファイルのパスです。shell launcher ではなく executable を指定します。", "Path to the `codex` executable this plugin launches. Point it at the executable, not a shell launcher."))
      .addText((component) => {
        component.setValue(settings.codex.executablePath);
        component.onChange(async (value) => {
          const executablePath = sanitizeCodexExecutablePath(value);
          if (isUnsafeCodexExecutablePath(executablePath)) {
            new Notice(
              isJa
                ? "Codex executable path には実行ファイルだけを指定してください。shell launcher は使えません。"
                : "Codex executable path must point to a single executable. Shell launchers are not allowed.",
            );
            component.setValue(settings.codex.executablePath);
            return;
          }
          this.plugin.clearBlockedLegacyLauncherWarning();
          await this.plugin.updateSettings({
            codex: {
              ...settings.codex,
              executablePath,
            },
          });
        });
      });

    this.renderSection(containerEl, t("新しい chat の既定値", "New chat defaults"));
    new Setting(containerEl)
      .setName(t("既定値の概要", "Defaults summary"))
      .setDesc(
        `${t("Model", "Model")}: ${settings.codex.model} · ${t("Thinking", "Thinking")}: ${formatReasoningEffortLabel(
          settings.defaultReasoningEffort,
          locale,
        )} · ${t("Mode", "Mode")}: ${
          getPermissionModeCatalog(locale).find((entry) => entry.mode === settings.permissionMode)?.label ?? settings.permissionMode
        }`,
      );
    this.addModelDropdownSetting(containerEl, t("既定モデル", "Default model"), t("新しい chat tab が最初に使うモデルです。", "Model selected when a new chat tab opens."), settings.codex.model, async (value) => {
      await this.plugin.updateSettings({
        defaultModel: value,
        codex: {
          ...settings.codex,
          model: value,
        },
      });
    });
    new Setting(containerEl)
      .setName(t("既定 Thinking", "Default Thinking"))
      .setDesc(t("新しい chat tab の既定 reasoning level です。", "Default reasoning level for a new chat tab."))
      .addDropdown((component) => {
        for (const effort of REASONING_EFFORT_ORDER) {
          component.addOption(effort, formatReasoningEffortLabel(effort, locale));
        }
        component.setValue(settings.defaultReasoningEffort);
        component.onChange(async (value) => {
          await this.plugin.updateSettings({
            defaultReasoningEffort: value as PluginSettings["defaultReasoningEffort"],
          });
        });
      });
    new Setting(containerEl)
      .setName(t("既定の実行モード", "Default execution mode"))
      .setDesc(t("composer 下部の実行モードの既定値です。", "Default execution mode shown in the composer status bar."))
      .addDropdown((component) => {
        for (const mode of getPermissionModeCatalog(locale)) {
          component.addOption(mode.mode, `${mode.label} · ${mode.description}`);
        }
        component.setValue(settings.permissionMode);
        component.onChange(async (value) => {
          await this.plugin.updateSettings({
            permissionMode: value as PluginSettings["permissionMode"],
          });
        });
      });
    new Setting(containerEl)
      .setName(t("長文脈モデルを優先", "Prefer long-context model"))
      .setDesc(t("既定モデルの選択時に mini より長文脈寄りを優先します。", "When choosing a default automatically, prefer a longer-context model over mini variants."))
      .addToggle((component) => {
        component.setValue(settings.securityPolicy.preferLongContextModel);
        component.onChange(async (value) => {
          await this.plugin.updateSettings({
            securityPolicy: {
              ...settings.securityPolicy,
              preferLongContextModel: value,
            },
          });
        });
      });

    this.renderSection(containerEl, t("ワークスペースのレイアウト", "Workspace layout"));
    new Setting(containerEl)
      .setName(t("ストリーミング中の自動スクロール", "Auto-scroll while streaming"))
      .setDesc(t("assistant が返答中のあいだ transcript を追従します。", "Keep the transcript pinned to the newest output while the assistant is responding."))
      .addToggle((component) => {
        component.setValue(settings.autoScrollStreaming);
        component.onChange(async (value) => {
          await this.plugin.updateSettings({ autoScrollStreaming: value });
        });
      });
    new Setting(containerEl)
      .setName(copy.settings.showReasoningName)
      .setDesc(t("chat transcript に reasoning event を表示します。", "Show reasoning events in the chat transcript."))
      .addToggle((component) => {
        component.setValue(settings.showReasoning);
        component.onChange(async (value) => {
          await this.plugin.updateSettings({ showReasoning: value });
        });
      });
    new Setting(containerEl)
      .setName(copy.settings.autoRestoreTabsName)
      .setDesc(t("workspace を開いたときに保存済みの chat tab を復元します。", "Restore saved chat tabs when the workspace opens."))
      .addToggle((component) => {
        component.setValue(settings.autoRestoreTabs);
        component.onChange(async (value) => {
          await this.plugin.updateSettings({ autoRestoreTabs: value });
        });
      });
    new Setting(containerEl)
      .setName(t("タブバッジの位置", "Tab badges placement"))
      .setDesc(t("chat tabs のバッジをヘッダーか composer 上部に表示します。", "Show chat tab badges in the header or above the composer."))
      .addDropdown((component) => {
        component.addOption("header", t("ヘッダー", "Header"));
        component.addOption("composer", t("入力欄の上", "Above composer"));
        component.setValue(settings.tabBarPosition);
        component.onChange(async (value) => {
          await this.plugin.updateSettings({
            tabBarPosition: value as PluginSettings["tabBarPosition"],
          });
        });
      });
    new Setting(containerEl)
      .setName(t("メインエディタ領域で開く", "Open in main editor area"))
      .setDesc(t("workspace view と対象ノートを中央の main editor tab として開きます。", "Open the workspace view and target notes as main editor tabs."))
      .addToggle((component) => {
        component.setValue(settings.openInMainEditor);
        component.onChange(async (value) => {
          await this.plugin.updateSettings({ openInMainEditor: value });
        });
      });
    this.addTextSetting(
      containerEl,
      t("最大チャットタブ数", "Max chat tabs"),
      t("3 から 10 の範囲で制御します。", "Limit simultaneous chat tabs between 3 and 10."),
      String(settings.maxChatTabs),
      async (value) => {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed)) {
          return;
        }
        await this.plugin.updateSettings({
          maxChatTabs: Math.min(10, Math.max(3, parsed)),
        });
      },
    );

    this.renderSection(containerEl, t("Context とソース", "Context & sources"));
    this.addMultilineEditor(
      containerEl,
      t("除外タグ", "Excluded tags"),
      t("自動コンテキスト収集から外すタグを 1 行に 1 つ。", "Tags to exclude from automatic context capture, one per line."),
      settings.excludedTags,
      async (values) => {
        await this.plugin.updateSettings({ excludedTags: values });
      },
    );
    this.addTextSetting(
      containerEl,
      t("メディアフォルダ", "Media folder"),
      t("相対メディア参照を解決するときの優先フォルダです。", "Preferred folder for resolving relative media references."),
      settings.mediaFolder,
      async (value) => {
        await this.plugin.updateSettings({ mediaFolder: value.trim() });
      },
    );

    this.renderSection(containerEl, t("Assistant の振る舞い", "Assistant behavior"));
    this.addTextSetting(containerEl, t("呼び名", "Preferred name"), t("assistant が直接呼びかけるときの名前です。", "Name used when the assistant addresses you directly."), settings.preferredName, async (value) => {
      await this.plugin.updateSettings({ preferredName: value.trim() });
    });
    this.addPromptEditor(
      containerEl,
      t("カスタムシステムプロンプト", "Custom system prompt"),
      t("既定の runtime 指示のあとに追加される指示です。", "Extra instructions appended after the default runtime prompt."),
      settings.customSystemPrompt,
      async (value) => {
        await this.plugin.updateSettings({ customSystemPrompt: value });
      },
    );
    new Setting(containerEl)
      .setName(t("会話タイトルを自動生成", "Auto-generate conversation titles"))
      .setDesc(t("最初の user prompt から会話タイトルを生成します。", "Generate conversation titles from the first user prompt."))
      .addToggle((component) => {
        component.setValue(settings.autoGenerateTitle);
        component.onChange(async (value) => {
          await this.plugin.updateSettings({ autoGenerateTitle: value });
        });
      });
    this.addMultilineEditor(
      containerEl,
      t("Vim スタイルマッピング", "Vim-style mappings"),
      t("形式: `map <key> <action>`。action は scrollUp / scrollDown / focusInput。", "Format: `map <key> <action>`. Actions: scrollUp / scrollDown / focusInput."),
      settings.vimMappings,
      async (values) => {
        await this.plugin.updateSettings({ vimMappings: values });
      },
    );

    this.renderSection(containerEl, t("Panel Studio と skills", "Panel Studio & skills"));
    this.addMultilineEditor(
      containerEl,
      copy.settings.extraSkillRootsName,
      t("追加で読み込む local skill フォルダです。vault 内とホーム配下の絶対パスを許可します。", "Extra local skill folders to scan. Vault-local paths and absolute paths under your home directory are allowed."),
      settings.extraSkillRoots,
      async (values) => {
        const vaultBasePath = ((this.app.vault as { adapter?: { basePath?: string } }).adapter?.basePath?.trim() ?? "");
        await this.plugin.updateSettings({
          extraSkillRoots: normalizeConfiguredSkillRoots(values, {
            allowedRoots: [vaultBasePath, homedir()],
          }),
        });
      },
    );
    this.renderCustomRecipeSection(containerEl, locale);
    this.renderSkillToggleSection(containerEl, locale);

    this.renderSection(containerEl, t("MCP サーバー", "MCP Servers"));
    this.addJsonEditor(
      containerEl,
      t("MCP servers", "MCP servers"),
      t("JSON 配列で編集します。各要素は {name, command, args, env, enabled}。", "Edit as a JSON array. Each item should contain {name, command, args, env, enabled}."),
      settings.mcpServers,
      async (value) => {
        await this.plugin.updateSettings({ mcpServers: normalizeMcpServers(value) });
      },
    );

    this.renderSection(containerEl, t("セキュリティと shell ガードレール", "Security & shell guardrails"));
    new Setting(containerEl)
      .setName(t("グローバル Codex 資産を継承", "Inherit global Codex assets"))
      .setDesc(t("`~/.codex` と `~/.agents` の prompts / skills / plugin cache を読み込みます。", "Allow prompts, skills, and plugin cache from `~/.codex` and `~/.agents`."))
      .addToggle((component) => {
        component.setValue(settings.securityPolicy.inheritGlobalCodexHomeAssets);
        component.onChange(async (value) => {
          await this.plugin.updateSettings({
            securityPolicy: {
              ...settings.securityPolicy,
              inheritGlobalCodexHomeAssets: value,
            },
          });
        });
      });
    new Setting(containerEl)
      .setName(t("shell ガードレールを有効化", "Enable shell guardrails"))
      .setDesc(t("blocked shell pattern を prompt overlay に渡して危険な実行を避けさせます。", "Pass blocked shell patterns into the runtime prompt overlay so the assistant avoids risky commands."))
      .addToggle((component) => {
        component.setValue(settings.securityPolicy.commandBlacklistEnabled);
        component.onChange(async (value) => {
          await this.plugin.updateSettings({
            securityPolicy: {
              ...settings.securityPolicy,
              commandBlacklistEnabled: value,
            },
          });
        });
      });
    this.addMultilineEditor(
      containerEl,
      t("ブロックされたコマンド (Windows)", "Blocked commands (Windows)"),
      t("1 行に 1 パターン。", "One pattern per line."),
      settings.securityPolicy.blockedCommandsWindows,
      async (values) => {
        await this.plugin.updateSettings({
          securityPolicy: {
            ...settings.securityPolicy,
            blockedCommandsWindows: values,
          },
        });
      },
    );
    this.addMultilineEditor(
      containerEl,
      t("ブロックされたコマンド (Unix/Git Bash)", "Blocked commands (Unix/Git Bash)"),
      t("1 行に 1 パターン。", "One pattern per line."),
      settings.securityPolicy.blockedCommandsUnix,
      async (values) => {
        await this.plugin.updateSettings({
          securityPolicy: {
            ...settings.securityPolicy,
            blockedCommandsUnix: values,
          },
        });
      },
    );

    this.renderSection(containerEl, t("環境", "Environment"));
    this.addMultilineEditor(
      containerEl,
      t("カスタム環境変数", "Custom environment variables"),
      t("`KEY=VALUE` または `export KEY=VALUE` を 1 行に 1 つ。", "One `KEY=VALUE` or `export KEY=VALUE` entry per line."),
      settings.customEnv,
      async (values) => {
        await this.plugin.updateSettings({ customEnv: values });
      },
    );
    this.addJsonEditor(
      containerEl,
      t("環境変数スニペット", "Environment snippets"),
      t("JSON 配列で保存します。各要素は {name, entries[]}。", "Edit as a JSON array. Each item should contain {name, entries[]}."),
      settings.envSnippets,
      async (value) => {
        await this.plugin.updateSettings({ envSnippets: normalizeEnvironmentSnippets(value) });
      },
    );

    this.renderSection(containerEl, t("ホットキー", "Hotkeys"));
    new Setting(containerEl)
      .setName(t("Obsidian のホットキー設定を開く", "Open Obsidian hotkey settings"))
      .setDesc(t("この plugin の command id はそこで割り当てます。", "Assign this plugin’s command ids from Obsidian’s hotkey settings."))
      .addButton((button) => {
        button.setButtonText(t("開く", "Open")).onClick(() => {
          const settingsApp = this.app as typeof this.app & {
            setting?: {
              open: () => void;
              openTabById: (id: string) => void;
            };
          };
          settingsApp.setting?.open();
          settingsApp.setting?.openTabById("hotkeys");
        });
      });
  }

  private renderSection(parent: HTMLElement, title: string): void {
    parent.createEl("h3", { text: title });
  }

  private addTextSetting(
    parent: HTMLElement,
    name: string,
    description: string,
    value: string,
    onChange: (value: string) => Promise<void>,
  ): void {
    new Setting(parent)
      .setName(name)
      .setDesc(description)
      .addText((component) => {
        component.setValue(value);
        component.onChange(async (nextValue) => {
          await onChange(nextValue);
        });
      });
  }

  private addModelDropdownSetting(
    parent: HTMLElement,
    name: string,
    description: string,
    value: string,
    onChange: (value: string) => Promise<void>,
  ): void {
    const models = this.plugin.getAvailableModels();
    const normalizedValue = coerceModelForPicker(models.length > 0 ? models : getFallbackModelCatalog(), value || DEFAULT_PRIMARY_MODEL);

    new Setting(parent)
      .setName(name)
      .setDesc(description)
      .addDropdown((component) => {
        for (const model of models) {
          component.addOption(model.slug, compactModelLabel(model.slug, model.displayName));
        }
        component.setValue(normalizedValue);
        component.onChange(async (nextValue) => {
          await onChange(nextValue);
        });
      });
  }

  private addPromptEditor(
    parent: HTMLElement,
    name: string,
    description: string,
    value: string,
    onSave: (value: string) => Promise<void>,
  ): void {
    new Setting(parent)
      .setName(name)
      .setDesc(description)
      .addButton((button) => {
        button.setButtonText(this.plugin.getResolvedLocale() === "ja" ? "編集" : "Edit").onClick(() => {
          const locale = this.plugin.getResolvedLocale();
          new PromptModal(
            this.app,
            name,
            name,
            (nextValue) => {
              void onSave(nextValue).then(() => this.display());
            },
            description,
            locale === "ja"
              ? { fieldLabel: "内容", cancel: "キャンセル", send: "保存" }
              : { fieldLabel: "Content", cancel: "Cancel", send: "Save" },
            value,
          ).open();
        });
      });
  }

  private addMultilineEditor(
    parent: HTMLElement,
    name: string,
    description: string,
    value: readonly string[],
    onSave: (value: string[]) => Promise<void>,
  ): void {
    this.addPromptEditor(parent, name, description, stringifyMultilineText(value), async (nextValue) => {
      await onSave(parseMultilineText(nextValue));
    });
  }

  private addJsonEditor(
    parent: HTMLElement,
    name: string,
    description: string,
    value: unknown,
    onSave: (value: unknown) => Promise<void>,
  ): void {
    this.addPromptEditor(parent, name, description, JSON.stringify(value, null, 2), async (nextValue) => {
      try {
        const parsed = nextValue.trim() ? JSON.parse(nextValue) : [];
        await onSave(parsed);
      } catch (error) {
        new Notice((error as Error).message);
      }
    });
  }

  private renderCustomRecipeSection(parent: HTMLElement, locale: "en" | "ja"): void {
    const isJa = locale === "ja";
    const recipes = this.plugin.getCustomStudyRecipes();
    new Setting(parent)
      .setName(isJa ? "カスタムコマンド" : "Custom commands")
      .setDesc(isJa ? "Panel Studio 基盤の reusable commands です。" : "Reusable commands backed by the Panel Studio recipe system.")
      .addButton((button) => {
        button.setButtonText(isJa ? "追加" : "Add").onClick(() => {
          this.openRecipeEditor(locale, null);
        });
      });

    for (const recipe of recipes) {
      new Setting(parent)
        .setName(recipe.title || (isJa ? "無題" : "Untitled"))
        .setDesc(`${recipe.commandAlias} · ${recipe.linkedSkillNames.length} ${isJa ? "skills" : "skills"}`)
        .addButton((button) => {
          button.setButtonText(isJa ? "編集" : "Edit").onClick(() => {
            this.openRecipeEditor(locale, recipe);
          });
        })
        .addButton((button) => {
          button.setWarning().setButtonText(isJa ? "削除" : "Delete").onClick(() => {
            this.plugin.removeStudyRecipe(recipe.id);
            this.display();
          });
        });
    }
  }

  private openRecipeEditor(locale: "en" | "ja", recipe: StudyRecipe | null): void {
    new RecipeEditorModal(
      this.app,
      locale,
      recipe ?? {
        title: "",
        description: "",
        commandAlias: "",
        promptTemplate: "",
        linkedSkillNames: [],
      },
      (draft) => {
        const existingAliases = this.plugin
          .getCustomStudyRecipes()
          .filter((entry) => entry.id !== recipe?.id)
          .map((entry) => entry.commandAlias);
        const title = draft.title.trim() || (locale === "ja" ? "カスタムコマンド" : "Custom command");
        const now = Date.now();
        this.plugin.upsertStudyRecipe({
          id: recipe?.id ?? makeId("study-recipe"),
          title,
          description: draft.description.trim(),
          commandAlias: draft.commandAlias.trim() || buildStudyRecipeCommandAlias(title, existingAliases),
          workflow: "custom",
          promptTemplate: draft.promptTemplate,
          linkedSkillNames: normalizeLineList(draft.linkedSkillNames),
          contextContract: recipe?.contextContract ?? {
            summary: "",
            requireTargetNote: false,
            recommendAttachments: false,
            requireSelection: false,
            minimumPinnedContextCount: 0,
          },
          outputContract: recipe?.outputContract ?? [],
          sourceHints: recipe?.sourceHints ?? [],
          exampleSession: recipe?.exampleSession ?? {
            sourceTabTitle: locale === "ja" ? "Codex chat" : "Codex chat",
            targetNotePath: null,
            prompt: "",
            outcomePreview: null,
            createdAt: now,
          },
          promotionState: recipe?.promotionState ?? "captured",
          promotedSkillName: recipe?.promotedSkillName ?? null,
          useCount: recipe?.useCount ?? 0,
          lastUsedAt: recipe?.lastUsedAt ?? null,
          createdAt: recipe?.createdAt ?? now,
          updatedAt: now,
        });
        this.display();
      },
    ).open();
  }

  private renderSkillToggleSection(parent: HTMLElement, locale: "en" | "ja"): void {
    const isJa = locale === "ja";
    const settings = this.plugin.settings;
    const disabled = new Set(settings.pluginOverrides.filter((entry) => entry.enabled === false).map((entry) => entry.key));
    const skills = this.plugin.getInstalledSkills();
    new Setting(parent)
      .setName(isJa ? "インストール済み skills / plugins" : "Installed skills / plugins")
      .setDesc(isJa ? "runtime に露出する skill を個別に切り替えます。" : "Toggle which skills are exposed to the runtime.");
    for (const skill of skills) {
      new Setting(parent)
        .setName(skill.name)
        .setDesc(skill.path)
        .addToggle((component) => {
          component.setValue(!disabled.has(skill.name));
          component.onChange(async (enabled) => {
            const nextOverrides = settings.pluginOverrides.filter((entry) => entry.key !== skill.name);
            if (!enabled) {
              nextOverrides.push({ key: skill.name, enabled: false });
            }
            await this.plugin.updateSettings({ pluginOverrides: nextOverrides });
            this.display();
          });
        });
    }
  }
}
