import { describe, expect, it } from "vitest";
import {
  createStudyQuizSession,
  formatStudyQuizSessionForPrompt,
  prepareStudyQuizSessionForUserPrompt,
  syncStudyQuizSessionFromAssistantText,
} from "../util/studyQuiz";

describe("study quiz session", () => {
  it("starts quiz practice as a five-question session", () => {
    const session = prepareStudyQuizSessionForUserPrompt(null, "I want to practice this note. Quiz me on this note.", {
      id: "quiz-1",
      now: 1,
    });

    expect(session?.total).toBe(5);
    expect(session?.currentIndex).toBe(1);
    expect(session?.status).toBe("active");
    expect(formatStudyQuizSessionForPrompt(session, "en")).toContain("Current quiz: Quiz 1/5");
  });

  it("keeps the same quiz number when the learner does not know", () => {
    const session = createStudyQuizSession("quiz-1", 1);
    const next = prepareStudyQuizSessionForUserPrompt(session, "I don't know", {
      id: "quiz-ignored",
      now: 2,
    });

    expect(next?.currentIndex).toBe(1);
    expect(next?.lastUserResponseKind).toBe("unknown");
    expect(formatStudyQuizSessionForPrompt(next, "en")).toContain("Do not advance to Quiz 2/5");
  });

  it("ignores assistant attempts to advance after an unknown answer", () => {
    const session = {
      ...createStudyQuizSession("quiz-1", 1),
      lastUserResponseKind: "unknown" as const,
    };
    const next = syncStudyQuizSessionFromAssistantText(session, "Quiz 2/5\n\nWhich side is the hypotenuse?", 3);

    expect(next.currentIndex).toBe(1);
    expect(next.questions[0]?.status).toBe("reviewed");
  });

  it("syncs to the next quiz when the assistant legitimately advances", () => {
    const session = {
      ...createStudyQuizSession("quiz-1", 1),
      lastUserResponseKind: "answer" as const,
    };
    const next = syncStudyQuizSessionFromAssistantText(session, "Quiz 2/5\n\nWhich side is the hypotenuse?", 3);

    expect(next.currentIndex).toBe(2);
    expect(next.questions[0]?.status).toBe("answered");
    expect(next.questions[1]?.prompt).toBe("Which side is the hypotenuse?");
  });

  it("completes instead of advancing beyond five questions", () => {
    const session = {
      ...createStudyQuizSession("quiz-1", 1),
      currentIndex: 5,
    };
    const next = prepareStudyQuizSessionForUserPrompt(session, "skip", {
      id: "quiz-ignored",
      now: 2,
    });

    expect(next?.status).toBe("completed");
    expect(next?.currentIndex).toBe(5);
    expect(formatStudyQuizSessionForPrompt(next, "en")).toContain("Do not create Quiz 6/5");
  });
});
