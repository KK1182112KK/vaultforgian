import { spawn } from "node:child_process";
import path from "node:path";

const projectRoot = process.cwd();

function run(command, args) {
  return spawn(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    shell: false,
  });
}

const processes = [
  run(process.execPath, [path.join(projectRoot, "scripts/build-styles.mjs"), "--watch"]),
  run(process.execPath, [path.join(projectRoot, "esbuild.config.mjs"), "dev"]),
];

function shutdown(code = 0) {
  for (const child of processes) {
    child.kill("SIGTERM");
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));

for (const child of processes) {
  child.on("exit", (code) => {
    if (code && code !== 0) {
      shutdown(code);
    }
  });
}
