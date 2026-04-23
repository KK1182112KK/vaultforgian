import path from "node:path";
import { resolveProjectRoot } from "./lib/project-root.mjs";
import { runCommand } from "./lib/spawn.mjs";

const projectRoot = resolveProjectRoot(import.meta.url);

await runCommand("npm", ["run", "build:bundle"], {
  cwd: projectRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
});
await runCommand(process.execPath, [path.join(projectRoot, "scripts/check-package.mjs")], {
  cwd: projectRoot,
  stdio: "inherit",
});
await runCommand(process.execPath, [path.join(projectRoot, "scripts/load-built-plugin-smoke.mjs")], {
  cwd: projectRoot,
  stdio: "inherit",
});
