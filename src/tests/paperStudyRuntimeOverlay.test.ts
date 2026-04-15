import { describe, expect, it } from "vitest";
import { buildPaperStudyRuntimeOverlayText } from "../util/paperStudyRuntimeOverlay";

describe("paperStudyRuntimeOverlay", () => {
  it("returns null when there is no attached source text", () => {
    expect(
      buildPaperStudyRuntimeOverlayText({
        locale: "en",
        studyWorkflow: "paper",
        skillNames: ["deep-read"],
        hasAttachmentContent: false,
      }),
    ).toBeNull();
  });

  it("builds an overlay for deep-read and study-material-builder turns with extracted text", () => {
    const text = buildPaperStudyRuntimeOverlayText({
      locale: "ja",
      studyWorkflow: null,
      skillNames: ["deep-read", "study-material-builder"],
      hasAttachmentContent: true,
    });

    expect(text).toContain("source ingestion はすでに完了");
    expect(text).toContain("FOR THIS TURN, SOURCE INGESTION IS CLOSED.");
    expect(text).toContain("Workflow 1");
    expect(text).toContain("source bundle inspection");
    expect(text).toContain("staging path の再読込");
    expect(text).toContain("Abstract を貼ってください");
    expect(text).toContain("sandbox 初期化エラーです");
  });

  it("does not attach the overlay for unrelated skills", () => {
    expect(
      buildPaperStudyRuntimeOverlayText({
        locale: "en",
        studyWorkflow: null,
        skillNames: ["lecture-read"],
        hasAttachmentContent: true,
      }),
    ).toBeNull();
  });
});
