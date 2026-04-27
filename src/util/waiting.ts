import type { RuntimeMode, WaitingPhase } from "../model/types";

export type WaitingFocus = "note_context" | "patch_safety" | "readability" | "repair";

export interface WaitingCopyOptions {
  focus?: WaitingFocus | null;
  locale?: "en" | "ja" | null;
}

const WAITING_COPY: Record<"en" | "ja", Record<WaitingPhase, string[]>> = {
  en: {
    boot: [
      "Finding the entry point",
      "Gathering clues",
      "Untangling the context",
    ],
    reasoning: [
      "Reshaping the answer",
      "Sorting the key points",
      "Building the response",
    ],
    tools: [
      "Checking the vault",
      "Collecting the needed context",
      "Preparing the changes",
    ],
    finalizing: [
      "Finishing the reply",
      "Polishing the final line",
      "Wrapping up",
    ],
  },
  ja: {
    boot: [
      "入口を見つけています",
      "手がかりを集めています",
      "文脈をほどいています",
    ],
    reasoning: [
      "考えを組み替えています",
      "論点を並べ替えています",
      "答えの骨組みを作っています",
    ],
    tools: [
      "Vault を見にいっています",
      "必要な材料を拾っています",
      "変更点を整えています",
    ],
    finalizing: [
      "返答を仕上げています",
      "最後の一文を磨いています",
      "着地を整えています",
    ],
  },
};

const FOCUSED_WAITING_COPY: Record<WaitingFocus, Record<"en" | "ja", string>> = {
  note_context: {
    en: "Checking note context",
    ja: "ノートを確認しています",
  },
  patch_safety: {
    en: "Checking note safety",
    ja: "ノート変更の安全性を確認しています",
  },
  readability: {
    en: "Checking Markdown readability",
    ja: "Markdown の可読性を確認しています",
  },
  repair: {
    en: "Repairing the change proposal",
    ja: "変更案を回復しています",
  },
};

function hash(input: string): number {
  let value = 0;
  for (const char of input) {
    value = (value * 31 + char.charCodeAt(0)) >>> 0;
  }
  return value;
}

export function pickWaitingCopy(
  phase: WaitingPhase,
  mode: RuntimeMode,
  entropy = Date.now(),
  options: WaitingCopyOptions = {},
): string {
  if (phase === "tools" && options.focus) {
    return FOCUSED_WAITING_COPY[options.focus][options.locale === "en" ? "en" : "ja"];
  }
  const locale = options.locale === "en" ? "en" : "ja";
  const phrases = WAITING_COPY[locale][phase];
  const prefix = mode === "skill" && phase === "tools" ? (locale === "en" ? "Calling skill" : "skill を呼び出しています") : "";
  const seed = hash(`${phase}:${mode}:${entropy}`);
  const phrase = phrases[seed % phrases.length] ?? phrases[0] ?? (locale === "en" ? "Thinking" : "考えています");
  return prefix ? `${prefix} · ${phrase}` : phrase;
}
