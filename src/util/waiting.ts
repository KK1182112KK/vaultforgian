import type { RuntimeMode, WaitingFocus, WaitingPhase, WaitingState } from "../model/types";

export interface WaitingCopyOptions {
  focus?: WaitingFocus | null;
  locale?: "en" | "ja" | null;
  skillUsage?: WaitingSkillUsage | null;
  suppressSkillPrefix?: boolean;
}

export interface WaitingSkillUsage {
  requiredSkillNames?: readonly string[] | null;
  autoSelectedSkillNames?: readonly string[] | null;
  orderedSkillNames?: readonly string[] | null;
  primarySkillName?: string | null;
  skillCount?: number | null;
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

function normalizeSkillName(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/^\/+/, "") ?? "";
  return normalized || null;
}

function uniqueSkillNames(values: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeSkillName(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function resolveSkillUsageSummary(
  skillUsage: WaitingSkillUsage | null | undefined,
  locale: "en" | "ja",
): string | null {
  if (!skillUsage) {
    return null;
  }
  const required = uniqueSkillNames(skillUsage.requiredSkillNames ?? []);
  const auto = uniqueSkillNames(skillUsage.autoSelectedSkillNames ?? []);
  const ordered = uniqueSkillNames([...(skillUsage.orderedSkillNames ?? []), ...required, ...auto]);
  const primary = normalizeSkillName(skillUsage.primarySkillName) ?? ordered[0] ?? required[0] ?? auto[0] ?? null;
  const count =
    typeof skillUsage.skillCount === "number" && Number.isFinite(skillUsage.skillCount) && skillUsage.skillCount > 0
      ? skillUsage.skillCount
      : uniqueSkillNames([primary, ...ordered]).length;
  if (!primary || count <= 0) {
    return null;
  }
  const visibleSkills = uniqueSkillNames([primary, ...ordered.filter((skillName) => skillName !== primary)]).slice(0, 2);
  const more = Math.max(0, count - visibleSkills.length);
  const suffix = more > 0 ? ` +${more}` : "";
  const skillLabel = visibleSkills.map((skillName) => `/${skillName}`).join(", ");
  const autoOnly = required.length === 0 && auto.length > 0;
  if (locale === "ja") {
    return `${autoOnly ? "提案Skill使用中" : "Skill使用中"}: ${skillLabel}${suffix}`;
  }
  return `${autoOnly ? "Using suggested skills" : "Using skills"}: ${skillLabel}${suffix}`;
}

function stripSkillPrefix(text: string): string {
  return text
    .replace(/^Calling skill\s*·\s*/u, "")
    .replace(/^skill を呼び出しています\s*·\s*/u, "")
    .replace(/^Using(?: suggested)?\s+\/.+?\s*·\s*/u, "")
    .replace(/^(?:Skill使用中|提案Skill使用中):\s*\/.+?\s*·\s*/u, "")
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
  const locale = normalizeWaitingLocale(options.locale);
  const suppressSkillPrefix = options.suppressSkillPrefix === true;
  const skillSummary = suppressSkillPrefix ? null : resolveSkillUsageSummary(options.skillUsage, locale);
  if (phase === "tools" && options.focus) {
    const focusedPhrase = FOCUSED_WAITING_COPY[options.focus][locale];
    return skillSummary ? `${skillSummary} · ${focusedPhrase}` : focusedPhrase;
  }
  const phrases = WAITING_COPY[locale][phase];
  const prefix =
    skillSummary ??
    (!suppressSkillPrefix && mode === "skill" && phase === "tools"
      ? locale === "en"
        ? "Calling skill"
        : "skill を呼び出しています"
      : "");
  const seed = hash(`${phase}:${mode}:${entropy}`);
  const phrase = phrases[seed % phrases.length] ?? phrases[0] ?? (locale === "en" ? "Thinking" : "考えています");
  return prefix ? `${prefix} · ${phrase}` : phrase;
}

export function formatWaitingSkillUsageTitle(
  waitingState: WaitingState | null | undefined,
  locale: "en" | "ja" = "en",
): string | null {
  if (!waitingState) {
    return null;
  }
  const required = uniqueSkillNames(waitingState.requiredSkillNames ?? []);
  const auto = uniqueSkillNames(waitingState.autoSelectedSkillNames ?? []);
  if (required.length === 0 && auto.length === 0) {
    return null;
  }
  const format = (values: readonly string[]) => values.map((value) => `/${value}`).join(", ");
  if (locale === "ja") {
    return [
      required.length > 0 ? `必須: ${format(required)}` : null,
      auto.length > 0 ? `自動: ${format(auto)}` : null,
    ]
      .filter((entry): entry is string => Boolean(entry))
      .join("。");
  }
  return [
    required.length > 0 ? `Required: ${format(required)}` : null,
    auto.length > 0 ? `Auto: ${format(auto)}` : null,
  ]
    .filter((entry): entry is string => Boolean(entry))
    .join(". ");
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
    skillUsage: waitingState,
    suppressSkillPrefix: waitingState.suppressSkillPrefix === true,
  });
}
