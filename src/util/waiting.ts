import type { RuntimeMode, WaitingPhase } from "../model/types";

const WAITING_COPY: Record<WaitingPhase, string[]> = {
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
};

function hash(input: string): number {
  let value = 0;
  for (const char of input) {
    value = (value * 31 + char.charCodeAt(0)) >>> 0;
  }
  return value;
}

export function pickWaitingCopy(phase: WaitingPhase, mode: RuntimeMode, entropy = Date.now()): string {
  const phrases = WAITING_COPY[phase];
  const prefix = mode === "skill" && phase === "tools" ? "skill を呼び出しています" : "";
  const seed = hash(`${phase}:${mode}:${entropy}`);
  const phrase = phrases[seed % phrases.length] ?? phrases[0] ?? "考えています";
  return prefix ? `${prefix} · ${phrase}` : phrase;
}
