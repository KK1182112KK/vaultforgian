import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_LOCAL_SETTINGS,
  DEFAULT_SECURITY_POLICY_SETTINGS,
  DEFAULT_VAULT_SETTINGS,
  type EnvironmentSnippet,
  type LocalSettings,
  type McpServerConfig,
  type PluginCatalogOverride,
  type PluginSettings,
  type SecurityPolicySettings,
  type TabBarPosition,
  type VaultSettings,
} from "../model/types";
import { makeId } from "./id";
import { normalizeConfiguredSkillRoots } from "./skillRoots";

const LOCAL_SETTINGS_DIR = join(homedir(), ".codex", "noteforge");
export const LOCAL_SETTINGS_PATH = join(LOCAL_SETTINGS_DIR, "local-settings.json");
const LOCAL_SETTINGS_VERSION = 1;

interface LocalSettingsFileShape {
  version?: number;
  settings?: Partial<LocalSettings>;
}

function normalizeLineEntry(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeLineList(values: readonly unknown[] | null | undefined): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const value of values ?? []) {
    const normalized = normalizeLineEntry(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    lines.push(normalized);
  }
  return lines;
}

export function parseMultilineText(value: string): string[] {
  return normalizeLineList(value.split(/\r?\n/u));
}

export function stringifyMultilineText(values: readonly string[]): string {
  return normalizeLineList(values).join("\n");
}

export function normalizeTabBarPosition(value: unknown): TabBarPosition {
  return value === "composer" ? "composer" : "header";
}

export function clampMaxChatTabs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_VAULT_SETTINGS.maxChatTabs;
  }
  return Math.min(10, Math.max(3, Math.round(value)));
}

function normalizeMcpServerConfig(value: unknown): McpServerConfig | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const name = normalizeLineEntry(record.name) || normalizeLineEntry(record.id);
  if (!name) {
    return null;
  }
  return {
    id: normalizeLineEntry(record.id) || makeId("mcp"),
    name,
    transport: "stdio",
    command: normalizeLineEntry(record.command),
    args: Array.isArray(record.args) ? normalizeLineList(record.args) : [],
    env: Array.isArray(record.env) ? normalizeLineList(record.env) : [],
    enabled: record.enabled !== false,
  };
}

export function normalizeMcpServers(values: unknown): McpServerConfig[] {
  const seen = new Set<string>();
  const servers: McpServerConfig[] = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = normalizeMcpServerConfig(value);
    if (!normalized || seen.has(normalized.id)) {
      continue;
    }
    seen.add(normalized.id);
    servers.push(normalized);
  }
  return servers;
}

function normalizeEnvironmentSnippet(value: unknown): EnvironmentSnippet | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const name = normalizeLineEntry(record.name);
  if (!name) {
    return null;
  }
  const now = Date.now();
  return {
    id: normalizeLineEntry(record.id) || makeId("env-snippet"),
    name,
    entries: Array.isArray(record.entries) ? normalizeLineList(record.entries) : [],
    createdAt: typeof record.createdAt === "number" ? record.createdAt : now,
    updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : now,
  };
}

export function normalizeEnvironmentSnippets(values: unknown): EnvironmentSnippet[] {
  const seen = new Set<string>();
  const snippets: EnvironmentSnippet[] = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = normalizeEnvironmentSnippet(value);
    if (!normalized || seen.has(normalized.id)) {
      continue;
    }
    seen.add(normalized.id);
    snippets.push(normalized);
  }
  return snippets;
}

function normalizePluginCatalogOverride(value: unknown): PluginCatalogOverride | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const key = normalizeLineEntry(record.key);
  if (!key) {
    return null;
  }
  return {
    key,
    enabled: record.enabled !== false,
  };
}

export function normalizePluginCatalogOverrides(values: unknown): PluginCatalogOverride[] {
  const seen = new Set<string>();
  const overrides: PluginCatalogOverride[] = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = normalizePluginCatalogOverride(value);
    if (!normalized || seen.has(normalized.key)) {
      continue;
    }
    seen.add(normalized.key);
    overrides.push(normalized);
  }
  return overrides;
}

export function normalizeSecurityPolicySettings(value: unknown): SecurityPolicySettings {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    inheritGlobalCodexHomeAssets: record.inheritGlobalCodexHomeAssets !== false,
    commandBlacklistEnabled: record.commandBlacklistEnabled === true,
    blockedCommandsWindows: Array.isArray(record.blockedCommandsWindows)
      ? normalizeLineList(record.blockedCommandsWindows)
      : [...DEFAULT_SECURITY_POLICY_SETTINGS.blockedCommandsWindows],
    blockedCommandsUnix: Array.isArray(record.blockedCommandsUnix)
      ? normalizeLineList(record.blockedCommandsUnix)
      : [...DEFAULT_SECURITY_POLICY_SETTINGS.blockedCommandsUnix],
    allowedExportPaths: Array.isArray(record.allowedExportPaths) ? normalizeLineList(record.allowedExportPaths) : [],
    browserIntegrationEnabled: record.browserIntegrationEnabled !== false,
    preferLongContextModel: record.preferLongContextModel === true,
  };
}

export function normalizeLocalSettings(
  value: Partial<LocalSettings> | null | undefined,
  options: { allowedRoots?: readonly string[] } = {},
): LocalSettings {
  return {
    extraSkillRoots: normalizeConfiguredSkillRoots(value?.extraSkillRoots ?? [], {
      allowedRoots: options.allowedRoots,
    }),
    codex: {
      ...DEFAULT_LOCAL_SETTINGS.codex,
      ...(value?.codex ?? {}),
    },
    mcpServers: normalizeMcpServers(value?.mcpServers),
    pluginOverrides: normalizePluginCatalogOverrides(value?.pluginOverrides),
    securityPolicy: normalizeSecurityPolicySettings(value?.securityPolicy),
    customEnv: normalizeLineList(value?.customEnv ?? []),
    envSnippets: normalizeEnvironmentSnippets(value?.envSnippets),
  };
}

export function extractVaultSettings(settings: PluginSettings): VaultSettings {
  return {
    defaultModel: settings.defaultModel,
    defaultReasoningEffort: settings.defaultReasoningEffort,
    permissionMode: settings.permissionMode,
    uiLanguage: settings.uiLanguage,
    onboardingVersionSeen: settings.onboardingVersionSeen,
    autoApplyConsentVersionSeen: settings.autoApplyConsentVersionSeen,
    preferredName: settings.preferredName,
    excludedTags: [...settings.excludedTags],
    mediaFolder: settings.mediaFolder,
    customSystemPrompt: settings.customSystemPrompt,
    autoScrollStreaming: settings.autoScrollStreaming,
    autoGenerateTitle: settings.autoGenerateTitle,
    titleGenerationModel: settings.titleGenerationModel,
    vimMappings: [...settings.vimMappings],
    tabBarPosition: settings.tabBarPosition,
    openInMainEditor: settings.openInMainEditor,
    maxChatTabs: settings.maxChatTabs,
    showReasoning: settings.showReasoning,
    autoRestoreTabs: settings.autoRestoreTabs,
  };
}

export function extractLocalSettings(settings: PluginSettings): LocalSettings {
  return {
    extraSkillRoots: [...settings.extraSkillRoots],
    codex: {
      ...settings.codex,
    },
    mcpServers: settings.mcpServers.map((server) => ({
      ...server,
      args: [...server.args],
      env: [...server.env],
    })),
    pluginOverrides: settings.pluginOverrides.map((override) => ({ ...override })),
    securityPolicy: {
      ...settings.securityPolicy,
      blockedCommandsWindows: [...settings.securityPolicy.blockedCommandsWindows],
      blockedCommandsUnix: [...settings.securityPolicy.blockedCommandsUnix],
      allowedExportPaths: [...settings.securityPolicy.allowedExportPaths],
    },
    customEnv: [...settings.customEnv],
    envSnippets: settings.envSnippets.map((snippet) => ({
      ...snippet,
      entries: [...snippet.entries],
    })),
  };
}

export function combineSettings(vaultSettings: VaultSettings, localSettings: LocalSettings): PluginSettings {
  return {
    ...vaultSettings,
    ...localSettings,
    codex: {
      ...localSettings.codex,
    },
    securityPolicy: {
      ...localSettings.securityPolicy,
      blockedCommandsWindows: [...localSettings.securityPolicy.blockedCommandsWindows],
      blockedCommandsUnix: [...localSettings.securityPolicy.blockedCommandsUnix],
      allowedExportPaths: [...localSettings.securityPolicy.allowedExportPaths],
    },
    mcpServers: localSettings.mcpServers.map((server) => ({
      ...server,
      args: [...server.args],
      env: [...server.env],
    })),
    pluginOverrides: localSettings.pluginOverrides.map((override) => ({ ...override })),
    customEnv: [...localSettings.customEnv],
    envSnippets: localSettings.envSnippets.map((snippet) => ({
      ...snippet,
      entries: [...snippet.entries],
    })),
  };
}

export async function readLocalSettingsFile(): Promise<Partial<LocalSettings>> {
  try {
    const raw = await fs.readFile(LOCAL_SETTINGS_PATH, "utf8");
    const parsed = JSON.parse(raw) as LocalSettingsFileShape;
    return parsed.settings ?? {};
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

export async function writeLocalSettingsFile(settings: LocalSettings): Promise<void> {
  await fs.mkdir(LOCAL_SETTINGS_DIR, { recursive: true });
  await fs.writeFile(
    LOCAL_SETTINGS_PATH,
    JSON.stringify(
      {
        version: LOCAL_SETTINGS_VERSION,
        settings,
      } satisfies LocalSettingsFileShape,
      null,
      2,
    ),
    "utf8",
  );
}

export function parseEnvironmentEntries(entries: readonly string[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const rawEntry of entries) {
    const entry = rawEntry.trim().replace(/^export\s+/u, "");
    const separatorIndex = entry.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = entry.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) {
      continue;
    }
    env[key] = entry.slice(separatorIndex + 1).trim();
  }
  return env;
}

