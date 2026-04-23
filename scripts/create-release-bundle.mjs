import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createDeterministicZip } from "./lib/deterministic-zip.mjs";
import { resolveProjectRoot } from "./lib/project-root.mjs";

const projectRoot = resolveProjectRoot(import.meta.url);

function normalizeVersion(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function assertReadable(filePath) {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile() || fileStat.size === 0) {
    throw new Error(`Expected non-empty file: ${path.relative(projectRoot, filePath)}`);
  }
}

function listZipEntries(buffer) {
  const eocdSignature = 0x06054b50;
  const centralDirectorySignature = 0x02014b50;
  let eocdOffset = -1;
  for (let index = buffer.length - 22; index >= 0; index -= 1) {
    if (buffer.readUInt32LE(index) === eocdSignature) {
      eocdOffset = index;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error("Release zip is missing the end-of-central-directory marker.");
  }

  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = [];
  let cursor = centralDirectoryOffset;
  const end = centralDirectoryOffset + centralDirectorySize;
  while (cursor < end) {
    if (buffer.readUInt32LE(cursor) !== centralDirectorySignature) {
      throw new Error("Release zip central directory is malformed.");
    }
    const fileNameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const fileName = buffer.toString("utf8", cursor + 46, cursor + 46 + fileNameLength);
    entries.push(fileName);
    cursor += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

async function assertReleaseArchiveContents(outputZipPath, pluginId) {
  const zipBuffer = await readFile(outputZipPath);
  const entries = listZipEntries(zipBuffer);
  const requiredEntries = [
    `${pluginId}/main.js`,
    `${pluginId}/manifest.json`,
    `${pluginId}/styles.css`,
  ];
  for (const entry of requiredEntries) {
    if (!entries.includes(entry)) {
      throw new Error(`Release zip is missing required entry: ${entry}`);
    }
  }
  const fileEntries = entries.filter((entry) => entry && !entry.endsWith("/"));
  const unexpectedEntries = fileEntries.filter((entry) => !requiredEntries.includes(entry));
  if (unexpectedEntries.length > 0) {
    throw new Error(`Release zip contains unexpected entries: ${unexpectedEntries.join(", ")}`);
  }
}

async function main() {
  const packageJsonPath = path.join(projectRoot, "package.json");
  const manifestPath = path.join(projectRoot, "manifest.json");
  const mainJsPath = path.join(projectRoot, "main.js");
  const stylesPath = path.join(projectRoot, "styles.css");
  const releaseDir = path.join(projectRoot, "release");

  await Promise.all([
    assertReadable(packageJsonPath),
    assertReadable(manifestPath),
    assertReadable(mainJsPath),
    assertReadable(stylesPath),
  ]);

  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const packageVersion = normalizeVersion(packageJson?.version);
  const manifestVersion = normalizeVersion(manifest?.version);
  const pluginId = normalizeVersion(manifest?.id);
  if (!packageVersion || !manifestVersion || packageVersion !== manifestVersion) {
    throw new Error("package.json and manifest.json must exist and share the same version before bundling a release.");
  }
  if (!pluginId) {
    throw new Error("manifest.json must include a stable plugin id before bundling a release.");
  }

  await mkdir(releaseDir, { recursive: true });
  const zipFileName = `${pluginId}-v${manifestVersion}.zip`;
  const outputZipPath = path.join(releaseDir, zipFileName);
  const zipBuffer = createDeterministicZip([
    {
      name: `${pluginId}/main.js`,
      data: await readFile(mainJsPath),
    },
    {
      name: `${pluginId}/manifest.json`,
      data: await readFile(manifestPath),
    },
    {
      name: `${pluginId}/styles.css`,
      data: await readFile(stylesPath),
    },
  ]);

  await writeFile(outputZipPath, zipBuffer);

  await assertReadable(outputZipPath);
  await assertReleaseArchiveContents(outputZipPath, pluginId);
  console.log(`Created release bundle at ${outputZipPath}`);
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
