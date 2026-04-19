import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const sourceDir = process.cwd();

function formatRelativePath(file) {
  return path.relative(sourceDir, path.join(sourceDir, file)) || file;
}

function buffersMatch(left, right) {
  return left.byteLength === right.byteLength && Buffer.compare(left, right) === 0;
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

  console.log(`Deployed Codex Noteforge to ${targetDir} (${deployedFiles.join(", ")})`);
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
