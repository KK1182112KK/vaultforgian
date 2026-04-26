import type { PatchEvidenceSourceKind, PatchIntent, PatchProposalKind, StudyWorkflowKind, VaultOpKind } from "../model/types";
import { normalizePatchIntent } from "./agenticTurnPolicy";
import { sanitizeOperationalAssistantText } from "./assistantChatter";

const PROPOSAL_BLOCK_PATTERN = /```(obsidian-patch|obsidian-ops|obsidian-plan|obsidian-suggest|obsidian-study-checkpoint)\s*\n([\s\S]*?)```/gim;
const PARTIAL_PROPOSAL_FENCE_PATTERN = /```(?:obsidian-patch|obsidian-ops|obsidian-plan|obsidian-suggest|obsidian-study-checkpoint)\b[\s\S]*$/im;
const JSON_PROPOSAL_LINE_PATTERN =
  /^\s*"(?:patches|patch|ops|op|path|targetPath|file|kind|operation|intent|summary|content|text|proposedText|anchors|anchorBefore|anchorAfter|replacement|destinationPath|newPath|toPath|propertyKey|propertyValue|taskLine|taskText|checked)"\s*:/m;
const JSON_PROPOSAL_MARKER_PATTERN =
  /"(?:patches|patch|ops|op|path|targetPath|file|kind|operation|intent|summary|anchors|anchorBefore|anchorAfter|replacement|destinationPath|propertyKey|propertyValue|taskLine|taskText|checked)"\s*:/i;

export interface ParsedAssistantPatchAnchor {
  anchorBefore: string;
  anchorAfter: string;
  replacement: string;
}

export interface ParsedAssistantPatch {
  sourceIndex: number;
  targetPath: string;
  kind: PatchProposalKind;
  intent?: PatchIntent;
  summary: string;
  proposedText: string;
  anchors?: ParsedAssistantPatchAnchor[];
  evidence?: ParsedAssistantPatchEvidence[];
}

export interface ParsedAssistantOp {
  sourceIndex: number;
  kind: VaultOpKind;
  targetPath: string;
  destinationPath?: string;
  propertyKey?: string;
  propertyValue?: string | null;
  taskLine?: number | null;
  taskText?: string | null;
  checked?: boolean | null;
  summary: string;
}

export interface ParsedAssistantProposalResult {
  displayText: string;
  sanitizedDisplayText: string;
  patches: ParsedAssistantPatch[];
  ops: ParsedAssistantOp[];
  plan: ParsedAssistantPlanSignal | null;
  suggestion: ParsedAssistantSuggestionSignal | null;
  studyCheckpoint: ParsedAssistantStudyCheckpoint | null;
  hasProposalMarkers: boolean;
  hasMalformedProposal: boolean;
}

export interface ParsedAssistantPlanSignal {
  status: "ready_to_implement";
  summary: string;
}

export interface ParsedAssistantPatchEvidence {
  kind: PatchEvidenceSourceKind;
  label: string;
  sourceRef: string | null;
  snippet: string | null;
}

export interface ParsedAssistantSuggestionSignal {
  kind: "rewrite_followup";
  summary: string | null;
  question: string | null;
}

export interface ParsedAssistantStudyCheckpoint {
  workflow: StudyWorkflowKind;
  mastered: string[];
  unclear: string[];
  nextStep: string;
  confidenceNote: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

function normalizeOpKind(value: string | null): VaultOpKind | null {
  const normalized = value?.trim().toLowerCase().replace(/[:\s-]+/g, "_") ?? "";
  if (normalized === "rename") {
    return "rename";
  }
  if (normalized === "move") {
    return "move";
  }
  if (normalized === "property_set" || normalized === "set_property") {
    return "property_set";
  }
  if (normalized === "property_remove" || normalized === "remove_property") {
    return "property_remove";
  }
  if (normalized === "task_update" || normalized === "task") {
    return "task_update";
  }
  return null;
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === null || value === undefined) {
    return [];
  }
  return [value];
}

function normalizeStringArray(value: unknown): string[] {
  return toArray(value)
    .map((entry) => normalizeWhitespace(asString(entry) ?? ""))
    .filter(Boolean);
}

function normalizeEvidenceKind(value: string | null): PatchEvidenceSourceKind | null {
  const normalized = value?.trim().toLowerCase().replace(/[\s-]+/g, "_") ?? "";
  if (normalized === "vault_note" || normalized === "note" || normalized === "vault") {
    return "vault_note";
  }
  if (normalized === "attachment" || normalized === "file") {
    return "attachment";
  }
  if (normalized === "web" || normalized === "url" || normalized === "link") {
    return "web";
  }
  return null;
}

function normalizeEvidenceEntry(
  kind: string | null,
  label: string | null,
  sourceRef: string | null,
  snippet: string | null,
): ParsedAssistantPatchEvidence | null {
  const normalizedKind = normalizeEvidenceKind(kind);
  const normalizedLabel = normalizeWhitespace(label ?? "");
  if (!normalizedKind || !normalizedLabel) {
    return null;
  }
  const normalizedSourceRef = normalizeWhitespace(sourceRef ?? "") || null;
  const normalizedSnippet = normalizeWhitespace(snippet ?? "") || null;
  return {
    kind: normalizedKind,
    label: normalizedLabel,
    sourceRef: normalizedSourceRef,
    snippet: normalizedSnippet,
  };
}

function normalizeStudyWorkflowKind(value: unknown): StudyWorkflowKind | null {
  const normalized = normalizeWhitespace(asString(value) ?? "").toLowerCase();
  if (normalized === "lecture" || normalized === "review" || normalized === "paper" || normalized === "homework") {
    return normalized;
  }
  return null;
}

function parseStudyCheckpointSignal(value: unknown): ParsedAssistantStudyCheckpoint | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const workflow = normalizeStudyWorkflowKind(record.workflow);
  const nextStep = normalizeWhitespace(asString(record.next_step) ?? "");
  const confidenceNote = normalizeWhitespace(asString(record.confidence_note) ?? "");
  if (!workflow || !nextStep || !confidenceNote) {
    return null;
  }
  return {
    workflow,
    mastered: normalizeStringArray(record.mastered),
    unclear: normalizeStringArray(record.unclear),
    nextStep,
    confidenceNote,
  };
}

function parseEvidenceEntries(raw: unknown): ParsedAssistantPatchEvidence[] {
  const entries = toArray(raw);
  const evidence: ParsedAssistantPatchEvidence[] = [];
  for (const entry of entries) {
    const record = asRecord(entry);
    if (!record) {
      continue;
    }
    const parsed = normalizeEvidenceEntry(
      asString(record.kind) ?? asString(record.sourceKind) ?? null,
      asString(record.label) ?? asString(record.title) ?? null,
      asString(record.sourceRef) ?? asString(record.path) ?? asString(record.url) ?? asString(record.source) ?? null,
      asString(record.snippet) ?? asString(record.quote) ?? asString(record.text) ?? null,
    );
    if (parsed) {
      evidence.push(parsed);
    }
  }
  return evidence;
}

function parseEvidenceHeaderLine(raw: string): ParsedAssistantPatchEvidence | null {
  const parts = raw.split("|").map((entry) => entry.trim());
  if (parts.length < 2) {
    return null;
  }
  return normalizeEvidenceEntry(
    parts[0] ?? null,
    parts[1] ?? null,
    parts[2] ?? null,
    parts.length > 3 ? parts.slice(3).join(" | ") : null,
  );
}

function defaultPatchSummary(path: string, kind: PatchProposalKind): string {
  return `${kind === "create" ? "Create" : "Update"} ${path}`;
}

function defaultOpSummary(kind: VaultOpKind, path: string, destinationPath?: string): string {
  if (kind === "rename") {
    return `Rename ${path}${destinationPath ? ` -> ${destinationPath}` : ""}`;
  }
  if (kind === "move") {
    return `Move ${path}${destinationPath ? ` -> ${destinationPath}` : ""}`;
  }
  if (kind === "property_set") {
    return `Set property on ${path}`;
  }
  if (kind === "property_remove") {
    return `Remove property from ${path}`;
  }
  return `Update tasks in ${path}`;
}

function parseAnchorEntries(raw: unknown): ParsedAssistantPatchAnchor[] {
  const entries = toArray(raw);
  const anchors: ParsedAssistantPatchAnchor[] = [];
  for (const entry of entries) {
    const record = asRecord(entry);
    if (!record) {
      continue;
    }
    const anchorBefore = asString(record.anchorBefore) ?? asString(record.before) ?? "";
    const anchorAfter = asString(record.anchorAfter) ?? asString(record.after) ?? "";
    const replacement = asString(record.replacement) ?? asString(record.replace) ?? asString(record.content) ?? "";
    if (!anchorBefore && !anchorAfter) {
      continue;
    }
    anchors.push({ anchorBefore, anchorAfter, replacement });
  }
  return anchors;
}

const DELIMITER_MARKER_PATTERN = /^---(anchorBefore|anchorAfter|replacement|content|end)\s*$/i;
const DELIMITER_HEADER_KEY_PATTERN = /^([a-zA-Z][a-zA-Z0-9_-]*)\s*:\s*(.*)$/;

type DelimiterField = "anchorBefore" | "anchorAfter" | "replacement" | "content";

/**
 * Parses the delimiter-based patch body used to avoid JSON string escaping hell
 * on long markdown + math content. Format:
 *
 *   path: Notes/Foo.md
 *   kind: update
 *   summary: ...
 *
 *   ---anchorBefore
 *   <verbatim text>
 *   ---anchorAfter
 *   <verbatim text>
 *   ---replacement
 *   <verbatim text>
 *   ---end
 *
 * Multiple anchor entries are supported by repeating the ---anchorBefore block.
 * `create` kind uses `---content` ... `---end` instead of anchor entries.
 * Trailing `---end` is tolerated if omitted at EOF.
 */
function parseDelimiterPatch(body: string, sourceIndex: number): ParsedAssistantPatch | null {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const headerMap: Record<string, string> = {};
  const evidenceLines: string[] = [];
  const anchors: ParsedAssistantPatchAnchor[] = [];
  let createContent: string | null = null;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (DELIMITER_MARKER_PATTERN.test(line)) {
      break;
    }
    const headerMatch = line.match(DELIMITER_HEADER_KEY_PATTERN);
    if (headerMatch) {
      const key = headerMatch[1].toLowerCase();
      if (key === "evidence") {
        evidenceLines.push(headerMatch[2].trim());
      } else {
        headerMap[key] = headerMatch[2].trim();
      }
    }
    i += 1;
  }

  if (i >= lines.length) {
    return null;
  }

  let currentAnchor: Partial<ParsedAssistantPatchAnchor> | null = null;
  let currentField: DelimiterField | null = null;
  let buffer: string[] = [];

  const flushField = (): void => {
    if (!currentField) {
      return;
    }
    const text = buffer.join("\n");
    buffer = [];
    if (currentField === "content") {
      createContent = text;
    } else if (currentAnchor) {
      currentAnchor[currentField] = text;
    }
  };

  const flushAnchor = (): void => {
    flushField();
    if (
      currentAnchor &&
      (currentAnchor.anchorBefore !== undefined ||
        currentAnchor.anchorAfter !== undefined ||
        currentAnchor.replacement !== undefined)
    ) {
      anchors.push({
        anchorBefore: currentAnchor.anchorBefore ?? "",
        anchorAfter: currentAnchor.anchorAfter ?? "",
        replacement: currentAnchor.replacement ?? "",
      });
    }
    currentAnchor = null;
    currentField = null;
  };

  for (; i < lines.length; i += 1) {
    const line = lines[i];
    const markerMatch = line.match(DELIMITER_MARKER_PATTERN);
    if (markerMatch) {
      const name = markerMatch[1].toLowerCase();
      if (name === "end") {
        flushAnchor();
      } else if (name === "anchorbefore") {
        flushAnchor();
        currentAnchor = {};
        currentField = "anchorBefore";
      } else if (name === "anchorafter") {
        flushField();
        if (!currentAnchor) {
          currentAnchor = {};
        }
        currentField = "anchorAfter";
      } else if (name === "replacement") {
        flushField();
        if (!currentAnchor) {
          currentAnchor = {};
        }
        currentField = "replacement";
      } else if (name === "content") {
        flushField();
        currentAnchor = null;
        currentField = "content";
      }
      continue;
    }
    if (currentField) {
      buffer.push(line);
    }
  }
  // At EOF without an explicit ---end marker, the fenced block's trailing newline
  // shows up as an empty trailing buffer line. Drop it so the replacement text
  // matches what the user wrote between the markers.
  while (buffer.length > 0 && buffer[buffer.length - 1] === "") {
    buffer.pop();
  }
  flushAnchor();

  const targetPath = normalizeWhitespace(
    headerMap.path ?? headerMap.targetpath ?? headerMap.file ?? "",
  );
  if (!targetPath) {
    return null;
  }
  if (anchors.length === 0 && createContent === null) {
    return null;
  }

  const rawKind = (headerMap.kind ?? "").toLowerCase();
  const kind: PatchProposalKind = rawKind === "create" ? "create" : "update";
  const intent = normalizePatchIntent(headerMap.operation ?? headerMap.intent ?? headerMap.op ?? null) ?? undefined;
  const summary = normalizeWhitespace(headerMap.summary ?? defaultPatchSummary(targetPath, kind));
  const evidence = evidenceLines.map(parseEvidenceHeaderLine).filter((entry): entry is ParsedAssistantPatchEvidence => Boolean(entry));

  return {
    sourceIndex,
    targetPath,
    kind,
    intent,
    summary,
    proposedText: createContent ?? "",
    anchors: anchors.length > 0 ? anchors : undefined,
    evidence: evidence.length > 0 ? evidence : undefined,
  };
}

function looksLikeDelimiterPatch(body: string): boolean {
  const trimmed = body.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return false;
  }
  return /^(?:[a-zA-Z][a-zA-Z0-9_-]*\s*:|---(?:anchorBefore|content)\b)/m.test(trimmed);
}

function parsePatchEntries(raw: unknown, sourceIndex: number): ParsedAssistantPatch[] {
  const root = asRecord(raw);
  const entries = root ? toArray(root.patches ?? root.patch ?? root) : [];
  const patches: ParsedAssistantPatch[] = [];
  for (const entry of entries) {
    const record = asRecord(entry);
    const targetPath = normalizeWhitespace(
      asString(record?.targetPath) ?? asString(record?.path) ?? asString(record?.file) ?? "",
    );
    const proposedText = asString(record?.proposedText) ?? asString(record?.content) ?? asString(record?.text) ?? "";
    const anchors = parseAnchorEntries(record?.anchors ?? record?.anchor ?? null);
    const evidence = parseEvidenceEntries(record?.evidence ?? null);
    if (!targetPath || (!proposedText.trim() && anchors.length === 0)) {
      continue;
    }
    const rawKind = asString(record?.kind)?.trim().toLowerCase();
    const kind: PatchProposalKind = rawKind === "create" ? "create" : "update";
    const intent = normalizePatchIntent(
      asString(record?.operation) ?? asString(record?.intent) ?? asString(record?.op) ?? null,
    ) ?? undefined;
    const summary = normalizeWhitespace(asString(record?.summary) ?? defaultPatchSummary(targetPath, kind));
    patches.push({
      sourceIndex,
      targetPath,
      kind,
      intent,
      summary,
      proposedText,
      anchors: anchors.length > 0 ? anchors : undefined,
      evidence: evidence.length > 0 ? evidence : undefined,
    });
  }
  return patches;
}

function parseOpEntries(raw: unknown, sourceIndex: number): ParsedAssistantOp[] {
  const root = asRecord(raw);
  const entries = root ? toArray(root.ops ?? root.op ?? root) : [];
  const ops: ParsedAssistantOp[] = [];
  for (const entry of entries) {
    const record = asRecord(entry);
    const kind = normalizeOpKind(asString(record?.kind) ?? asString(record?.type) ?? null);
    const targetPath = normalizeWhitespace(
      asString(record?.targetPath) ?? asString(record?.path) ?? asString(record?.file) ?? "",
    );
    if (!kind || !targetPath) {
      continue;
    }
    const destinationPath = normalizeWhitespace(
      asString(record?.destinationPath) ?? asString(record?.newPath) ?? asString(record?.toPath) ?? "",
    );
    const propertyKey = normalizeWhitespace(asString(record?.propertyKey) ?? asString(record?.key) ?? "");
    const summary = normalizeWhitespace(asString(record?.summary) ?? defaultOpSummary(kind, targetPath, destinationPath || undefined));
    ops.push({
      sourceIndex,
      kind,
      targetPath,
      destinationPath: destinationPath || undefined,
      propertyKey: propertyKey || undefined,
      propertyValue: asString(record?.propertyValue) ?? asString(record?.value) ?? null,
      taskLine: asNumber(record?.taskLine) ?? asNumber(record?.line),
      taskText: asString(record?.taskText) ?? asString(record?.match) ?? asString(record?.text) ?? null,
      checked: typeof record?.checked === "boolean" ? record.checked : null,
      summary,
    });
  }
  return ops;
}

function parsePlanSignal(raw: unknown): ParsedAssistantPlanSignal | null {
  const record = asRecord(raw);
  const status = normalizeWhitespace(asString(record?.status) ?? "").toLowerCase();
  const summary = normalizeWhitespace(asString(record?.summary) ?? asString(record?.planSummary) ?? "");
  if (status !== "ready_to_implement" || !summary) {
    return null;
  }
  return {
    status: "ready_to_implement",
    summary,
  };
}

function parseSuggestionSignal(raw: unknown): ParsedAssistantSuggestionSignal | null {
  const record = asRecord(raw);
  const kind = normalizeWhitespace(asString(record?.kind) ?? asString(record?.type) ?? "").toLowerCase();
  if (kind !== "rewrite_followup") {
    return null;
  }
  const summary = normalizeWhitespace(asString(record?.summary) ?? asString(record?.rewriteSummary) ?? "") || null;
  const question = normalizeWhitespace(asString(record?.question) ?? "") || null;
  return {
    kind: "rewrite_followup",
    summary,
    question,
  };
}

function stripMalformedProposalTail(text: string): { text: string; hasMalformedProposal: boolean; hasProposalMarkers: boolean } {
  let working = text;
  let hasMalformedProposal = false;
  let hasProposalMarkers = false;

  const partialFenceMatch = working.match(PARTIAL_PROPOSAL_FENCE_PATTERN);
  if (partialFenceMatch && typeof partialFenceMatch.index === "number") {
    working = working.slice(0, partialFenceMatch.index);
    hasMalformedProposal = true;
    hasProposalMarkers = true;
  }

  const jsonProposalMatch = working.match(JSON_PROPOSAL_LINE_PATTERN);
  if (jsonProposalMatch && typeof jsonProposalMatch.index === "number") {
    working = working.slice(0, jsonProposalMatch.index);
    hasMalformedProposal = true;
    hasProposalMarkers = true;
  } else if (JSON_PROPOSAL_MARKER_PATTERN.test(working)) {
    hasProposalMarkers = true;
  }

  return {
    text: working,
    hasMalformedProposal,
    hasProposalMarkers,
  };
}

export function extractAssistantProposals(text: string): ParsedAssistantProposalResult {
  const patches: ParsedAssistantPatch[] = [];
  const ops: ParsedAssistantOp[] = [];
  let plan: ParsedAssistantPlanSignal | null = null;
  let suggestion: ParsedAssistantSuggestionSignal | null = null;
  let studyCheckpoint: ParsedAssistantStudyCheckpoint | null = null;
  const visibleParts: string[] = [];
  let hasProposalMarkers = false;
  let hasMalformedProposal = false;
  let blockIndex = 0;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  PROPOSAL_BLOCK_PATTERN.lastIndex = 0;
  while ((match = PROPOSAL_BLOCK_PATTERN.exec(text)) !== null) {
    visibleParts.push(text.slice(lastIndex, match.index));
    lastIndex = match.index + match[0].length;
    const blockType = match[1]?.toLowerCase();
    const blockBody = match[2] ?? "";
    hasProposalMarkers = true;
    if (blockType === "obsidian-patch" && looksLikeDelimiterPatch(blockBody)) {
      const delimiterPatch = parseDelimiterPatch(blockBody, blockIndex);
      if (delimiterPatch) {
        patches.push(delimiterPatch);
      } else {
        hasMalformedProposal = true;
      }
    } else {
      try {
        const parsed = JSON.parse(blockBody);
        if (blockType === "obsidian-patch") {
          const parsedPatches = parsePatchEntries(parsed, blockIndex);
          if (parsedPatches.length === 0) {
            hasMalformedProposal = true;
          }
          patches.push(...parsedPatches);
        } else if (blockType === "obsidian-ops") {
          const parsedOps = parseOpEntries(parsed, blockIndex);
          if (parsedOps.length === 0) {
            hasMalformedProposal = true;
          } else {
            ops.push(...parsedOps);
          }
        } else if (blockType === "obsidian-plan") {
          const parsedPlan = parsePlanSignal(parsed);
          if (!parsedPlan) {
            hasMalformedProposal = true;
          } else {
            plan = parsedPlan;
          }
        } else if (blockType === "obsidian-suggest") {
          const parsedSuggestion = parseSuggestionSignal(parsed);
          if (!parsedSuggestion) {
            hasMalformedProposal = true;
          } else {
            suggestion = parsedSuggestion;
          }
        } else if (blockType === "obsidian-study-checkpoint") {
          const parsedCheckpoint = parseStudyCheckpointSignal(parsed);
          if (!parsedCheckpoint) {
            hasMalformedProposal = true;
          } else {
            studyCheckpoint = parsedCheckpoint;
          }
        }
      } catch {
        if (blockType === "obsidian-patch") {
          const delimiterPatch = parseDelimiterPatch(blockBody, blockIndex);
          if (delimiterPatch) {
            patches.push(delimiterPatch);
          } else {
            hasMalformedProposal = true;
          }
        } else {
          hasMalformedProposal = true;
        }
      }
    }
    blockIndex += 1;
  }
  visibleParts.push(text.slice(lastIndex));
  const malformedTail = stripMalformedProposalTail(visibleParts.join(""));

  const displayText = malformedTail.text
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    displayText,
    sanitizedDisplayText: sanitizeOperationalAssistantText(displayText) ?? "",
    patches,
    ops,
    plan,
    suggestion,
    studyCheckpoint,
    hasProposalMarkers: hasProposalMarkers || malformedTail.hasProposalMarkers,
    hasMalformedProposal: hasMalformedProposal || malformedTail.hasMalformedProposal,
  };
}

export function stripAssistantProposalBlocks(text: string): string {
  return extractAssistantProposals(text).displayText;
}
