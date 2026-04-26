import { DEFAULT_PRIMARY_MODEL, type ModelCatalogEntry } from "../model/types";
import {
  chooseHighestReasoningEffort,
  getCompatibleReasoningEffort,
  isGpt51CodexModel,
  normalizeReasoningEffort,
  type ReasoningEffort,
} from "./reasoning";

const GPT_53_MODEL = "gpt-5.3-codex";
const GPT_54_MODEL = "gpt-5.4";
export const SAFE_FALLBACK_MODEL = GPT_54_MODEL;

const MODEL_PICKER_POLICY = [
  {
    slug: DEFAULT_PRIMARY_MODEL,
    label: "GPT-5.5",
    aliases: [/^gpt-5\.5(?:$|-)/i],
  },
  {
    slug: GPT_54_MODEL,
    label: "GPT-5.4",
    aliases: [/^gpt-5\.4(?:$|-)/i],
  },
  {
    slug: GPT_53_MODEL,
    label: "GPT-5.3",
    aliases: [/^gpt-5\.3(?:$|-)/i],
  },
] as const;

const PICKER_MODELS = MODEL_PICKER_POLICY.map((entry) => entry.slug);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function isModelVisibleInPicker(slug: string): boolean {
  return (PICKER_MODELS as readonly string[]).includes(slug.trim());
}

function normalizePickerModelSlug(slug: string): string {
  const trimmed = slug.trim();
  if (!trimmed) {
    return "";
  }
  for (const policy of MODEL_PICKER_POLICY) {
    if (policy.aliases.some((pattern) => pattern.test(trimmed))) {
      return policy.slug;
    }
  }
  return trimmed;
}

function pickVisibleFallbackModel(catalog: readonly ModelCatalogEntry[], preferred: string): string {
  const visibleCatalog = catalog.filter((entry) => isModelVisibleInPicker(entry.slug));
  if (visibleCatalog.some((entry) => entry.slug === preferred)) {
    return preferred;
  }
  return visibleCatalog[0]?.slug ?? preferred;
}

export function coerceModelForPicker(catalog: readonly ModelCatalogEntry[], slug: string | null | undefined): string {
  const normalized = normalizePickerModelSlug(slug?.trim() ?? "");
  if (normalized && (catalog.some((entry) => entry.slug === normalized) || (catalog.length === 0 && isModelVisibleInPicker(normalized)))) {
    return normalized;
  }

  return pickVisibleFallbackModel(catalog, DEFAULT_PRIMARY_MODEL);
}

export function getSafeFallbackModel(catalog: readonly ModelCatalogEntry[]): string {
  if (catalog.some((entry) => entry.slug === SAFE_FALLBACK_MODEL)) {
    return SAFE_FALLBACK_MODEL;
  }
  const nonPrimaryVisible = catalog.find((entry) => isModelVisibleInPicker(entry.slug) && entry.slug !== DEFAULT_PRIMARY_MODEL);
  return nonPrimaryVisible?.slug ?? pickVisibleFallbackModel(catalog, SAFE_FALLBACK_MODEL);
}

export function coerceModelForRuntime(
  catalog: readonly ModelCatalogEntry[],
  slug: string | null | undefined,
  options: { allowPrimaryModel: boolean },
): string {
  const normalized = coerceModelForPicker(catalog, slug);
  if (normalized === DEFAULT_PRIMARY_MODEL && !options.allowPrimaryModel) {
    return getSafeFallbackModel(catalog);
  }
  return normalized;
}

export function formatModelLabel(slug: string, fallback: string): string {
  const normalizedSlug = slug.trim();
  const policy = MODEL_PICKER_POLICY.find((entry) => entry.slug === normalizedSlug);
  if (policy) {
    return policy.label;
  }
  const gptMatch = normalizedSlug.match(/^gpt-(\d+(?:\.\d+)?)(?:-.+)?$/i);
  if (gptMatch) {
    return `GPT-${gptMatch[1]}`;
  }
  return fallback
    .replace(/^gpt-/i, "GPT-")
    .replace(/-mini$/i, "-Mini")
    .replace(/-codex$/i, "-Codex");
}

function parseSupportedReasoningLevels(value: unknown, model: string): ReasoningEffort[] {
  if (!Array.isArray(value)) {
    return isGpt51CodexModel(model) ? ["low", "medium", "high"] : ["low", "medium", "high", "xhigh"];
  }

  const supported = value
    .map((entry) => {
      if (typeof entry === "string") {
        return normalizeReasoningEffort(entry);
      }
      const record = asRecord(entry);
      return normalizeReasoningEffort(asString(record?.effort));
    })
    .filter((entry): entry is ReasoningEffort => Boolean(entry));

  if (supported.length > 0) {
    return [...new Set(supported)];
  }
  return isGpt51CodexModel(model) ? ["low", "medium", "high"] : ["low", "medium", "high", "xhigh"];
}

export function getFallbackModelCatalog(): ModelCatalogEntry[] {
  return [
    {
      slug: DEFAULT_PRIMARY_MODEL,
      displayName: DEFAULT_PRIMARY_MODEL,
      defaultReasoningLevel: "medium",
      supportedReasoningLevels: ["low", "medium", "high", "xhigh"],
    },
    {
      slug: GPT_54_MODEL,
      displayName: GPT_54_MODEL,
      defaultReasoningLevel: "medium",
      supportedReasoningLevels: ["low", "medium", "high", "xhigh"],
    },
    {
      slug: GPT_53_MODEL,
      displayName: GPT_53_MODEL,
      defaultReasoningLevel: "medium",
      supportedReasoningLevels: ["low", "medium", "high", "xhigh"],
    },
  ];
}

export function parseModelCatalog(input: string): ModelCatalogEntry[] {
  try {
    const parsed = JSON.parse(input) as { models?: unknown[] };
    const rawModels = Array.isArray(parsed?.models) ? parsed.models : [];
    const models = rawModels
      .map((entry) => {
        const record = asRecord(entry);
        const slug = asString(record?.slug)?.trim() ?? "";
        if (!slug) {
          return null;
        }
        const visibility = asString(record?.visibility);
        if (visibility === "hidden") {
          return null;
        }
        const supportedReasoningLevels = parseSupportedReasoningLevels(record?.supported_reasoning_levels, slug);
        const defaultReasoningLevel =
          normalizeReasoningEffort(asString(record?.default_reasoning_level)) ??
          chooseHighestReasoningEffort(supportedReasoningLevels) ??
          "medium";
        return {
          slug,
          displayName: asString(record?.display_name)?.trim() || slug,
          defaultReasoningLevel,
          supportedReasoningLevels,
        } satisfies ModelCatalogEntry;
      })
      .filter((entry): entry is ModelCatalogEntry => {
        if (!entry) {
          return false;
        }
        return isModelVisibleInPicker(entry.slug);
      });

    if (models.length === 0) {
      return getFallbackModelCatalog();
    }

    const deduped = new Map<string, ModelCatalogEntry>();
    for (const model of models) {
      deduped.set(model.slug, model);
    }
    return [...deduped.values()];
  } catch {
    return getFallbackModelCatalog();
  }
}

export function findModelCatalogEntry(
  catalog: readonly ModelCatalogEntry[],
  slug: string | null | undefined,
): ModelCatalogEntry | null {
  if (!slug) {
    return null;
  }
  return catalog.find((entry) => entry.slug === slug.trim()) ?? null;
}

export function getSupportedReasoningEffortsForModel(
  catalog: readonly ModelCatalogEntry[],
  model: string,
): ReasoningEffort[] {
  return findModelCatalogEntry(catalog, model)?.supportedReasoningLevels ??
    (isGpt51CodexModel(model) ? ["low", "medium", "high"] : ["low", "medium", "high", "xhigh"]);
}

export function getDefaultReasoningEffortForModel(
  catalog: readonly ModelCatalogEntry[],
  model: string,
): ReasoningEffort {
  return (
    findModelCatalogEntry(catalog, model)?.defaultReasoningLevel ??
    chooseHighestReasoningEffort(getSupportedReasoningEffortsForModel(catalog, model)) ??
    getCompatibleReasoningEffort(model, "medium") ??
    "medium"
  );
}

export function resolveReasoningEffortForModel(
  catalog: readonly ModelCatalogEntry[],
  model: string,
  desired: ReasoningEffort | null,
): ReasoningEffort {
  const catalogEntry = findModelCatalogEntry(catalog, model);
  const supported = getSupportedReasoningEffortsForModel(catalog, model);
  if (desired && supported.includes(desired)) {
    return desired;
  }

  if (!catalogEntry) {
    const compatibleDesired = getCompatibleReasoningEffort(model, desired);
    if (compatibleDesired && supported.includes(compatibleDesired)) {
      return compatibleDesired;
    }
  }

  const fallback = getDefaultReasoningEffortForModel(catalog, model);
  if (supported.includes(fallback)) {
    return fallback;
  }

  return chooseHighestReasoningEffort(supported) ?? "medium";
}
