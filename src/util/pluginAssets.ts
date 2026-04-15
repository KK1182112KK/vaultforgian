import { normalizePath, type App } from "obsidian";

export const CHAT_ICON_ASSET_PATH = "assets/Gemini_Generated_Image_n5otwzn5otwzn5ot.png";
const PLUGIN_ID = "obsidian-codex-study";

export function getPluginAssetUrl(app: App, relativePath: string): string | null {
  const vault = app.vault as typeof app.vault & {
    configDir?: string;
    adapter?: {
      getResourcePath?: (path: string) => string;
      getFilePath?: (path: string) => string;
    };
  };
  const configDir = vault.configDir;
  const getResourcePath = vault.adapter?.getResourcePath;
  const normalizedPath = configDir ? normalizePath(`${configDir}/plugins/${PLUGIN_ID}/${relativePath}`) : null;
  if (!normalizedPath) {
    return null;
  }
  if (typeof getResourcePath === "function") {
    const resourcePath = getResourcePath(normalizedPath);
    if (resourcePath) {
      return resourcePath;
    }
  }
  const getFilePath = vault.adapter?.getFilePath;
  if (typeof getFilePath === "function") {
    const filePath = getFilePath(normalizedPath);
    if (filePath) {
      return filePath;
    }
  }
  return null;
}
