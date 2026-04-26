import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
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

async function assertBundleFresh(mainJsPath) {
  const mainStat = await stat(mainJsPath);
  const sourceRoots = [
    path.join(projectRoot, "src", "app"),
    path.join(projectRoot, "src", "model"),
    path.join(projectRoot, "src", "styles"),
    path.join(projectRoot, "src", "util"),
    path.join(projectRoot, "src", "views"),
    path.join(projectRoot, "src", "main.ts"),
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
        `main.js is older than source files (${path.relative(projectRoot, sourcePath)}). Run npm run build:smoke before npm run release:bundle.`,
      );
    }
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
  await assertBundleFresh(mainJsPath);

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
