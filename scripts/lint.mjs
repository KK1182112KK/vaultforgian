import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const sourceDirs = ["src", "scripts"];
const standaloneFiles = ["package.json", "manifest.json", "esbuild.config.mjs", "styles.css", "vitest.config.ts"];
const conflictMarkers = [
  { label: "<<<<<<<", pattern: /^<<<<<<< /m },
  { label: "=======", pattern: /^=======$/m },
  { label: ">>>>>>>", pattern: /^>>>>>>> /m },
];

async function collectFiles(targetPath, acc) {
  const targetStat = await stat(targetPath);
  if (targetStat.isDirectory()) {
    const entries = await readdir(targetPath, { withFileTypes: true });
    for (const entry of entries) {
      await collectFiles(path.join(targetPath, entry.name), acc);
    }
    return;
  }
  acc.push(targetPath);
}

async function buildExpectedStyles() {
  const sourceDir = path.join(projectRoot, "src/styles");
  const entries = await readdir(sourceDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".css"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const parts = await Promise.all(files.map((file) => readFile(path.join(sourceDir, file), "utf8")));
  return `${parts.map((part) => part.replace(/\s+$/u, "")).join("\n\n")}\n`;
}

async function main() {
  const files = [];
  for (const dir of sourceDirs) {
    await collectFiles(path.join(projectRoot, dir), files);
  }
  for (const fileName of standaloneFiles) {
    files.push(path.join(projectRoot, fileName));
  }

  for (const filePath of files) {
    const contents = await readFile(filePath, "utf8");
    const marker = conflictMarkers.find((candidate) => candidate.pattern.test(contents));
    if (marker) {
      throw new Error(`Conflict marker ${marker.label} found in ${path.relative(projectRoot, filePath)}`);
    }
  }

  const expectedStyles = await buildExpectedStyles();
  const actualStyles = await readFile(path.join(projectRoot, "styles.css"), "utf8");
  if (expectedStyles !== actualStyles) {
    throw new Error("styles.css is out of sync with src/styles. Run `npm run build:styles`.");
  }

  console.log("Lint passed.");
}

await main();
