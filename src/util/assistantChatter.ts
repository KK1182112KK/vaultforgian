const OPERATIONAL_CONTEXT_PATTERNS = [
  /local read/iu,
  /local source/iu,
  /shell/iu,
  /sandbox/iu,
  /source bundle/iu,
  /staging path/iu,
  /minimal command/iu,
  /folder structure/iu,
  /directory contents/iu,
  /\.pdf\b/iu,
  /ローカル読/i,
  /シェル/iu,
  /source acquisition/iu,
  /sandbox 初期化/iu,
  /source bundle/iu,
  /同フォルダ構成/iu,
  /フォルダ構成/iu,
  /ディレクトリ/iu,
];

const OPERATIONAL_ACTION_PATTERNS = [
  /retry/iu,
  /re-read/iu,
  /inspect/iu,
  /confirm/iu,
  /failed/iu,
  /failure/iu,
  /cannot/iu,
  /unable/iu,
  /confirmします/iu,
  /再試行/iu,
  /確認/iu,
  /失敗/iu,
  /試し/iu,
  /弾かれ/iu,
  /列挙/iu,
  /取得/iu,
  /読め/iu,
  /開け/iu,
  /inspect/iu,
  /open/iu,
  /read/iu,
];

const OPERATIONAL_STATUS_PATTERNS = [
  /command not found/iu,
  /cannot access local files/iu,
  /this turn cannot access local files/iu,
  /source bundle .*received/iu,
  /source bundle として受け取りました/iu,
  /対象ノートの現状を確認して/iu,
  /ノート本文と同フォルダ構成を順に確認/iu,
  /現時点では.*読めていません/iu,
  /このターンでは.*読めていません/iu,
  /shell 自体の初期化/iu,
  /sandbox 側/iu,
  /sandbox 初期化/iu,
  /起動条件を変えて再試行/iu,
  /最小コマンドで確認/iu,
  /ローカルアクセスがまだ通っていません/iu,
  /vault 内のファイルにアクセスできない/iu,
  /現時点ではまだ .*読めていません/iu,
];

const INTERNAL_REWRITE_FOLLOWUP_START_PATTERN =
  /^Turn your immediately previous assistant answer in this same thread into exactly one obsidian-patch block\.$/imu;

const INTERNAL_REWRITE_TARGET_RESOLUTION_PATTERNS = [
  /^Target resolution order for this rewrite:/imu,
  /^Target the current session target note if one is set; otherwise target the active note for this turn\.$/imu,
];

const INTERNAL_REWRITE_FOLLOWUP_REQUIRED_PATTERNS = [
  INTERNAL_REWRITE_FOLLOWUP_START_PATTERN,
  /^Apply the Formatting bundle:/imu,
  /^Add concise evidence lines to the patch header when possible/imu,
  /^Do not ask whether to apply the change\./imu,
];

const PROPOSAL_REPAIR_SCAFFOLDING_PATTERNS = [
  INTERNAL_REWRITE_FOLLOWUP_START_PATTERN,
  ...INTERNAL_REWRITE_TARGET_RESOLUTION_PATTERNS,
  /^If a selection snapshot is attached,/imu,
  /^Apply the Formatting bundle:/imu,
  /^Add concise evidence lines to the patch header when possible/imu,
  /^Prefer vault-note and attachment evidence first\./imu,
  /^Do not ask whether to apply the change\./imu,
  /^Assistant answer to convert:/imu,
  /^Output exactly one fenced .*obsidian-patch.* block/imu,
];

function normalizeBlock(block: string): string {
  return block.replace(/\s+/gu, " ").trim();
}

function isOperationalChatterBlock(block: string): boolean {
  const normalized = normalizeBlock(block);
  if (!normalized) {
    return false;
  }
  if (OPERATIONAL_STATUS_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }
  return (
    OPERATIONAL_CONTEXT_PATTERNS.some((pattern) => pattern.test(normalized)) &&
    OPERATIONAL_ACTION_PATTERNS.some((pattern) => pattern.test(normalized))
  );
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function stripAssistantAnswerPrefix(line: string): string | null {
  const marker = "Assistant answer to convert:";
  if (!line.trim().startsWith(marker)) {
    return line;
  }
  const remainder = line.trim().slice(marker.length).trim();
  return remainder || null;
}

function stripProposalRepairScaffolding(text: string): string {
  if (!PROPOSAL_REPAIR_SCAFFOLDING_PATTERNS.some((pattern) => pattern.test(text))) {
    return text;
  }
  const lines = normalizeNewlines(text).split("\n");
  const kept: string[] = [];
  let inCodeFence = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^```/u.test(trimmed)) {
      inCodeFence = !inCodeFence;
      kept.push(line);
      continue;
    }
    if (inCodeFence) {
      kept.push(line);
      continue;
    }
    if (!trimmed) {
      kept.push("");
      continue;
    }
    const stripped = stripAssistantAnswerPrefix(line);
    if (stripped === null) {
      continue;
    }
    if (PROPOSAL_REPAIR_SCAFFOLDING_PATTERNS.some((pattern) => pattern.test(stripped.trim()))) {
      continue;
    }
    kept.push(stripped);
  }

  return kept.join("\n").replace(/\n{3,}/gu, "\n\n").trim();
}

export function isInternalRewriteFollowupPrompt(text: string | null | undefined): boolean {
  if (!text?.trim()) {
    return false;
  }
  const normalized = normalizeNewlines(text).trim();
  return INTERNAL_REWRITE_FOLLOWUP_REQUIRED_PATTERNS.every((pattern) => pattern.test(normalized));
}

export function normalizeVisibleUserPromptText(
  text: string,
  rewriteFollowupLabel: string,
  internalPromptKind: string | null | undefined = null,
): string {
  if (internalPromptKind === "rewrite_followup" || isInternalRewriteFollowupPrompt(text)) {
    return rewriteFollowupLabel;
  }
  return text;
}

export function sanitizeOperationalAssistantText(text: string): string | null {
  const sanitizedText = stripProposalRepairScaffolding(text);
  const blocks = sanitizedText
    .split(/\n{2,}/u)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length === 0) {
    return null;
  }

  const kept = blocks.filter((block) => !isOperationalChatterBlock(block));
  if (kept.length === 0) {
    return null;
  }

  return kept.join("\n\n").trim() || null;
}

export function hasMeaningfulAssistantText(text: string | null | undefined): boolean {
  return Boolean(text && sanitizeOperationalAssistantText(text));
}
