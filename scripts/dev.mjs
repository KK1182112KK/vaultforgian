import path from "node:path";
import { resolveProjectRoot } from "./lib/project-root.mjs";
import { spawnCommand, terminateChild } from "./lib/spawn.mjs";

const projectRoot = resolveProjectRoot(import.meta.url);

function run(command, args) {
  return spawnCommand(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    shell: false,
  });
}

const processes = [
  run(process.execPath, [path.join(projectRoot, "scripts/build-styles.mjs"), "--watch"]),
  run(process.execPath, [path.join(projectRoot, "esbuild.config.mjs"), "dev"]),
];

let shutdownPromise = null;

function shutdown(code = 0) {
  if (!shutdownPromise) {
    shutdownPromise = Promise.all(processes.map((child) => terminateChild(child))).finally(() => {
      process.exit(code);
    });
  }
  return shutdownPromise;
}

process.on("SIGINT", () => {
  void shutdown(130);
});
process.on("SIGTERM", () => {
  void shutdown(143);
});

for (const child of processes) {
  child.on("exit", (code) => {
    if (code && code !== 0) {
      void shutdown(code);
    }
  });
}
