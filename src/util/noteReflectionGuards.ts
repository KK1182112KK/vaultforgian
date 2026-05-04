export const EXPLICIT_NOTE_REFLECTION_REQUEST_PATTERNS: RegExp[] = [
  /\b(?:rewrite|revise|edit|update|apply|reflect|add|insert)\b.{0,64}\b(?:this|it|that|note|section|explanation|content)\b/iu,
  /\b(?:this|it|that|note|section|explanation|content)\b.{0,64}\b(?:rewrite|revise|edit|update|apply|reflect|add|insert)\b/iu,
  /\b(?:apply|reflect|add|insert)\b.{0,32}\b(?:to|in)\s+(?:the\s+)?note\b/iu,
  /(?:この|今の|その)?(?:内容|説明|回答|整理|ノート).{0,48}(?:ノート)?(?:に|へ)?(?:反映|適用|追記|追加|書き換え|修正|編集)(?:して|してください|して下さい|する)?/u,
  /(?:ノート|メモ).{0,48}(?:反映|適用|追記|追加|書き換え|修正|編集)(?:して|してください|して下さい|する)?/u,
];

const TRAILING_NOTE_REFLECTION_INVITATION_PATTERNS: RegExp[] = [
  /^(?:want me to|would you like me to|do you want me to|should i)\s+(?:rewrite|revise|edit|update|apply|reflect|add|insert|turn)\b[\s\S]{0,280}\b(?:note|notes?|\.md|section|content|this|it|that)\b[\s\S]*\?\s*$/iu,
  /^(?:want me to|would you like me to|do you want me to|should i)\s+(?:apply|reflect)\s+(?:this|it|that)\s+(?:to|in)\s+(?:the\s+)?note\b[\s\S]*\?\s*$/iu,
  /^(?:want me to|would you like me to|do you want me to|should i)\s+turn\b[\s\S]{0,200}\binto\b[\s\S]{0,120}\b(?:note|notes?|\.md)\b[\s\S]*\?\s*$/iu,
  /^(?:この|今の|その)?(?:内容|説明|回答|整理|要約)?[\s\S]{0,180}(?:ノート|メモ)[\s\S]{0,140}(?:反映|適用|追記|追加|書き換え|書き直し|修正|編集)[\s\S]{0,100}(?:か|ますか|しましょうか|でしょうか)[？?]?\s*$/u,
  /^(?:ノート|メモ)[\s\S]{0,160}(?:反映|適用|追記|追加|書き換え|書き直し|修正|編集)[\s\S]{0,100}(?:か|ますか|しましょうか|でしょうか)[？?]?\s*$/u,
];

interface MarkdownBlock {
  start: number;
  end: number;
  hasFence: boolean;
}

export function isExplicitNoteReflectionRequestText(text: string): boolean {
  const promptText = text.trim();
  return Boolean(promptText && EXPLICIT_NOTE_REFLECTION_REQUEST_PATTERNS.some((pattern) => pattern.test(promptText)));
}

export function shouldSuppressSkillNoteSuggestions(mode: string, prompt: string): boolean {
  return mode === "skill" && !isExplicitNoteReflectionRequestText(prompt);
}

export function isTrailingNoteReflectionInvitationText(text: string): boolean {
  const normalized = text.trim();
  return Boolean(normalized && TRAILING_NOTE_REFLECTION_INVITATION_PATTERNS.some((pattern) => pattern.test(normalized)));
}

export function stripTrailingNoteReflectionInvitation(text: string): string {
  if (!text.trim() || /```(?:obsidian-patch|obsidian-ops)\b/iu.test(text)) {
    return text;
  }
  const blocks = splitMarkdownBlocks(text);
  const last = [...blocks].reverse().find((block) => text.slice(block.start, block.end).trim());
  if (!last || last.hasFence) {
    return text;
  }
  const trailing = text.slice(last.start, last.end).trim();
  if (!isTrailingNoteReflectionInvitationText(trailing)) {
    return stripTrailingNoteReflectionInvitationLines(text);
  }
  return text.slice(0, last.start).trimEnd();
}

function stripTrailingNoteReflectionInvitationLines(text: string): string {
  const lines = text.split("\n");
  let lastNonBlankIndex = lines.length - 1;
  while (lastNonBlankIndex >= 0 && !lines[lastNonBlankIndex]?.trim()) {
    lastNonBlankIndex -= 1;
  }
  if (lastNonBlankIndex < 0) {
    return text;
  }

  const earliestStart = Math.max(0, lastNonBlankIndex - 4);
  for (let start = lastNonBlankIndex; start >= earliestStart; start -= 1) {
    const candidate = lines.slice(start, lastNonBlankIndex + 1).join("\n").trim();
    if (isTrailingNoteReflectionInvitationText(candidate)) {
      return lines.slice(0, start).join("\n").trimEnd();
    }
  }
  return text;
}

function splitMarkdownBlocks(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = text.split(/(?<=\n)/u);
  let offset = 0;
  let inFence = false;
  let currentStart: number | null = null;
  let currentEnd = 0;
  let currentHasFence = false;

  const pushCurrent = () => {
    if (currentStart === null) {
      return;
    }
    blocks.push({ start: currentStart, end: currentEnd, hasFence: currentHasFence });
    currentStart = null;
    currentEnd = 0;
    currentHasFence = false;
  };

  for (const line of lines) {
    const lineStart = offset;
    const lineEnd = offset + line.length;
    const withoutNewline = line.replace(/\n$/u, "");
    const isFenceLine = /^\s*```/u.test(withoutNewline);
    const isBlankOutsideFence = !inFence && withoutNewline.trim() === "";

    if (isBlankOutsideFence) {
      pushCurrent();
      offset = lineEnd;
      continue;
    }

    if (currentStart === null) {
      currentStart = lineStart;
    }
    currentEnd = lineEnd;
    currentHasFence = currentHasFence || inFence || isFenceLine;

    if (isFenceLine) {
      inFence = !inFence;
    }
    offset = lineEnd;
  }
  pushCurrent();
  return blocks;
}
