import { describe, expect, it } from "vitest";
import {
  coerceModelForPicker,
  getDefaultReasoningEffortForModel,
  getSupportedReasoningEffortsForModel,
  parseModelCatalog,
  resolveReasoningEffortForModel,
} from "../util/models";

describe("model catalog helpers", () => {
  it("parses visible models and supported reasoning levels", () => {
    const catalog = parseModelCatalog(
      JSON.stringify({
        models: [
          {
            slug: "gpt-5.4",
            display_name: "gpt-5.4",
            default_reasoning_level: "medium",
            supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }, { effort: "xhigh" }],
            visibility: "list",
          },
          {
            slug: "gpt-5.2",
            display_name: "gpt-5.2",
            default_reasoning_level: "medium",
            supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }, { effort: "xhigh" }],
            visibility: "list",
          },
          {
            slug: "gpt-5.1-codex",
            display_name: "gpt-5.1-codex",
            default_reasoning_level: "medium",
            supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }],
            visibility: "list",
          },
        ],
      }),
    );

    expect(catalog.some((entry) => entry.slug === "gpt-5.4")).toBe(true);
    expect(catalog.some((entry) => entry.slug === "gpt-5.1-codex")).toBe(false);
    expect(getSupportedReasoningEffortsForModel(catalog, "gpt-5.1-codex")).toEqual(["low", "medium", "high"]);
    expect(getDefaultReasoningEffortForModel(catalog, "gpt-5.2")).toBe("medium");
  });

  it("falls back to a compatible effort for the selected model", () => {
    const catalog = parseModelCatalog(
      JSON.stringify({
        models: [
          {
            slug: "gpt-5.1-codex",
            display_name: "gpt-5.1-codex",
            default_reasoning_level: "medium",
            supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }],
            visibility: "list",
          },
        ],
      }),
    );

    expect(resolveReasoningEffortForModel(catalog, "gpt-5.1-codex", "xhigh")).toBe("high");
    expect(resolveReasoningEffortForModel(catalog, "gpt-5.1-codex", "high")).toBe("high");
  });

  it("shows only GPT-5.4, GPT-5.3, and GPT-5.2 in the picker", () => {
    const catalog = parseModelCatalog(
      JSON.stringify({
        models: [
          {
            slug: "gpt-5.4",
            display_name: "gpt-5.4",
            default_reasoning_level: "medium",
            supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }, { effort: "xhigh" }],
            visibility: "list",
          },
          {
            slug: "gpt-5.4-mini",
            display_name: "gpt-5.4-mini",
            default_reasoning_level: "medium",
            supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }, { effort: "xhigh" }],
            visibility: "list",
          },
          {
            slug: "gpt-5.3-codex",
            display_name: "gpt-5.3-codex",
            default_reasoning_level: "medium",
            supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }, { effort: "xhigh" }],
            visibility: "list",
          },
          {
            slug: "gpt-5.2",
            display_name: "gpt-5.2",
            default_reasoning_level: "medium",
            supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }, { effort: "xhigh" }],
            visibility: "list",
          },
          {
            slug: "gpt-5.2-codex",
            display_name: "gpt-5.2-codex",
            default_reasoning_level: "medium",
            supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }, { effort: "xhigh" }],
            visibility: "list",
          },
        ],
      }),
    );

    expect(catalog.map((entry) => entry.slug)).toEqual(["gpt-5.4", "gpt-5.3-codex", "gpt-5.2"]);
    expect(coerceModelForPicker(catalog, "gpt-5.4")).toBe("gpt-5.4");
    expect(coerceModelForPicker(catalog, "gpt-5.4-mini")).toBe("gpt-5.4");
    expect(coerceModelForPicker(catalog, "gpt-5.3-codex")).toBe("gpt-5.3-codex");
    expect(coerceModelForPicker(catalog, "gpt-5.2-codex")).toBe("gpt-5.2");
    expect(coerceModelForPicker(catalog, "gpt-5.1-codex")).toBe("gpt-5.4");
  });
});
