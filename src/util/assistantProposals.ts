import type { PatchProposalKind, VaultOpKind } from "../model/types";

const PROPOSAL_BLOCK_PATTERN = /```(obsidian-patch|obsidian-ops)\s*\n([\s\S]*?)```/gim;

export interface ParsedAssistantPatch {
  sourceIndex: number;
  targetPath: string;
  kind: PatchProposalKind;
  summary: string;
  proposedText: string;
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
  patches: ParsedAssistantPatch[];
  ops: ParsedAssistantOp[];
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
    if (!targetPath || !proposedText.trim()) {
      continue;
    }
    const rawKind = asString(record?.kind)?.trim().toLowerCase();
    const kind: PatchProposalKind = rawKind === "create" ? "create" : "update";
    const summary = normalizeWhitespace(asString(record?.summary) ?? defaultPatchSummary(targetPath, kind));
    patches.push({
      sourceIndex,
      targetPath,
      kind,
      summary,
      proposedText,
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

export function extractAssistantProposals(text: string): ParsedAssistantProposalResult {
  const patches: ParsedAssistantPatch[] = [];
  const ops: ParsedAssistantOp[] = [];
  const visibleParts: string[] = [];
  let blockIndex = 0;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  PROPOSAL_BLOCK_PATTERN.lastIndex = 0;
  while ((match = PROPOSAL_BLOCK_PATTERN.exec(text)) !== null) {
    visibleParts.push(text.slice(lastIndex, match.index));
    lastIndex = match.index + match[0].length;
    const blockType = match[1]?.toLowerCase();
    const blockBody = match[2] ?? "";
    try {
      const parsed = JSON.parse(blockBody);
      if (blockType === "obsidian-patch") {
        patches.push(...parsePatchEntries(parsed, blockIndex));
      } else if (blockType === "obsidian-ops") {
        ops.push(...parseOpEntries(parsed, blockIndex));
      }
    } catch {
      // Invalid proposal blocks stay hidden from UI but do not break the chat.
    }
    blockIndex += 1;
  }
  visibleParts.push(text.slice(lastIndex));

  const displayText = visibleParts
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    displayText,
    patches,
    ops,
  };
}

export function stripAssistantProposalBlocks(text: string): string {
  return extractAssistantProposals(text).displayText;
}
