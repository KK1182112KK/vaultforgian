import { DEFAULT_PRIMARY_MODEL } from "../model/types";

const MINIMUM_PRIMARY_MODEL_CODEX_VERSION = "0.125.0";

export interface RuntimeCompatibilityMetadata {
  cliVersion: string | null;
  modelCacheClientVersion: string | null;
}

function normalizeVersionParts(version: string): { numbers: number[]; prerelease: string[] } | null {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) {
    return null;
  }
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split(".") ?? [],
  };
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) {
    return 0;
  }
  if (left.length === 0) {
    return 1;
  }
  if (right.length === 0) {
    return -1;
  }

  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined) {
      return -1;
    }
    if (rightPart === undefined) {
      return 1;
    }
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null;
    if (leftNumber !== null && rightNumber !== null && leftNumber !== rightNumber) {
      return leftNumber - rightNumber;
    }
    if (leftNumber !== null && rightNumber === null) {
      return -1;
    }
    if (leftNumber === null && rightNumber !== null) {
      return 1;
    }
    const textComparison = leftPart.localeCompare(rightPart);
    if (textComparison !== 0) {
      return textComparison;
    }
  }
  return 0;
}

export function parseCodexCliVersion(output: string): string | null {
  const match = output.match(/\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/);
  return match?.[1] ?? null;
}

export function compareCodexVersions(left: string | null | undefined, right: string | null | undefined): number {
  const leftVersion = left ? normalizeVersionParts(left) : null;
  const rightVersion = right ? normalizeVersionParts(right) : null;
  if (!leftVersion && !rightVersion) {
    return 0;
  }
  if (!leftVersion) {
    return -1;
  }
  if (!rightVersion) {
    return 1;
  }

  for (let index = 0; index < 3; index += 1) {
    const difference = (leftVersion.numbers[index] ?? 0) - (rightVersion.numbers[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return comparePrerelease(leftVersion.prerelease, rightVersion.prerelease);
}

export function extractModelCacheClientVersion(input: string): string | null {
  try {
    const parsed = JSON.parse(input) as { client_version?: unknown };
    return typeof parsed.client_version === "string" && parsed.client_version.trim() ? parsed.client_version.trim() : null;
  } catch {
    return null;
  }
}

export function isCodexUpgradeRequiredError(message: string): boolean {
  return /requires a newer version of Codex|upgrade to the latest app or CLI/i.test(message);
}

export function isModelRuntimeCompatible(model: string, metadata: RuntimeCompatibilityMetadata): boolean {
  if (model.trim() !== DEFAULT_PRIMARY_MODEL) {
    return true;
  }
  if (!metadata.cliVersion) {
    return false;
  }
  return compareCodexVersions(metadata.cliVersion, metadata.modelCacheClientVersion ?? MINIMUM_PRIMARY_MODEL_CODEX_VERSION) >= 0;
}
