const FENCE_RE = /^\s*```/;
const EXISTING_MATH_RE = /(?:^|[^\\])\$|\\\(|\\\[|\\begin\{/;
const RAW_MATH_TOKEN_RE =
  /\\(?:sqrt|frac|cdot|times|pi|alpha|beta|gamma|theta|Delta)\b|[A-Za-z0-9})]\s*\^\s*\{?[A-Za-z0-9]+|[A-Za-z]\s*=\s*\\(?:sqrt|frac)\b|\d+\s*[+\-*/=]\s*\d+|=/;
const LATEX_COMMAND_RE = /\\[A-Za-z]+/g;
const PROSE_EQUATION_RE =
  /^((?:so|therefore|thus|then|now|that means|this means|that gives|this gives)\b\s+)(.+)$/i;
const LINE_PREFIX_RE = /^(\s*(?:(?:[-*+]\s+|\d+[.)]\s+|>\s+)+))(.*)$/;

export type ChatMathSegment =
  | { kind: "text"; text: string }
  | { kind: "math"; text: string; display: boolean };

export interface ChatMathPlaceholder {
  token: string;
  text: string;
  display: boolean;
}

export interface PreparedChatMathMarkdown {
  markdown: string;
  placeholders: ChatMathPlaceholder[];
}

export function normalizeAssistantMathForMarkdown(text: string): string {
  let insideFence = false;
  return text
    .split("\n")
    .map((line) => {
      if (FENCE_RE.test(line)) {
        insideFence = !insideFence;
        return line;
      }
      if (insideFence) {
        return line;
      }
      return normalizeMathLine(line);
    })
    .join("\n");
}

export function prepareChatMarkdownForMathRender(markdown: string): PreparedChatMathMarkdown {
  const placeholders: ChatMathPlaceholder[] = [];
  let insideFence = false;
  const lines = markdown.split("\n").map((line) => {
    if (FENCE_RE.test(line)) {
      insideFence = !insideFence;
      return line;
    }
    if (insideFence) {
      return line;
    }
    return replaceMathOutsideInlineCode(line, placeholders);
  });
  return {
    markdown: lines.join("\n"),
    placeholders,
  };
}

export function splitChatMathSegments(text: string): ChatMathSegment[] {
  const segments: ChatMathSegment[] = [];
  let index = 0;
  let textStart = 0;
  const pushText = (end: number) => {
    if (end > textStart) {
      segments.push({ kind: "text", text: text.slice(textStart, end) });
    }
  };

  while (index < text.length) {
    const char = text[index];
    if (char === "\\" && text[index + 1] === "(") {
      const end = text.indexOf("\\)", index + 2);
      if (end > index + 2) {
        const content = text.slice(index + 2, end);
        if (isRenderableChatMath(content)) {
          pushText(index);
          segments.push({ kind: "math", text: content, display: false });
          index = end + 2;
          textStart = index;
          continue;
        }
      }
    }
    if (char === "\\" && text[index + 1] === "[") {
      const end = text.indexOf("\\]", index + 2);
      if (end > index + 2) {
        const content = text.slice(index + 2, end);
        if (isRenderableChatMath(content)) {
          pushText(index);
          segments.push({ kind: "math", text: content, display: true });
          index = end + 2;
          textStart = index;
          continue;
        }
      }
    }
    if (char === "$" && text[index - 1] !== "\\") {
      const display = text[index + 1] === "$";
      const delimiter = display ? "$$" : "$";
      const contentStart = index + delimiter.length;
      const end = findClosingDollarDelimiter(text, contentStart, delimiter);
      if (end > contentStart) {
        const content = text.slice(contentStart, end);
        if (isRenderableChatMath(content)) {
          pushText(index);
          segments.push({ kind: "math", text: content, display });
          index = end + delimiter.length;
          textStart = index;
          continue;
        }
      }
    }
    index += 1;
  }

  pushText(text.length);
  return segments.length > 0 ? segments : [{ kind: "text", text }];
}

export function renderPreparedChatMathInElement(root: HTMLElement, placeholders: readonly ChatMathPlaceholder[]): void {
  if (placeholders.length === 0) {
    return;
  }
  const byToken = new Map(placeholders.map((placeholder) => [placeholder.token, placeholder]));
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    const textNode = current instanceof Text ? current : null;
    if (textNode && placeholders.some((placeholder) => textNode.data.includes(placeholder.token))) {
      textNodes.push(textNode);
    }
    current = walker.nextNode();
  }

  for (const node of textNodes) {
    const text = node.data;
    if (!placeholders.some((placeholder) => text.includes(placeholder.token))) {
      continue;
    }
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    while (cursor < text.length) {
      const next = findNextPlaceholder(text, cursor, byToken);
      if (!next) {
        fragment.appendChild(document.createTextNode(text.slice(cursor)));
        break;
      }
      if (next.index > cursor) {
        fragment.appendChild(document.createTextNode(text.slice(cursor, next.index)));
      }
      fragment.appendChild(createChatMathElement(next.placeholder));
      cursor = next.index + next.placeholder.token.length;
    }
    node.replaceWith(fragment);
  }
}

export function renderChatMathInElement(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    if (current instanceof Text && shouldProcessMathTextNode(current)) {
      textNodes.push(current);
    }
    current = walker.nextNode();
  }

  for (const node of textNodes) {
    const segments = splitChatMathSegments(node.data);
    if (!segments.some((segment) => segment.kind === "math")) {
      continue;
    }
    const fragment = document.createDocumentFragment();
    for (const segment of segments) {
      if (segment.kind === "text") {
        fragment.appendChild(document.createTextNode(segment.text));
        continue;
      }
      fragment.appendChild(createChatMathElement(segment));
    }
    node.replaceWith(fragment);
  }
}

export function formatChatMathFallback(input: string): string {
  return input
    .trim()
    .replace(/\\text\{([^{}]*)\}/gu, "$1")
    .replace(/\\sqrt\{([^{}]+)\}/gu, (_match, value: string) => `√${formatChatMathFallback(value)}`)
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/gu, (_match, numerator: string, denominator: string) => {
      return `(${formatChatMathFallback(numerator)})/(${formatChatMathFallback(denominator)})`;
    })
    .replace(/\\cdot\b/gu, "·")
    .replace(/\\times\b/gu, "×")
    .replace(/\\pi\b/gu, "π")
    .replace(/\\alpha\b/gu, "α")
    .replace(/\\beta\b/gu, "β")
    .replace(/\\gamma\b/gu, "γ")
    .replace(/\\theta\b/gu, "θ")
    .replace(/\\Delta\b/gu, "Δ")
    .replace(/\^\{([^{}]+)\}/gu, (_match, value: string) => toSuperscript(value))
    .replace(/\^([A-Za-z0-9+\-=()])/gu, (_match, value: string) => toSuperscript(value))
    .replace(/\\([A-Za-z]+)/gu, "$1")
    .replace(/\\([{}])/gu, "$1")
    .replace(/\s+/gu, " ");
}

function replaceMathOutsideInlineCode(line: string, placeholders: ChatMathPlaceholder[]): string {
  let result = "";
  let index = 0;
  while (index < line.length) {
    const nextTick = line.indexOf("`", index);
    if (nextTick < 0) {
      result += replaceMathInText(line.slice(index), placeholders);
      break;
    }
    result += replaceMathInText(line.slice(index, nextTick), placeholders);
    const tickCount = countBacktickRun(line, nextTick);
    const delimiter = "`".repeat(tickCount);
    const closing = line.indexOf(delimiter, nextTick + tickCount);
    if (closing < 0) {
      result += line.slice(nextTick);
      break;
    }
    result += line.slice(nextTick, closing + tickCount);
    index = closing + tickCount;
  }
  return result;
}

function replaceMathInText(text: string, placeholders: ChatMathPlaceholder[]): string {
  const segments = splitChatMathSegments(text);
  if (!segments.some((segment) => segment.kind === "math")) {
    return text;
  }
  return segments
    .map((segment) => {
      if (segment.kind === "text") {
        return segment.text;
      }
      const token = `⟦NOTEFORGE_CHAT_MATH_${placeholders.length}⟧`;
      placeholders.push({
        token,
        text: segment.text,
        display: segment.display,
      });
      return token;
    })
    .join("");
}

function countBacktickRun(text: string, start: number): number {
  let index = start;
  while (text[index] === "`") {
    index += 1;
  }
  return index - start;
}

function findNextPlaceholder(
  text: string,
  start: number,
  byToken: ReadonlyMap<string, ChatMathPlaceholder>,
): { index: number; placeholder: ChatMathPlaceholder } | null {
  let best: { index: number; placeholder: ChatMathPlaceholder } | null = null;
  for (const placeholder of byToken.values()) {
    const index = text.indexOf(placeholder.token, start);
    if (index >= 0 && (!best || index < best.index)) {
      best = { index, placeholder };
    }
  }
  return best;
}

function createChatMathElement(segment: { text: string; display: boolean }): HTMLElement {
  const mathEl = document.createElement("span");
  mathEl.className = `obsidian-codex__chat-math${segment.display ? " obsidian-codex__chat-math--display" : ""}`;
  mathEl.textContent = formatChatMathFallback(segment.text);
  mathEl.title = segment.text.trim();
  return mathEl;
}

function findClosingDollarDelimiter(text: string, start: number, delimiter: "$" | "$$"): number {
  let index = start;
  while (index < text.length) {
    const found = text.indexOf(delimiter, index);
    if (found < 0) {
      return -1;
    }
    if (text[found - 1] !== "\\" && (delimiter === "$$" || text[found + 1] !== "$")) {
      return found;
    }
    index = found + delimiter.length;
  }
  return -1;
}

function isRenderableChatMath(content: string): boolean {
  const normalized = content.trim();
  if (!normalized || /^\d+(?:\.\d+)?$/u.test(normalized)) {
    return false;
  }
  return /\\[A-Za-z]+|\^|_|=|[+\-*/]|[A-Za-z]\d|\d[A-Za-z]/u.test(normalized);
}

function shouldProcessMathTextNode(node: Text): boolean {
  if (!node.data.includes("$") && !node.data.includes("\\(") && !node.data.includes("\\[")) {
    return false;
  }
  const parent = node.parentElement;
  if (!parent) {
    return false;
  }
  return !parent.closest("code, pre, kbd, samp, script, style");
}

function toSuperscript(value: string): string {
  const map: Record<string, string> = {
    "0": "⁰",
    "1": "¹",
    "2": "²",
    "3": "³",
    "4": "⁴",
    "5": "⁵",
    "6": "⁶",
    "7": "⁷",
    "8": "⁸",
    "9": "⁹",
    "+": "⁺",
    "-": "⁻",
    "=": "⁼",
    "(": "⁽",
    ")": "⁾",
    n: "ⁿ",
    i: "ⁱ",
  };
  return [...value].map((char) => map[char] ?? char).join("");
}

function normalizeMathLine(line: string): string {
  if (!line.trim() || line.includes("`") || EXISTING_MATH_RE.test(line) || !RAW_MATH_TOKEN_RE.test(line)) {
    return line;
  }

  const match = line.match(LINE_PREFIX_RE);
  const prefix = match?.[1] ?? "";
  const content = (match?.[2] ?? line).trim();
  if (!content || EXISTING_MATH_RE.test(content) || !RAW_MATH_TOKEN_RE.test(content)) {
    return line;
  }

  const proseEquation = content.match(PROSE_EQUATION_RE);
  if (proseEquation && looksLikeEquationFragment(proseEquation[2] ?? "")) {
    return `${prefix}${proseEquation[1]}$${proseEquation[2]!.trim()}$`;
  }

  if (!looksLikeStandaloneEquation(content)) {
    return line;
  }

  return `${prefix}$${content}$`;
}

function looksLikeEquationFragment(text: string): boolean {
  return /=/.test(text) && RAW_MATH_TOKEN_RE.test(text);
}

function looksLikeStandaloneEquation(text: string): boolean {
  if (!looksLikeEquationFragment(text)) {
    return false;
  }
  const withoutLatexCommands = text.replace(LATEX_COMMAND_RE, "");
  const words = withoutLatexCommands.match(/[A-Za-z]{2,}/g) ?? [];
  return words.length === 0;
}
