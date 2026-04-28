export const GENERATED_DIAGRAM_FOLDER = "assets/vaultforgian/diagrams";
export const MAX_GENERATED_SVG_CHARS = 256_000;

export type SvgSanitizeResult =
  | { ok: true; svg: string }
  | { ok: false; reason: string };

const UNSAFE_SVG_PATTERNS: Array<[RegExp, string]> = [
  [/<\s*script\b/iu, "script tags are not allowed"],
  [/<\s*foreignObject\b/iu, "foreignObject is not allowed"],
  [/<\s*(?:iframe|object|embed|audio|video|canvas)\b/iu, "embedded active content is not allowed"],
  [/<\s*image\b/iu, "external image references are not allowed"],
  [/\son[a-z]+\s*=/iu, "event handler attributes are not allowed"],
  [/(?:href|xlink:href)\s*=\s*["'](?!#)/iu, "external references are not allowed"],
  [/(?:src|action)\s*=\s*["'][^"']*(?:https?:|data:|javascript:)/iu, "remote, data, and javascript URLs are not allowed"],
  [/url\(\s*["']?\s*(?:https?:|data:|javascript:)/iu, "remote paint servers are not allowed"],
];

export function sanitizeGeneratedSvg(input: string): SvgSanitizeResult {
  const svg = input.replace(/\r\n/g, "\n").trim();
  if (!svg) {
    return { ok: false, reason: "SVG is empty" };
  }
  if (svg.length > MAX_GENERATED_SVG_CHARS) {
    return { ok: false, reason: "SVG is too large" };
  }
  if (!/^<svg\b/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) {
    return { ok: false, reason: "SVG must be a single <svg> document" };
  }
  if (!/\bviewBox\s*=/i.test(svg)) {
    return { ok: false, reason: "SVG must include a viewBox" };
  }
  if (!/\bwidth\s*=/i.test(svg) || !/\bheight\s*=/i.test(svg)) {
    return { ok: false, reason: "SVG must include width and height" };
  }
  for (const [pattern, reason] of UNSAFE_SVG_PATTERNS) {
    if (pattern.test(svg)) {
      return { ok: false, reason };
    }
  }
  return { ok: true, svg };
}

function slugifyDiagramTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function buildGeneratedDiagramAssetPath(title: string, suffix = ""): string {
  const base = slugifyDiagramTitle(title) || "study-diagram";
  const normalizedSuffix = suffix.trim() ? `-${slugifyDiagramTitle(suffix) || "copy"}` : "";
  return `${GENERATED_DIAGRAM_FOLDER}/${base}${normalizedSuffix}.svg`;
}

export function buildDiagramEmbedMarkdown(assetPath: string, caption?: string | null): string {
  const normalizedCaption = caption?.trim() ?? "";
  return normalizedCaption ? `![[${assetPath}]]\n\n*${normalizedCaption}*` : `![[${assetPath}]]`;
}
