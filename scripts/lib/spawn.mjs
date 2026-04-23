import { spawn } from "node:child_process";

function formatCommand(command, args) {
  return [command, ...args].join(" ");
}

function createExitError(label, code, signal) {
  const reason = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
  return new Error(`${label} exited with ${reason}.`);
}

export function spawnCommand(command, args, options = {}) {
  return spawn(command, args, options);
}

export function waitForChildExit(child, label = "Child process") {
  if (child.exitCode !== null || child.signalCode !== null) {
    if (child.exitCode === 0) {
      return Promise.resolve();
    }
    return Promise.reject(createExitError(label, child.exitCode, child.signalCode));
  }

  return new Promise((resolve, reject) => {
    const handleError = (error) => {
      cleanup();
      reject(error);
    };
    const handleExit = (code, signal) => {
      cleanup();
      if (code === 0) {
        resolve();
        return;
      }
      reject(createExitError(label, code, signal));
    };
    const cleanup = () => {
      child.off("error", handleError);
      child.off("exit", handleExit);
    };

    child.on("error", handleError);
    child.on("exit", handleExit);
  });
}

export async function runCommand(command, args, options = {}) {
  const child = spawnCommand(command, args, options);
  await waitForChildExit(child, formatCommand(command, args));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function terminateChild(
  child,
  {
    label = "Child process",
    timeoutMs = 5_000,
    graceSignal = "SIGTERM",
    forceSignal = "SIGKILL",
  } = {},
) {
  if (child.exitCode !== null || child.signalCode !== null) {
    try {
      await waitForChildExit(child, label);
    } catch {
      // The caller is shutting down and only needs the child to be gone.
    }
    return;
  }

  const exitPromise = waitForChildExit(child, label).catch(() => undefined);
  child.kill(graceSignal);

  const result = await Promise.race([
    exitPromise.then(() => "exited"),
    delay(timeoutMs).then(() => "timeout"),
  ]);

  if (result === "timeout" && child.exitCode === null && child.signalCode === null) {
    child.kill(forceSignal);
    await exitPromise;
  }
}
