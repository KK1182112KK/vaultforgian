import path from "node:path";
import { resolveProjectRoot } from "./lib/project-root.mjs";
import { spawnCommand } from "./lib/spawn.mjs";

const projectRoot = resolveProjectRoot(import.meta.url);
const builderScript = path.join(projectRoot, "scripts", "build-avatar.py");
const passthroughArgs = process.argv.slice(2);

const interpreterCandidates = [
  { command: "python3", prefixArgs: [] },
  { command: "python", prefixArgs: [] },
  { command: "py", prefixArgs: ["-3"] },
];

function isMissingExecutable(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function createExitError(label, code, signal, stdout, stderr) {
  const reason = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
  const error = new Error(`${label} exited with ${reason}.`);
  error.code = code ?? undefined;
  error.signal = signal ?? undefined;
  error.stdout = stdout;
  error.stderr = stderr;
  return error;
}

function getErrorText(error) {
  if (!(error instanceof Error)) {
    return String(error);
  }
  return [error.message, error.stdout, error.stderr]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join("\n");
}

function isInterpreterEnvironmentFailure(error) {
  if (isMissingExecutable(error)) {
    return true;
  }
  const text = getErrorText(error);
  return (
    /pillow is required to build the assistant avatar/i.test(text) ||
    /no module named ['"]?PIL['"]?/i.test(text) ||
    (/importerror/i.test(text) && /PIL|Pillow/i.test(text))
  );
}

async function runInterpreterCandidate(candidate) {
  const args = [...candidate.prefixArgs, builderScript, ...passthroughArgs];
  const label = [candidate.command, ...args].join(" ");
  const child = spawnCommand(candidate.command, args, {
    cwd: projectRoot,
    stdio: ["inherit", "pipe", "pipe"],
    shell: false,
  });

  let stdout = "";
  let stderr = "";
  const forwardChunk = (writer, chunk) => {
    writer.write(chunk);
    return typeof chunk === "string" ? chunk : chunk.toString("utf8");
  };

  child.stdout?.on("data", (chunk) => {
    stdout += forwardChunk(process.stdout, chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr += forwardChunk(process.stderr, chunk);
  });

  await new Promise((resolve, reject) => {
    const handleError = (error) => {
      cleanup();
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    };
    const handleExit = (code, signal) => {
      cleanup();
      if (code === 0) {
        resolve();
        return;
      }
      reject(createExitError(label, code, signal, stdout, stderr));
    };
    const cleanup = () => {
      child.off("error", handleError);
      child.off("exit", handleExit);
    };

    child.on("error", handleError);
    child.on("exit", handleExit);
  });
}

async function main() {
  const interpreterFailures = [];
  for (const candidate of interpreterCandidates) {
    try {
      await runInterpreterCandidate(candidate);
      return;
    } catch (error) {
      if (isInterpreterEnvironmentFailure(error)) {
        interpreterFailures.push({ candidate, error });
        continue;
      }
      throw error;
    }
  }

  const lastFailure = interpreterFailures.at(-1)?.error;
  const detail = lastFailure ? ` Last failure: ${getErrorText(lastFailure)}` : "";
  throw new Error(`Could not find a usable Python 3 interpreter. Tried: python3, python, py -3.${detail}`);
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
