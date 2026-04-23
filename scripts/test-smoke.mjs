import { resolveProjectRoot } from "./lib/project-root.mjs";
import { runCommand } from "./lib/spawn.mjs";

const projectRoot = resolveProjectRoot(import.meta.url);

await runCommand("npx", [
  "vitest",
  "run",
  "src/tests/ui/panelStudioComposerFlow.test.ts",
  "src/tests/usageSyncCoordinator.test.ts",
], {
  cwd: projectRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
});
