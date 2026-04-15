import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const sourceDir = process.cwd();

function formatRelativePath(file) {
  return path.relative(sourceDir, path.join(sourceDir, file)) || file;
}

function buffersMatch(left, right) {
  return left.byteLength === right.byteLength && Buffer.compare(left, right) === 0;
}

async function copyAssetsDirectory(sourcePath, targetPath) {
  await mkdir(targetPath, { recursive: true });
  const entries = await readdir(sourcePath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.endsWith(":Zone.Identifier")) {
      continue;
    }
    const nextSourcePath = path.join(sourcePath, entry.name);
    const nextTargetPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      await copyAssetsDirectory(nextSourcePath, nextTargetPath);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const content = await readFile(nextSourcePath);
    await writeFile(nextTargetPath, content);
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

  const assetsSourcePath = path.join(sourceDir, "assets");
  try {
    const assetsStats = await stat(assetsSourcePath);
    if (assetsStats.isDirectory()) {
      const assetsTargetPath = path.join(targetDir, "assets");
      await rm(assetsTargetPath, { recursive: true, force: true });
      await copyAssetsDirectory(assetsSourcePath, assetsTargetPath);
      deployedFiles.push("assets/");
    }
  } catch {
    // Assets are optional for deploy.
  }

  console.log(`Deployed Codex Noteforge to ${targetDir} (${deployedFiles.join(", ")})`);
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
