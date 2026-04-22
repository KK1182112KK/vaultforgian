export function buildPatchMathFormattingRules(): string[] {
  return [
    "Reserve single-dollar math for inline expressions only.",
    "Multi-line display math MUST use `$$` on their own lines.",
    "Never use standalone single `$` lines as display-math delimiters.",
    "Leave a blank line before and after display-math blocks when they touch prose, headings, lists, or blockquotes.",
    "Never concatenate a closing math delimiter with `>`, `-`, `*`, or `#` on the same line.",
  ];
}

export function buildQuotedPatchMathFormattingRules(): string[] {
  return [
    "Inside callouts and blockquotes, every line of the rewritten block must keep its `>` prefix.",
    "Display math inside callouts and blockquotes must use standalone quoted delimiters such as `> $$`.",
    "Quoted blank lines must surround quoted display-math blocks inside callouts and blockquotes.",
    "Do not emit quoted or unquoted delimiter collisions such as `$>`, `$$>`, `$#`, `$-`, or `$*`.",
  ];
}

export function buildDelimiterPatchExample(targetPath: string): string {
  return [
    "```obsidian-patch",
    `path: ${targetPath}`,
    "kind: update",
    "summary: Normalize display math and surrounding wording in the target section",
    `evidence: vault_note|Current note|${targetPath}|This section should keep display math on standalone $$ lines.`,
    "",
    "---anchorBefore",
    "## Core Equations",
    "The key inequality is",
    "---anchorAfter",
    "Follows from Theorem 5.",
    "---replacement",
    "## Core Equations",
    "",
    "The key inequality is",
    "",
    "$$",
    "\\|e(t)\\|^2 \\leq C\\|e(0)\\|^2 e^{-\\alpha t}",
    "$$",
    "",
    "Follows from Theorem 5.",
    "---end",
    "```",
  ].join("\n");
}
