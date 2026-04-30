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

  it("restarts an active quiz when the learner asks to quiz them again", () => {
    const session = {
      ...createStudyQuizSession("quiz-old", 1),
      currentIndex: 3,
      answeredCount: 2,
      questions: [
        {
          index: 1,
          prompt: "Old question",
          choices: [],
          answer: null,
          explanation: null,
          status: "answered" as const,
        },
      ],
      lastUserResponseKind: null,
    };
    const next = prepareStudyQuizSessionForUserPrompt(session, "quiz me on this note", {
      id: "quiz-new",
      now: 2,
    });

    expect(next?.id).toBe("quiz-new");
    expect(next?.currentIndex).toBe(1);
    expect(next?.answeredCount).toBe(0);
    expect(next?.questions).toEqual([]);
    expect(next?.lastUserResponseKind).toBe("start");
  });

  it("keeps numeric responses as answers during an active quiz", () => {
    const session = createStudyQuizSession("quiz-1", 1);
    const next = prepareStudyQuizSessionForUserPrompt(session, "10", {
      id: "quiz-ignored",
      now: 2,
    });

    expect(next?.id).toBe("quiz-1");
    expect(next?.lastUserResponseKind).toBe("answer");
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

  it("syncs headingless correct feedback to the next quiz", () => {
    const session = {
      ...createStudyQuizSession("quiz-1", 1),
      questions: [
        {
          index: 1,
          prompt: "If the hypotenuse is 13 and one leg is 5, what is the other leg?",
          choices: [],
          answer: null,
          explanation: null,
          status: "pending" as const,
        },
      ],
      lastUserResponseKind: "answer" as const,
    };
    const next = syncStudyQuizSessionFromAssistantText(
      session,
      [
        "Correct.",
        "Hint: for a missing leg, use b = sqrt(c^2 - a^2).",
        "If the hypotenuse is 10 and one leg is 6, what is the other leg?",
      ].join("\n\n"),
      3,
    );

    expect(next.currentIndex).toBe(2);
    expect(next.questions[0]?.status).toBe("answered");
    expect(next.questions[1]?.prompt).toBe("If the hypotenuse is 10 and one leg is 6, what is the other leg?");
    expect(next.lastUserResponseKind).toBeNull();
  });

  it("does not advance on headingless incorrect feedback", () => {
    const session = {
      ...createStudyQuizSession("quiz-1", 1),
      questions: [
        {
          index: 1,
          prompt: "Which side is the hypotenuse?",
          choices: [],
          answer: null,
          explanation: null,
          status: "pending" as const,
        },
      ],
      lastUserResponseKind: "answer" as const,
    };
    const next = syncStudyQuizSessionFromAssistantText(
      session,
      "Not quite.\n\nHint: the hypotenuse is opposite the right angle.\n\nWhich side is the hypotenuse?",
      3,
    );

    expect(next.currentIndex).toBe(1);
    expect(next.questions[0]?.status).toBe("reviewed");
    expect(next.lastUserResponseKind).toBeNull();
  });

  it("syncs Japanese headingless correct feedback to the next quiz", () => {
    const session = {
      ...createStudyQuizSession("quiz-1", 1),
      questions: [
        {
          index: 1,
          prompt: "斜辺が 13、一辺が 5 のとき、もう一辺は？",
          choices: [],
          answer: null,
          explanation: null,
          status: "pending" as const,
        },
      ],
      lastUserResponseKind: "answer" as const,
    };
    const next = syncStudyQuizSessionFromAssistantText(
      session,
      ["正解です。", "次の問題です。", "斜辺が 10、一辺が 6 のとき、もう一辺は？"].join("\n\n"),
      3,
    );

    expect(next.currentIndex).toBe(2);
    expect(next.questions[0]?.status).toBe("answered");
    expect(next.questions[1]?.prompt).toBe("斜辺が 10、一辺が 6 のとき、もう一辺は？");
    expect(next.lastUserResponseKind).toBeNull();
  });

  it("does not advance on Japanese headingless incorrect feedback", () => {
    const session = {
      ...createStudyQuizSession("quiz-1", 1),
      questions: [
        {
          index: 1,
          prompt: "斜辺はどの辺ですか？",
          choices: [],
          answer: null,
          explanation: null,
          status: "pending" as const,
        },
      ],
      lastUserResponseKind: "answer" as const,
    };
    const next = syncStudyQuizSessionFromAssistantText(
      session,
      "違います。\n\nヒント: 斜辺は直角の向かい側です。\n\n斜辺はどの辺ですか？",
      3,
    );

    expect(next.currentIndex).toBe(1);
    expect(next.questions[0]?.status).toBe("reviewed");
    expect(next.lastUserResponseKind).toBeNull();
  });

  it("does not advance on soft-positive incorrect feedback", () => {
    const session = {
      ...createStudyQuizSession("quiz-1", 1),
      questions: [
        {
          index: 1,
          prompt: "What is the missing leg?",
          choices: [],
          answer: null,
          explanation: null,
          status: "pending" as const,
        },
      ],
      lastUserResponseKind: "answer" as const,
    };
    const next = syncStudyQuizSessionFromAssistantText(
      session,
      "Good try, but not quite.\n\nHint: subtract the known leg from the hypotenuse squared.\n\nWhat is the missing leg?",
      3,
    );

    expect(next.currentIndex).toBe(1);
    expect(next.questions[0]?.status).toBe("reviewed");
    expect(next.lastUserResponseKind).toBeNull();
  });

  it("requires visible quiz headings in the prompt contract", () => {
    const session = {
      ...createStudyQuizSession("quiz-1", 1),
      lastUserResponseKind: "answer" as const,
    };
    const prompt = formatStudyQuizSessionForPrompt(session, "en");

    expect(prompt).toContain('Every visible quiz question must include a "Quiz n/5" heading.');
    expect(prompt).toContain('If the answer is correct, advance with "Quiz 2/5".');
  });

  it("instructs quiz turns to ask the question before any hint", () => {
    const session = createStudyQuizSession("quiz-1", 1);
    const prompt = formatStudyQuizSessionForPrompt(session, "en");

    expect(prompt).toContain("Question order: show the Quiz heading and question first, then any optional hint.");
    expect(prompt).toContain("Never start a fresh quiz question with Hint.");
    expect(prompt).toContain("Fresh quiz questions must not include a leading `Hint:` line.");
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
