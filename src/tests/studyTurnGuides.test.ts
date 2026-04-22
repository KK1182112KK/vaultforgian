import { describe, expect, it } from "vitest";
import { buildPaperStudyGuideText, isPaperStudySkillName, shouldAttachPaperStudyGuide } from "../util/studyTurnGuides";

describe("study turn guides", () => {
  it("detects paper-study skills", () => {
    expect(isPaperStudySkillName("deep-read")).toBe(true);
    expect(isPaperStudySkillName("study-material-builder")).toBe(true);
    expect(isPaperStudySkillName("deep-research")).toBe(true);
    expect(isPaperStudySkillName("lecture-read")).toBe(false);
  });

  it("attaches the paper-study guide for paper workflow or explicit paper-study skills", () => {
    expect(
      shouldAttachPaperStudyGuide({
        locale: "en",
        studyWorkflow: "paper",
        skillNames: [],
        attachmentKinds: [],
      }),
    ).toBe(true);
    expect(
      shouldAttachPaperStudyGuide({
        locale: "en",
        studyWorkflow: null,
        skillNames: ["deep-read"],
        attachmentKinds: [],
      }),
    ).toBe(true);
    expect(
      shouldAttachPaperStudyGuide({
        locale: "en",
        studyWorkflow: null,
        skillNames: ["lecture-read"],
        attachmentKinds: ["pdf"],
      }),
    ).toBe(false);
  });

  it("builds a localized paper-study guide only when the turn should get one", () => {
    expect(
      buildPaperStudyGuideText({
        locale: "ja",
        studyWorkflow: null,
        skillNames: ["deep-research"],
        attachmentKinds: ["pdf"],
      }),
    ).toContain("著者の主張");
    expect(
      buildPaperStudyGuideText({
        locale: "en",
        studyWorkflow: null,
        skillNames: [],
        attachmentKinds: [],
      }),
    ).toBeNull();
  });
});
