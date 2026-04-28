export type SkillOrchestrationPhase =
  | "brainstorm"
  | "plan"
  | "source_read"
  | "analyze"
  | "execute"
  | "verify"
  | "finish"
  | "support";

export interface SkillOrchestrationStep {
  skillName: string;
  phase: SkillOrchestrationPhase;
  reason: string;
}

export type SkillOrchestrationConfidence = "none" | "low" | "medium" | "high";

export interface SkillOrchestrationCandidateScore {
  skillName: string;
  score: number;
  phase: SkillOrchestrationPhase;
  required: boolean;
  autoEligible: boolean;
  reasons: string[];
}

export interface SkillOrchestrationPlan {
  selectedSkills: string[];
  requiredSkillNames: string[];
  autoSelectedSkillNames: string[];
  orderedSteps: SkillOrchestrationStep[];
  primarySkillNames: string[];
  supportingSkillNames: string[];
  deferredSkillNames: string[];
  candidateScores: SkillOrchestrationCandidateScore[];
  selectionReasons: Record<string, string[]>;
  confidence: SkillOrchestrationConfidence;
  skippedSkillNames: string[];
  visiblePolicy: string;
}

export interface SkillOrchestrationDefinition {
  name: string;
  description?: string | null;
  guideText?: string | null;
}

export interface SkillOrchestrationCandidate extends SkillOrchestrationDefinition {
  userOwned?: boolean;
  panelLinked?: boolean;
  panelPreferred?: boolean;
  stableSignal?: boolean;
}

const PHASE_ORDER: Record<SkillOrchestrationPhase, number> = {
  brainstorm: 0,
  plan: 1,
  source_read: 2,
  analyze: 3,
  execute: 4,
  verify: 5,
  finish: 6,
  support: 7,
};

const DEFAULT_AUTO_SKILL_LIMIT = 3;
const DEFAULT_AUTO_SKILL_THRESHOLD = 10;
const TOKEN_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "this",
  "to",
  "use",
  "with",
  "you",
  "your",
]);

function normalizeSkillName(value: string): string {
  return value.trim().replace(/^\$+/, "");
}

function uniqueSkillNames(skillNames: readonly string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const rawName of skillNames) {
    const name = normalizeSkillName(rawName);
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    ordered.push(name);
  }
  return ordered;
}

function includesAny(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function tokenizeSkillText(value: string | null | undefined): string[] {
  if (!value?.trim()) {
    return [];
  }
  return (
    value
      .toLowerCase()
      .replace(/[`$@/\\:_-]+/gu, " ")
      .match(/[a-z0-9]+/gu) ?? []
  ).filter((token) => token.length >= 3 && !TOKEN_STOP_WORDS.has(token));
}

function countTokenOverlap(left: readonly string[], right: readonly string[], cap: number): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }
  const rightSet = new Set(right);
  let count = 0;
  const seen = new Set<string>();
  for (const token of left) {
    if (seen.has(token) || !rightSet.has(token)) {
      continue;
    }
    seen.add(token);
    count += 1;
    if (count >= cap) {
      break;
    }
  }
  return count;
}

export function classifySkillOrchestrationPhase(definition: SkillOrchestrationDefinition): SkillOrchestrationPhase {
  const name = normalizeSkillName(definition.name).toLowerCase();
  const text = [name, definition.description ?? "", definition.guideText ?? ""].join("\n").toLowerCase();

  if (includesAny(text, [/\bbrainstorm(?:ing)?\b/u, /\bideation\b/u, /\bcreative\b/u])) {
    return "brainstorm";
  }
  if (includesAny(text, [/\bwriting-plans?\b/u, /\bplan(?:ning|s)?\b/u, /\bprd\b/u, /\barchitecture\b/u, /\bdesign\b/u])) {
    return "plan";
  }
  if (includesAny(text, [/\bverification\b/u, /\bverify\b/u, /\btest(?:ing)?\b/u, /\bqa\b/u])) {
    return "verify";
  }
  if (includesAny(text, [/\bfinishing\b/u, /\bfinish\b/u, /\bcompletion\b/u, /\brelease\b/u])) {
    return "finish";
  }
  if (includesAny(text, [/\bacademic-paper\b/u, /\bpaper-writer\b/u, /\bwriter\b/u, /\bbuild(?:er|ing)?\b/u, /\bimplement\b/u, /\bcreate\b/u, /\bedit\b/u, /\bexecute\b/u])) {
    return "execute";
  }
  if (includesAny(text, [/\breviewer\b/u, /\breview\b/u, /\banaly[sz]e\b/u, /\banalysis\b/u, /\baudit\b/u])) {
    return "analyze";
  }
  if (includesAny(text, [/\bdeep-read\b/u, /\bread(?:ing)?\b/u, /\bsource\b/u, /\bpaper\b/u, /\bpdf\b/u, /\bliterature\b/u])) {
    return "source_read";
  }
  return "support";
}

function phaseHintScore(promptText: string, phase: SkillOrchestrationPhase): number {
  if (!promptText.trim()) {
    return 0;
  }
  const text = promptText.toLowerCase();
  const hints: Record<SkillOrchestrationPhase, readonly RegExp[]> = {
    brainstorm: [/\bbrainstorm\b/u, /\bideas?\b/u, /\boptions?\b/u, /\bcreative\b/u],
    plan: [/\bplan\b/u, /\boutline\b/u, /\bstrategy\b/u, /\broadmap\b/u, /\bsteps?\b/u],
    source_read: [/\bread\b/u, /\bsource\b/u, /\bpaper\b/u, /\bpdf\b/u, /\blecture\b/u, /\bnote\b/u],
    analyze: [/\banaly[sz]e\b/u, /\breview\b/u, /\bcompare\b/u, /\bwhy\b/u, /\bexplain\b/u],
    execute: [/\bwrite\b/u, /\bcreate\b/u, /\bmake\b/u, /\bbuild\b/u, /\bdraft\b/u, /\bedit\b/u],
    verify: [/\bverify\b/u, /\bcheck\b/u, /\btest\b/u, /\bcorrect\b/u],
    finish: [/\bfinish\b/u, /\bfinal\b/u, /\bpolish\b/u, /\bcomplete\b/u],
    support: [],
  };
  return includesAny(text, hints[phase]) ? 3 : 0;
}

function sourceStrategyScore(sourceStrategy: string | null | undefined, phase: SkillOrchestrationPhase): number {
  if (!sourceStrategy) {
    return 0;
  }
  if ((sourceStrategy === "use_attachment" || sourceStrategy === "use_note") && (phase === "source_read" || phase === "analyze")) {
    return 3;
  }
  if (sourceStrategy === "ask_for_source" && (phase === "plan" || phase === "source_read")) {
    return 2;
  }
  if (sourceStrategy === "continue_from_memory" && (phase === "analyze" || phase === "execute")) {
    return 2;
  }
  return 0;
}

function buildReason(phase: SkillOrchestrationPhase): string {
  switch (phase) {
    case "brainstorm":
      return "Use first to generate options and frame the approach.";
    case "plan":
      return "Use before execution to choose structure, order, and constraints.";
    case "source_read":
      return "Use after planning to read or ground the source material.";
    case "analyze":
      return "Use after source grounding to evaluate and interpret the material.";
    case "execute":
      return "Use after planning and analysis to produce the requested work.";
    case "verify":
      return "Use after execution to check correctness and gaps.";
    case "finish":
      return "Use last for completion, cleanup, or release-oriented guidance.";
    case "support":
      return "Use as supporting guidance where it fits the request.";
  }
}

function extractGuideBlocks(skillGuideText: string | null | undefined): Map<string, string> {
  const blocks = new Map<string, string>();
  if (!skillGuideText?.trim()) {
    return blocks;
  }
  const body = skillGuideText.replace(/^Requested skill guides:\s*/u, "").trim();
  for (const block of body.split(/\n\n(?=Skill guide: \$)/u)) {
    const match = block.match(/^Skill guide: \$([^\n]+)/u);
    const name = match?.[1]?.trim();
    if (name) {
      blocks.set(name, block.trim());
    }
  }
  return blocks;
}

function upsertCandidate(
  byName: Map<string, SkillOrchestrationCandidate>,
  candidate: SkillOrchestrationCandidate,
): void {
  const name = normalizeSkillName(candidate.name);
  if (!name) {
    return;
  }
  const previous = byName.get(name);
  byName.set(name, {
    ...previous,
    ...candidate,
    name,
    description: candidate.description ?? previous?.description ?? null,
    guideText: candidate.guideText ?? previous?.guideText ?? null,
    userOwned: candidate.userOwned ?? previous?.userOwned,
    panelLinked: Boolean(candidate.panelLinked ?? previous?.panelLinked),
    panelPreferred: Boolean(candidate.panelPreferred ?? previous?.panelPreferred),
    stableSignal: Boolean(candidate.stableSignal ?? previous?.stableSignal),
  });
}

function scoreCandidate(params: {
  candidate: SkillOrchestrationCandidate;
  required: boolean;
  prompt: string;
  promptTokens: readonly string[];
  panelWorkflow: string | null;
  weakConceptLabels: readonly string[];
  sourceStrategy: string | null;
}): SkillOrchestrationCandidateScore {
  const phase = classifySkillOrchestrationPhase(params.candidate);
  const skillText = [params.candidate.name, params.candidate.description ?? "", params.candidate.guideText ?? ""].join(" ");
  const skillTokens = tokenizeSkillText(skillText);
  const workflowTokens = tokenizeSkillText(params.panelWorkflow);
  const weakTokens = tokenizeSkillText(params.weakConceptLabels.join(" "));
  const reasons: string[] = [];
  let score = 0;

  if (params.required) {
    score += 100;
    reasons.push("required by explicit, panel-selected, mention, or workflow selection");
  }
  if (params.candidate.userOwned) {
    score += 3;
    reasons.push("user-owned skill");
  }
  if (params.candidate.panelLinked) {
    score += 7;
    reasons.push("linked to active panel");
  }
  if (params.candidate.panelPreferred) {
    score += 6;
    reasons.push("preferred by panel memory");
  }
  if (params.candidate.stableSignal) {
    score += 5;
    reasons.push("stable panel signal");
  }

  const promptOverlap = countTokenOverlap(params.promptTokens, skillTokens, 6);
  if (promptOverlap > 0) {
    score += promptOverlap;
    reasons.push(`prompt match +${promptOverlap}`);
  }
  const workflowOverlap = countTokenOverlap(workflowTokens, skillTokens, 4);
  if (workflowOverlap > 0) {
    const value = workflowOverlap * 2;
    score += value;
    reasons.push(`panel workflow match +${value}`);
  }
  const weakOverlap = countTokenOverlap(weakTokens, skillTokens, 6);
  if (weakOverlap > 0) {
    score += weakOverlap;
    reasons.push(`weak concept match +${weakOverlap}`);
  }
  const phaseBonus = phaseHintScore(params.prompt, phase);
  if (phaseBonus > 0) {
    score += phaseBonus;
    reasons.push(`prompt phase match +${phaseBonus}`);
  }
  const sourceBonus = sourceStrategyScore(params.sourceStrategy, phase);
  if (sourceBonus > 0) {
    score += sourceBonus;
    reasons.push(`source strategy match +${sourceBonus}`);
  }

  const autoEligible = !params.required && params.candidate.userOwned === true;
  return {
    skillName: normalizeSkillName(params.candidate.name),
    score,
    phase,
    required: params.required,
    autoEligible,
    reasons,
  };
}

function confidenceForPlan(scores: readonly SkillOrchestrationCandidateScore[], autoSelectedSkillNames: readonly string[]): SkillOrchestrationConfidence {
  if (scores.length === 0) {
    return "none";
  }
  const selectedScores = scores.filter((score) => autoSelectedSkillNames.includes(score.skillName));
  if (selectedScores.some((score) => score.score >= DEFAULT_AUTO_SKILL_THRESHOLD + 5)) {
    return "high";
  }
  if (selectedScores.length > 0) {
    return "medium";
  }
  return scores.some((score) => score.score > 0) ? "low" : "none";
}

export function buildSkillOrchestrationPlan(
  skillNames: readonly string[],
  options: {
    definitions?: readonly SkillOrchestrationDefinition[];
    skillGuideText?: string | null;
    candidates?: readonly SkillOrchestrationCandidate[];
    prompt?: string | null;
    panelWorkflow?: string | null;
    weakConceptLabels?: readonly string[];
    sourceStrategy?: string | null;
    maxAutoSkills?: number;
    autoThreshold?: number;
  } = {},
): SkillOrchestrationPlan | null {
  const requiredSkillNames = uniqueSkillNames(skillNames);
  const guideBlocks = extractGuideBlocks(options.skillGuideText);
  const candidatesByName = new Map<string, SkillOrchestrationCandidate>();
  for (const definition of options.definitions ?? []) {
    upsertCandidate(candidatesByName, definition);
  }
  for (const candidate of options.candidates ?? []) {
    upsertCandidate(candidatesByName, candidate);
  }
  for (const skillName of requiredSkillNames) {
    upsertCandidate(candidatesByName, { name: skillName });
  }
  for (const [skillName, guideText] of guideBlocks.entries()) {
    upsertCandidate(candidatesByName, { name: skillName, guideText });
  }

  const requiredSet = new Set(requiredSkillNames);
  const prompt = options.prompt ?? "";
  const promptTokens = tokenizeSkillText(prompt);
  const candidateScores = [...candidatesByName.values()]
    .map((candidate) =>
      scoreCandidate({
        candidate,
        required: requiredSet.has(candidate.name),
        prompt,
        promptTokens,
        panelWorkflow: options.panelWorkflow ?? null,
        weakConceptLabels: options.weakConceptLabels ?? [],
        sourceStrategy: options.sourceStrategy ?? null,
      }),
    )
    .sort(
      (left, right) =>
        Number(right.required) - Number(left.required) ||
        right.score - left.score ||
        PHASE_ORDER[left.phase] - PHASE_ORDER[right.phase] ||
        left.skillName.localeCompare(right.skillName),
    );

  const maxAutoSkills = Math.max(0, options.maxAutoSkills ?? DEFAULT_AUTO_SKILL_LIMIT);
  const autoThreshold = options.autoThreshold ?? DEFAULT_AUTO_SKILL_THRESHOLD;
  const usedAutoPhases = new Set<SkillOrchestrationPhase>();
  const autoSelectedSkillNames: string[] = [];
  for (const score of candidateScores) {
    if (autoSelectedSkillNames.length >= maxAutoSkills || score.required || !score.autoEligible || score.score < autoThreshold) {
      continue;
    }
    if (usedAutoPhases.has(score.phase)) {
      continue;
    }
    usedAutoPhases.add(score.phase);
    autoSelectedSkillNames.push(score.skillName);
  }
  autoSelectedSkillNames.sort((left, right) => {
    const leftScore = candidateScores.find((score) => score.skillName === left);
    const rightScore = candidateScores.find((score) => score.skillName === right);
    return (
      PHASE_ORDER[leftScore?.phase ?? "support"] - PHASE_ORDER[rightScore?.phase ?? "support"] ||
      (rightScore?.score ?? 0) - (leftScore?.score ?? 0) ||
      left.localeCompare(right)
    );
  });

  const selectedSkills = uniqueSkillNames([...requiredSkillNames, ...autoSelectedSkillNames]);
  if (selectedSkills.length === 0) {
    return null;
  }

  const scoreByName = new Map(candidateScores.map((score) => [score.skillName, score]));
  const selectionReasons: Record<string, string[]> = {};
  for (const skillName of selectedSkills) {
    selectionReasons[skillName] = scoreByName.get(skillName)?.reasons ?? [];
  }
  const skippedSkillNames = candidateScores
    .filter((score) => !score.required && !autoSelectedSkillNames.includes(score.skillName))
    .map((score) => score.skillName);
  const indexedSteps = selectedSkills.map((skillName, index) => {
    const score = scoreByName.get(skillName);
    const candidate = candidatesByName.get(skillName) ?? { name: skillName };
    const guideText = candidate.guideText ?? guideBlocks.get(skillName) ?? null;
    const phase = score?.phase ?? classifySkillOrchestrationPhase({ ...candidate, name: skillName, guideText });
    return {
      index,
      step: {
        skillName,
        phase,
        reason: buildReason(phase),
      },
    };
  });
  const orderedSteps = indexedSteps
    .sort((left, right) => PHASE_ORDER[left.step.phase] - PHASE_ORDER[right.step.phase] || left.index - right.index)
    .map((entry) => entry.step);
  const supportingSkillNames = orderedSteps.filter((step) => step.phase === "support").map((step) => step.skillName);
  const primarySkillNames = orderedSteps.filter((step) => step.phase !== "support").map((step) => step.skillName);

  return {
    selectedSkills,
    requiredSkillNames,
    autoSelectedSkillNames,
    orderedSteps,
    primarySkillNames,
    supportingSkillNames,
    deferredSkillNames: skippedSkillNames,
    candidateScores,
    selectionReasons,
    confidence: confidenceForPlan(candidateScores, autoSelectedSkillNames),
    skippedSkillNames,
    visiblePolicy: "Do not narrate skill loading or this ordering; reflect the selected skills through the answer structure and output.",
  };
}

export function formatSkillOrchestrationPlanForPrompt(plan: SkillOrchestrationPlan): string {
  const topCandidateScores = plan.candidateScores
    .slice(0, 8)
    .map((score) => `$${score.skillName}=${score.score}${score.autoEligible ? "" : " (not auto)"}`)
    .join(" / ");
  return [
    "Skill orchestration plan",
    `- Selected skills: ${plan.selectedSkills.map((name) => `$${name}`).join(" / ")}`,
    `- Required skills: ${plan.requiredSkillNames.length > 0 ? plan.requiredSkillNames.map((name) => `$${name}`).join(" / ") : "none"}`,
    `- Auto-selected skills: ${plan.autoSelectedSkillNames.length > 0 ? plan.autoSelectedSkillNames.map((name) => `$${name}`).join(" / ") : "none"}`,
    `- Required execution order: ${plan.orderedSteps.map((step) => `$${step.skillName} -> ${step.phase}`).join(" / ")}`,
    plan.primarySkillNames.length > 0 ? `- Primary skills: ${plan.primarySkillNames.map((name) => `$${name}`).join(" / ")}` : null,
    plan.supportingSkillNames.length > 0 ? `- Supporting skills: ${plan.supportingSkillNames.map((name) => `$${name}`).join(" / ")}` : null,
    plan.deferredSkillNames.length > 0 ? `- Deferred skills: ${plan.deferredSkillNames.map((name) => `$${name}`).join(" / ")}` : "- Deferred skills: none",
    `- Confidence: ${plan.confidence}`,
    topCandidateScores ? `- Candidate scores: ${topCandidateScores}` : null,
    plan.skippedSkillNames.length > 0 ? `- Skipped skills: ${plan.skippedSkillNames.map((name) => `$${name}`).join(" / ")}` : "- Skipped skills: none",
    `- Visible policy: ${plan.visiblePolicy}`,
    ...plan.orderedSteps.map((step, index) => `${index + 1}. $${step.skillName} [${step.phase}]: ${step.reason}`),
  ]
    .filter((entry): entry is string => Boolean(entry))
    .join("\n");
}
