export interface ResolvedEditTarget {
  path: string | null;
  source: "explicit" | "selection" | "active" | "session" | "unresolved";
}

interface ResolveEditTargetOptions {
  explicitTargetPath?: string | null;
  selectionSourcePath?: string | null;
  activeFilePath?: string | null;
  sessionTargetPath?: string | null;
}

function normalizePath(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\\/g, "/") : null;
}

export function resolveEditTarget(options: ResolveEditTargetOptions): ResolvedEditTarget {
  const explicitTargetPath = normalizePath(options.explicitTargetPath);
  if (explicitTargetPath) {
    return { path: explicitTargetPath, source: "explicit" };
  }

  const selectionSourcePath = normalizePath(options.selectionSourcePath);
  if (selectionSourcePath) {
    return { path: selectionSourcePath, source: "selection" };
  }

  const activeFilePath = normalizePath(options.activeFilePath);
  if (activeFilePath) {
    return { path: activeFilePath, source: "active" };
  }

  const sessionTargetPath = normalizePath(options.sessionTargetPath);
  if (sessionTargetPath) {
    return { path: sessionTargetPath, source: "session" };
  }

  return { path: null, source: "unresolved" };
}
