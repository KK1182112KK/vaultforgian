function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split("\n");
}

type DiffOp =
  | { type: "equal"; line: string }
  | { type: "remove"; line: string }
  | { type: "add"; line: string };

function buildLineOps(beforeLines: string[], afterLines: string[]): DiffOp[] {
  const rows = beforeLines.length;
  const cols = afterLines.length;
  const dp = Array.from({ length: rows + 1 }, () => Array<number>(cols + 1).fill(0));

  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let col = cols - 1; col >= 0; col -= 1) {
      if (beforeLines[row] === afterLines[col]) {
        dp[row]![col] = (dp[row + 1]![col + 1] ?? 0) + 1;
      } else {
        dp[row]![col] = Math.max(dp[row + 1]![col] ?? 0, dp[row]![col + 1] ?? 0);
      }
    }
  }

  const ops: DiffOp[] = [];
  let row = 0;
  let col = 0;
  while (row < rows && col < cols) {
    if (beforeLines[row] === afterLines[col]) {
      ops.push({ type: "equal", line: beforeLines[row]! });
      row += 1;
      col += 1;
      continue;
    }
    if ((dp[row + 1]![col] ?? 0) >= (dp[row]![col + 1] ?? 0)) {
      ops.push({ type: "remove", line: beforeLines[row]! });
      row += 1;
      continue;
    }
    ops.push({ type: "add", line: afterLines[col]! });
    col += 1;
  }

  while (row < rows) {
    ops.push({ type: "remove", line: beforeLines[row]! });
    row += 1;
  }
  while (col < cols) {
    ops.push({ type: "add", line: afterLines[col]! });
    col += 1;
  }
  return ops;
}

export function buildUnifiedDiff(path: string, before: string | null, after: string): string {
  const normalizedBefore = before ?? "";
  if (normalizedBefore === after) {
    return `--- ${path}\n+++ ${path}\n@@\n (no changes)`;
  }

  const beforeLines = splitLines(normalizedBefore);
  const afterLines = splitLines(after);
  const ops = buildLineOps(beforeLines, afterLines);
  const body = ops
    .filter((op) => !(op.type === "equal" && op.line === "" && beforeLines.length === 1 && afterLines.length === 1))
    .map((op) => {
      if (op.type === "equal") {
        return ` ${op.line}`;
      }
      if (op.type === "remove") {
        return `-${op.line}`;
      }
      return `+${op.line}`;
    })
    .join("\n");

  return [`--- ${path}`, `+++ ${path}`, "@@", body].join("\n").trim();
}
