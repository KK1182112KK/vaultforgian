import { readdir, readFile, writeFile } from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";
import { compareStringsLexicographically, resolveProjectRoot } from "./lib/project-root.mjs";

const projectRoot = resolveProjectRoot(import.meta.url);
const sourceDir = path.join(projectRoot, "src/styles");
const outputPath = path.join(projectRoot, "styles.css");
const watchMode = process.argv.includes("--watch");

async function getStyleFiles() {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".css"))
    .map((entry) => entry.name)
    .sort(compareStringsLexicographically);
}

async function buildStyles() {
  const files = await getStyleFiles();
  if (files.length === 0) {
    throw new Error("No style source files found in src/styles.");
  }

  const parts = await Promise.all(files.map((file) => readFile(path.join(sourceDir, file), "utf8")));
  const output = `${parts.map((part) => part.replace(/\s+$/u, "")).join("\n\n")}\n`;
  await writeFile(outputPath, output, "utf8");
  console.log(`Built styles.css from ${files.length} source files.`);
}

await buildStyles();

if (watchMode) {
  let pending = false;
  const trigger = () => {
    if (pending) {
      return;
    }
    pending = true;
    queueMicrotask(async () => {
      pending = false;
      try {
        await buildStyles();
      } catch (error) {
        console.error(error);
      }
    });
  };

  watch(sourceDir, (_, filename) => {
    if (filename?.endsWith(".css")) {
      trigger();
    }
  });
}
