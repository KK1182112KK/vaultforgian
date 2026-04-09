import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const sourceDir = process.cwd();
const targetDir =
  process.env.OBSIDIAN_CODEX_STUDY_PLUGIN_DIR ??
  "/mnt/c/Obsidian/My brain sync/.obsidian/plugins/obsidian-codex-study";

function formatRelativePath(file) {
  return path.relative(sourceDir, path.join(sourceDir, file)) || file;
}

function buffersMatch(left, right) {
  return left.byteLength === right.byteLength && Buffer.compare(left, right) === 0;
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

console.log(`Deployed Obsidian Codex Study to ${targetDir} (${deployedFiles.join(", ")})`);
