const FENCE_RE = /^\s*```/;
const EXISTING_MATH_RE = /(?:^|[^\\])\$|\\\(|\\\[|\\begin\{/;
const RAW_MATH_TOKEN_RE =
  /\\(?:sqrt|frac|cdot|times|pi|alpha|beta|gamma|theta|Delta)\b|[A-Za-z0-9})]\s*\^\s*\{?[A-Za-z0-9]+|[A-Za-z]\s*=\s*\\(?:sqrt|frac)\b|\d+\s*[+\-*/=]\s*\d+|=/;
const LATEX_COMMAND_RE = /\\[A-Za-z]+/g;
const PROSE_EQUATION_RE =
  /^((?:so|therefore|thus|then|now|that means|this means|that gives|this gives)\b\s+)(.+)$/i;
const LINE_PREFIX_RE = /^(\s*(?:(?:[-*+]\s+|\d+[.)]\s+|>\s+)+))(.*)$/;
const CHAT_MATH_TOKEN_PREFIX = "NFCODEXCHATMATH";
const CHAT_MATH_PLACEHOLDER_CLASS = "obsidian-codex__chat-math-placeholder";
const CHAT_MATH_PLACEHOLDER_TOKEN_ATTR = "data-codex-chat-math-token";
const CHAT_MATH_PLACEHOLDER_SELECTOR = `[${CHAT_MATH_PLACEHOLDER_TOKEN_ATTR}]`;
const CHAT_MATH_FULL_PLACEHOLDER_TOKEN_RE = /^NFCODEXCHATMATH[a-z0-9]+X\d+TOKEN$/iu;
const CHAT_MATH_VISIBLE_PLACEHOLDER_RE = /NFCODEXCHATMATH[a-z0-9]*/giu;
const RAW_CHAT_MATH_SENTINEL_RE =
  /<span\b[^>]*(?:obsidian-codex__chat-math-placeholder|data-codex-chat-math-token)[^>]*>\s*<\/span>/giu;
const CHAT_MATH_RENDER_SELECTOR = ".obsidian-codex__chat-math, .katex, mjx-container, .math";
const ELEMENT_NODE_TYPE = 1;
const TEXT_NODE_TYPE = 3;
const SHOW_TEXT_NODES = 4;

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

interface ChatMathTextSpan {
  node: Text;
  start: number;
  end: number;
}

interface ChatMathTextPosition {
  node: Text;
  offset: number;
}

interface ChatMathPlaceholderMatch {
  start: number;
  end: number;
  placeholder: ChatMathPlaceholder;
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
  const tokenNonce = createChatMathTokenNonce();
  let insideFence = false;
  const lines = markdown.split("\n").map((line) => {
    if (FENCE_RE.test(line)) {
      insideFence = !insideFence;
      return line;
    }
    if (insideFence) {
      return line;
    }
    return replaceMathOutsideInlineCode(line, placeholders, tokenNonce);
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
  const placeholderByToken = createPlaceholderMap(placeholders);
  replaceRenderedChatMathSentinels(root, placeholderByToken);
  replaceRawChatMathSentinels(root, placeholderByToken);
  if (placeholders.length > 0) {
    replacePreparedChatMathPlaceholders(root, placeholders);
  }

  renderChatMathInElement(root);
  replaceRenderedChatMathSentinels(root, placeholderByToken);
  replaceRawChatMathSentinels(root, placeholderByToken);
  scrubRemainingChatMathPlaceholders(root, placeholderByToken);
}

export function renderChatMathInElement(root: HTMLElement): void {
  const ownerDocument = getOwnerDocument(root);
  const walker = createTextWalker(root);
  const textNodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    if (isTextNode(current) && shouldProcessMathTextNode(current)) {
      textNodes.push(current);
    }
    current = walker.nextNode();
  }

  for (const node of textNodes) {
    const segments = splitChatMathSegments(node.data);
    if (!segments.some((segment) => segment.kind === "math")) {
      continue;
    }
    const fragment = ownerDocument.createDocumentFragment();
    for (const segment of segments) {
      if (segment.kind === "text") {
        fragment.appendChild(ownerDocument.createTextNode(segment.text));
        continue;
      }
      fragment.appendChild(createChatMathElement(segment, ownerDocument));
    }
    node.replaceWith(fragment);
  }

  cleanupChatMathDelimitersInElement(root);
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

function replaceMathOutsideInlineCode(line: string, placeholders: ChatMathPlaceholder[], tokenNonce: string): string {
  let result = "";
  let index = 0;
  while (index < line.length) {
    const nextTick = line.indexOf("`", index);
    if (nextTick < 0) {
      result += replaceMathInText(line.slice(index), placeholders, tokenNonce);
      break;
    }
    result += replaceMathInText(line.slice(index, nextTick), placeholders, tokenNonce);
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

function replaceMathInText(text: string, placeholders: ChatMathPlaceholder[], tokenNonce: string): string {
  const segments = splitChatMathSegments(text);
  if (!segments.some((segment) => segment.kind === "math")) {
    return text;
  }
  return segments
    .map((segment) => {
      if (segment.kind === "text") {
        return segment.text;
      }
      const token = `${CHAT_MATH_TOKEN_PREFIX}${tokenNonce}X${placeholders.length}TOKEN`;
      placeholders.push({
        token,
        text: segment.text,
        display: segment.display,
      });
      return createChatMathPlaceholderSentinel(token);
    })
    .join("");
}

function createChatMathPlaceholderSentinel(token: string): string {
  return `<span class="${CHAT_MATH_PLACEHOLDER_CLASS}" ${CHAT_MATH_PLACEHOLDER_TOKEN_ATTR}="${token}"></span>`;
}

function createPlaceholderMap(placeholders: readonly ChatMathPlaceholder[]): ReadonlyMap<string, ChatMathPlaceholder> {
  return new Map(placeholders.map((placeholder) => [placeholder.token, placeholder]));
}

function createChatMathTokenNonce(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID().replace(/-/gu, "");
  }
  if (cryptoApi?.getRandomValues) {
    const values = new Uint32Array(2);
    cryptoApi.getRandomValues(values);
    return Array.from(values, (value) => value.toString(36).padStart(7, "0")).join("");
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`.replace(/[^a-z0-9]/giu, "");
}

function countBacktickRun(text: string, start: number): number {
  let index = start;
  while (text[index] === "`") {
    index += 1;
  }
  return index - start;
}

function replacePreparedChatMathPlaceholders(root: HTMLElement, placeholders: readonly ChatMathPlaceholder[]): void {
  const ownerDocument = getOwnerDocument(root);
  const spans = collectChatMathTextSpans(root);
  const text = spans.map((span) => span.node.data).join("");
  if (!text || !placeholders.some((placeholder) => text.includes(placeholder.token))) {
    return;
  }

  const matches = findPlaceholderMatches(text, placeholders);
  for (const match of [...matches].reverse()) {
    const start = findTextPosition(spans, match.start, "start");
    const end = findTextPosition(spans, match.end, "end");
    if (!start || !end || !start.node.parentNode || !end.node.parentNode) {
      continue;
    }
    const range = ownerDocument.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    range.deleteContents();
    range.insertNode(createChatMathElement(match.placeholder, ownerDocument));
    range.detach();
  }
}

function collectChatMathTextSpans(root: HTMLElement): ChatMathTextSpan[] {
  const walker = createTextWalker(root);
  const spans: ChatMathTextSpan[] = [];
  let offset = 0;
  let current = walker.nextNode();
  while (current) {
    const textNode = isTextNode(current) ? current : null;
    if (textNode && shouldIncludeChatMathTextSpan(textNode)) {
      const start = offset;
      offset += textNode.data.length;
      spans.push({ node: textNode, start, end: offset });
    }
    current = walker.nextNode();
  }
  return spans;
}

function findPlaceholderMatches(
  text: string,
  placeholders: readonly ChatMathPlaceholder[],
): ChatMathPlaceholderMatch[] {
  return placeholders
    .flatMap((placeholder) => {
      const matches: ChatMathPlaceholderMatch[] = [];
      let start = text.indexOf(placeholder.token);
      while (start >= 0) {
        matches.push({
          start,
          end: start + placeholder.token.length,
          placeholder,
        });
        start = text.indexOf(placeholder.token, start + placeholder.token.length);
      }
      return matches;
    })
    .sort((left, right) => left.start - right.start);
}

function findTextPosition(
  spans: readonly ChatMathTextSpan[],
  offset: number,
  affinity: "start" | "end",
): ChatMathTextPosition | null {
  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index]!;
    if (offset < span.end) {
      return { node: span.node, offset: offset - span.start };
    }
    if (offset === span.end) {
      const nextSpan = spans[index + 1] ?? null;
      if (affinity === "start" && nextSpan?.start === offset) {
        continue;
      }
      return { node: span.node, offset: span.node.data.length };
    }
  }
  return null;
}

function createChatMathElement(segment: { text: string; display: boolean }, ownerDocument: Document): HTMLElement {
  const mathEl = ownerDocument.createElement("span");
  mathEl.className = `obsidian-codex__chat-math${segment.display ? " obsidian-codex__chat-math--display" : ""}`;
  mathEl.textContent = formatChatMathFallback(segment.text);
  mathEl.title = segment.text.trim();
  return mathEl;
}

function replaceRenderedChatMathSentinels(
  root: HTMLElement,
  placeholderByToken: ReadonlyMap<string, ChatMathPlaceholder>,
): void {
  const ownerDocument = getOwnerDocument(root);
  const sentinels = Array.from(root.querySelectorAll<HTMLElement>(CHAT_MATH_PLACEHOLDER_SELECTOR));
  for (const sentinel of sentinels) {
    if (sentinel.closest("code, pre, kbd, samp, script, style, .obsidian-codex__chat-math")) {
      continue;
    }
    const token = sentinel.getAttribute(CHAT_MATH_PLACEHOLDER_TOKEN_ATTR) ?? "";
    const placeholder = CHAT_MATH_FULL_PLACEHOLDER_TOKEN_RE.test(token) ? placeholderByToken.get(token) : null;
    if (placeholder) {
      sentinel.replaceWith(createChatMathElement(placeholder, ownerDocument));
      continue;
    }
    sentinel.remove();
  }
}

function replaceRawChatMathSentinels(
  root: HTMLElement,
  placeholderByToken: ReadonlyMap<string, ChatMathPlaceholder>,
): void {
  const spans = collectChatMathTextSpans(root);
  const text = spans.map((span) => span.node.data).join("");
  if (!text.includes("obsidian-codex__chat-math-placeholder") && !text.includes("data-codex-chat-math-token")) {
    return;
  }

  const matches: ChatMathPlaceholderMatch[] = [];
  for (const match of text.matchAll(RAW_CHAT_MATH_SENTINEL_RE)) {
    const rawSentinel = match[0];
    const start = match.index;
    const token = rawSentinel.match(CHAT_MATH_VISIBLE_PLACEHOLDER_RE)?.[0] ?? "";
    if (typeof start !== "number") {
      continue;
    }
    matches.push({
      start,
      end: start + rawSentinel.length,
      placeholder: placeholderByToken.get(token) ?? {
        token,
        text: "",
        display: false,
      },
    });
  }
  replaceChatMathTextMatches(root, spans, matches);
}

function scrubRemainingChatMathPlaceholders(
  root: HTMLElement,
  placeholderByToken: ReadonlyMap<string, ChatMathPlaceholder>,
): void {
  replaceRawChatMathSentinels(root, placeholderByToken);
  const spans = collectChatMathTextSpans(root);
  const text = spans.map((span) => span.node.data).join("");
  if (!text) {
    return;
  }

  const matches: ChatMathPlaceholderMatch[] = [];
  for (const match of text.matchAll(CHAT_MATH_VISIBLE_PLACEHOLDER_RE)) {
    const token = match[0];
    const start = match.index;
    if (typeof start !== "number") {
      continue;
    }
    matches.push({
      start,
      end: start + token.length,
      placeholder: placeholderByToken.get(token) ?? {
        token,
        text: "",
        display: false,
      },
    });
  }
  replaceChatMathTextMatches(root, spans, matches);
}

function replaceChatMathTextMatches(
  root: HTMLElement,
  spans: readonly ChatMathTextSpan[],
  matches: readonly ChatMathPlaceholderMatch[],
): void {
  if (matches.length === 0) {
    return;
  }
  const ownerDocument = getOwnerDocument(root);
  for (const match of [...matches].reverse()) {
    const start = findTextPosition(spans, match.start, "start");
    const end = findTextPosition(spans, match.end, "end");
    if (!start || !end || !start.node.parentNode || !end.node.parentNode) {
      continue;
    }
    const range = ownerDocument.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    range.deleteContents();
    if (match.placeholder.text) {
      range.insertNode(createChatMathElement(match.placeholder, ownerDocument));
    }
    range.detach();
  }
}

function cleanupChatMathDelimitersInElement(root: HTMLElement): void {
  const walker = createTextWalker(root);
  const textNodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    if (isTextNode(current) && shouldConsiderDelimiterCleanup(current)) {
      textNodes.push(current);
    }
    current = walker.nextNode();
  }

  for (const node of textNodes) {
    if (!node.parentNode || !isDollarDelimiterText(node.data)) {
      continue;
    }
    if (!hasNearbyRenderedMath(node)) {
      continue;
    }
    const withoutDelimiter = node.data.replace(/\${1,2}/gu, "");
    if (withoutDelimiter.length > 0) {
      node.data = withoutDelimiter;
    } else {
      node.remove();
    }
  }
}

function shouldConsiderDelimiterCleanup(node: Text): boolean {
  if (!node.data.includes("$")) {
    return false;
  }
  const parent = node.parentElement;
  if (!parent) {
    return false;
  }
  return !parent.closest("code, pre, kbd, samp, script, style, .obsidian-codex__chat-math");
}

function isDollarDelimiterText(text: string): boolean {
  return /^\s*\${1,2}\s*$/u.test(text);
}

function hasNearbyRenderedMath(node: Text): boolean {
  const parent = node.parentElement;
  if (!parent) {
    return false;
  }
  if (parent.matches(CHAT_MATH_RENDER_SELECTOR) || parent.querySelector(CHAT_MATH_RENDER_SELECTOR)) {
    return true;
  }
  const previous = findAdjacentSignificantNode(node, "previous");
  if (previous && isRenderedMathNode(previous)) {
    return true;
  }
  const next = findAdjacentSignificantNode(node, "next");
  return Boolean(next && isRenderedMathNode(next));
}

function findAdjacentSignificantNode(node: Node, direction: "previous" | "next"): Node | null {
  let current: Node | null = direction === "previous" ? node.previousSibling : node.nextSibling;
  while (current) {
    if (isTextNode(current)) {
      if (current.data.trim().length > 0) {
        return current;
      }
    } else {
      return current;
    }
    current = direction === "previous" ? current.previousSibling : current.nextSibling;
  }
  return null;
}

function isRenderedMathNode(node: Node): boolean {
  if (!isElementNode(node)) {
    return false;
  }
  return node.matches(CHAT_MATH_RENDER_SELECTOR) || Boolean(node.querySelector(CHAT_MATH_RENDER_SELECTOR));
}

function createTextWalker(root: HTMLElement): TreeWalker {
  return getOwnerDocument(root).createTreeWalker(root, SHOW_TEXT_NODES);
}

function getOwnerDocument(root: Node): Document {
  return root.ownerDocument ?? document;
}

function isTextNode(node: Node): node is Text {
  return node.nodeType === TEXT_NODE_TYPE;
}

function isElementNode(node: Node): node is Element {
  return node.nodeType === ELEMENT_NODE_TYPE;
}

function shouldIncludeChatMathTextSpan(node: Text): boolean {
  const parent = node.parentElement;
  if (!parent) {
    return false;
  }
  return !parent.closest("code, pre, kbd, samp, script, style, .obsidian-codex__chat-math");
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
