import { describe, expect, it } from "vitest";
import {
  chooseHighestReasoningEffort,
  extractApiErrorDetails,
  extractSupportedReasoningEfforts,
  formatReasoningEffortLabel,
  getCompatibleReasoningEffort,
  isUnsupportedReasoningEffortError,
  normalizeReasoningEffort,
  parseReasoningEffortFromConfig,
  sortReasoningEffortsDescending,
  unwrapApiErrorMessage,
} from "../util/reasoning";

describe("reasoning helpers", () => {
  it("parses the configured reasoning effort from config", () => {
    expect(parseReasoningEffortFromConfig('model = "gpt-5.4"\nmodel_reasoning_effort = "xhigh"\n')).toBe("xhigh");
    expect(parseReasoningEffortFromConfig('model = "gpt-5.4"\n')).toBeNull();
    expect(normalizeReasoningEffort("middle")).toBe("medium");
    expect(normalizeReasoningEffort("x-high")).toBe("xhigh");
    expect(formatReasoningEffortLabel("xhigh")).toBe("x-high");
    expect(formatReasoningEffortLabel("high", "ja")).toBe("高");
  });

  it("clamps xhigh for gpt-5.1-codex models", () => {
    expect(getCompatibleReasoningEffort("gpt-5.1-codex", "xhigh")).toBe("high");
    expect(getCompatibleReasoningEffort("gpt-5.1-codex-1p-codexswic-ev3", "xhigh")).toBe("high");
    expect(getCompatibleReasoningEffort("gpt-5.4", "xhigh")).toBe("xhigh");
  });

  it("extracts supported efforts and chooses the highest compatible one", () => {
    const supported = extractSupportedReasoningEfforts(
      "Unsupported value: 'xhigh' is not supported with the model. Supported values are: 'low', 'medium', and 'high'.",
    );
    expect(supported).toEqual(["low", "medium", "high"]);
    expect(chooseHighestReasoningEffort(supported)).toBe("high");
  });

  it("sorts supported efforts into descending picker order", () => {
    expect(sortReasoningEffortsDescending(["medium", "xhigh"])).toEqual(["xhigh", "medium"]);
    expect(sortReasoningEffortsDescending(["low", "high", "medium"])).toEqual(["high", "medium", "low"]);
  });

  it("unwraps structured API errors", () => {
    const raw = JSON.stringify({
      type: "error",
      error: {
        type: "invalid_request_error",
        code: "unsupported_value",
        message: "Unsupported value: 'xhigh' is not supported with the model.",
        param: "reasoning.effort",
      },
      status: 400,
    });

    expect(extractApiErrorDetails(raw)).toEqual({
      code: "unsupported_value",
      message: "Unsupported value: 'xhigh' is not supported with the model.",
      param: "reasoning.effort",
    });
    expect(unwrapApiErrorMessage(raw)).toBe("Unsupported value: 'xhigh' is not supported with the model.");
    expect(isUnsupportedReasoningEffortError(raw)).toBe(true);
  });
});
