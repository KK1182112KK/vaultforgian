import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectRoot } from "./lib/project-root.mjs";

const sourceDir = resolveProjectRoot(import.meta.url);

function formatRelativePath(file) {
  return path.relative(sourceDir, path.join(sourceDir, file)) || file;
}

function buffersMatch(left, right) {
  return left.byteLength === right.byteLength && Buffer.compare(left, right) === 0;
}

async function collectSourceFiles(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await collectSourceFiles(fullPath));
      } else if (/\.(ts|tsx|js|mjs|css)$/i.test(entry.name)) {
        files.push(fullPath);
      }
    }
    return files;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function assertBundleFresh() {
  const mainJsPath = path.join(sourceDir, "main.js");
  const mainStat = await stat(mainJsPath);
  const sourceRoots = [
    path.join(sourceDir, "src", "app"),
    path.join(sourceDir, "src", "model"),
    path.join(sourceDir, "src", "styles"),
    path.join(sourceDir, "src", "util"),
    path.join(sourceDir, "src", "views"),
    path.join(sourceDir, "src", "main.ts"),
  ];
  const sourceFiles = (
    await Promise.all(
      sourceRoots.map(async (sourcePath) => {
        try {
          const sourceStat = await stat(sourcePath);
          return sourceStat.isDirectory() ? await collectSourceFiles(sourcePath) : [sourcePath];
        } catch (error) {
          if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            return [];
          }
          throw error;
        }
      }),
    )
  ).flat();
  for (const sourcePath of sourceFiles) {
    const sourceStat = await stat(sourcePath);
    if (sourceStat.mtimeMs > mainStat.mtimeMs) {
      throw new Error(
        `main.js is older than source files (${path.relative(sourceDir, sourcePath)}). Run npm run build:smoke before npm run deploy.`,
      );
    }
  }
}

async function main() {
  const targetDir =
    process.env.CODEX_NOTEFORGE_PLUGIN_DIR?.trim() ||
    process.env.OBSIDIAN_CODEX_STUDY_PLUGIN_DIR?.trim();
  if (!targetDir) {
    throw new Error(
      "Set CODEX_NOTEFORGE_PLUGIN_DIR (or legacy OBSIDIAN_CODEX_STUDY_PLUGIN_DIR) to your Obsidian plugin directory before running npm run deploy.",
    );
  }

  await assertBundleFresh();
  await mkdir(targetDir, { recursive: true });
  const deployedFiles = [];
  for (const file of ["main.js", "manifest.json", "styles.css"]) {
    const sourcePath = path.join(sourceDir, file);
    const targetPath = path.join(targetDir, file);
    const content = await readFile(sourcePath);
    await writeFile(targetPath, content);
    const deployedContent = await readFile(targetPath);
    if (!buffersMatch(content, deployedContent)) {
      throw new Error(`Deploy verification failed for ${formatRelativePath(file)}.`);
    }
    deployedFiles.push(file);
  }

  console.log(`Deployed Codex Noteforge to ${targetDir} (${deployedFiles.join(", ")})`);
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
