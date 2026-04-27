import type { RuntimeMode, WaitingFocus, WaitingPhase, WaitingState } from "../model/types";

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
      "Opening the study map",
      "Warming up the workspace",
      "Lining up the first move",
      "Tuning the compass",
      "Sharpening the pencils",
      "Flipping to the right page",
      "Setting the desk light",
    ],
    reasoning: [
      "Reshaping the answer",
      "Sorting the key points",
      "Building the response",
      "Connecting the dots",
      "Stacking the ideas neatly",
      "Checking the logic trail",
      "Finding the clean path",
      "Balancing examples and detail",
      "Turning notes into signal",
      "Sketching the answer shape",
    ],
    tools: [
      "Checking the vault",
      "Collecting the needed context",
      "Preparing the changes",
      "Opening the right drawers",
      "Sorting the source cards",
      "Picking up the useful fragments",
      "Tracing the note trail",
      "Staging the next move",
      "Checking the workbench",
      "Aligning the context pieces",
    ],
    finalizing: [
      "Finishing the reply",
      "Polishing the final line",
      "Wrapping up",
      "Tightening the wording",
      "Putting the pieces in order",
      "Checking the landing",
      "Smoothing the last edge",
      "Packing the answer neatly",
      "Making it readable",
      "Setting down the final card",
    ],
  },
  ja: {
    boot: [
      "入口を見つけています",
      "手がかりを集めています",
      "文脈をほどいています",
      "学習マップを広げています",
      "作業台を温めています",
      "最初の一手を並べています",
      "コンパスを合わせています",
      "鉛筆を削っています",
      "ちょうどいいページを開いています",
      "机のライトをつけています",
    ],
    reasoning: [
      "考えを組み替えています",
      "論点を並べ替えています",
      "答えの骨組みを作っています",
      "点と点をつないでいます",
      "アイデアをきれいに積んでいます",
      "論理の足跡を確認しています",
      "いちばん通りやすい道を探しています",
      "例と詳しさのバランスを見ています",
      "ノートをシグナルに変換しています",
      "返答の形をスケッチしています",
    ],
    tools: [
      "Vault を見にいっています",
      "必要な材料を拾っています",
      "変更点を整えています",
      "必要な引き出しを開けています",
      "ソースカードを並べています",
      "使える断片を拾っています",
      "ノートの足跡をたどっています",
      "次の一手を準備しています",
      "作業台を確認しています",
      "文脈のピースを合わせています",
    ],
    finalizing: [
      "返答を仕上げています",
      "最後の一文を磨いています",
      "着地を整えています",
      "言葉を少し締めています",
      "ピースを順番に戻しています",
      "着地点を確認しています",
      "最後の角をならしています",
      "答えをきれいに包んでいます",
      "読みやすさを整えています",
      "最後のカードを置いています",
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

function normalizeWaitingLocale(locale: "en" | "ja" | null | undefined): "en" | "ja" {
  return locale === "ja" ? "ja" : "en";
}

function stripSkillPrefix(text: string): string {
  return text
    .replace(/^Calling skill\s*·\s*/u, "")
    .replace(/^skill を呼び出しています\s*·\s*/u, "")
    .trim();
}

function inferFocusedWaitingCopy(text: string): WaitingFocus | null {
  const normalized = text.trim();
  for (const focus of Object.keys(FOCUSED_WAITING_COPY) as WaitingFocus[]) {
    if (Object.values(FOCUSED_WAITING_COPY[focus]).includes(normalized)) {
      return focus;
    }
  }
  return null;
}

function isKnownGeneratedWaitingCopy(text: string): boolean {
  const normalized = stripSkillPrefix(text);
  if (inferFocusedWaitingCopy(normalized)) {
    return true;
  }
  return (Object.keys(WAITING_COPY) as Array<"en" | "ja">).some((locale) =>
    (Object.keys(WAITING_COPY[locale]) as WaitingPhase[]).some((phase) => WAITING_COPY[locale][phase].includes(normalized)),
  );
}

function hasJapaneseText(text: string): boolean {
  return /[ぁ-んァ-ン一-龥]/u.test(text);
}

function hasAsciiLetter(text: string): boolean {
  return /[A-Za-z]/u.test(text);
}

function isWaitingTextCompatibleWithLocale(text: string, locale: "en" | "ja"): boolean {
  return locale === "en" ? !hasJapaneseText(text) : !hasAsciiLetter(stripSkillPrefix(text));
}

export function pickWaitingCopy(
  phase: WaitingPhase,
  mode: RuntimeMode,
  entropy = Date.now(),
  options: WaitingCopyOptions = {},
): string {
  if (phase === "tools" && options.focus) {
    return FOCUSED_WAITING_COPY[options.focus][normalizeWaitingLocale(options.locale)];
  }
  const locale = normalizeWaitingLocale(options.locale);
  const phrases = WAITING_COPY[locale][phase];
  const prefix = mode === "skill" && phase === "tools" ? (locale === "en" ? "Calling skill" : "skill を呼び出しています") : "";
  const seed = hash(`${phase}:${mode}:${entropy}`);
  const phrase = phrases[seed % phrases.length] ?? phrases[0] ?? (locale === "en" ? "Thinking" : "考えています");
  return prefix ? `${prefix} · ${phrase}` : phrase;
}

export function resolveWaitingStateText(
  waitingState: WaitingState,
  fallbackMode: RuntimeMode,
  locale: "en" | "ja",
): string {
  const nextLocale = normalizeWaitingLocale(locale);
  if (waitingState.locale === nextLocale && isWaitingTextCompatibleWithLocale(waitingState.text, nextLocale)) {
    return waitingState.text;
  }

  const focus = waitingState.focus ?? inferFocusedWaitingCopy(waitingState.text);
  const generated = Boolean(waitingState.mode || waitingState.locale || focus || isKnownGeneratedWaitingCopy(waitingState.text));
  if (!generated) {
    return waitingState.text;
  }

  return pickWaitingCopy(waitingState.phase, waitingState.mode ?? fallbackMode, hash(waitingState.text), {
    focus,
    locale: nextLocale,
  });
}
