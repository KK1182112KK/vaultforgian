import type { StudyQuizQuestion, StudyQuizSession, StudyQuizUserResponseKind } from "../model/types";

export const DEFAULT_STUDY_QUIZ_TOTAL = 5;

const QUIZ_START_RE = /\b(?:quiz|test|drill|practice|question me)\b|小テスト|確認問題|問題を出して|クイズ/u;
const UNKNOWN_RE = /\b(?:i\s+don'?t\s+know|idk|not\s+sure|no\s+idea|unsure)\b|わからない|分からない|知らない|不明/iu;
const NEXT_RE = /^(?:next|continue|go on|次|次へ|進んで)$/iu;
const SKIP_RE = /^(?:skip|pass|スキップ|飛ばして)$/iu;
const QUIZ_HEADING_RE = /^\s{0,3}#{0,6}\s*Quiz\s+(\d+)(?:\s*\/\s*(\d+))?\b/im;
const CHOICE_RE = /^\s*(?:[-*]\s+|\d+[.)]\s+)/u;
const CORRECT_FEEDBACK_RE = /^\s*(?:(?:correct|right|yes|good|nice|exactly)(?![A-Za-z0-9_])|正解|その通り)/iu;
const INCORRECT_FEEDBACK_RE = /^\s*(?:(?:not\s+quite|incorrect|wrong|close|no)(?![A-Za-z0-9_])|惜しい|違います|不正解)/iu;
const QUALIFIED_INCORRECT_FEEDBACK_RE =
  /^\s*(?:(?:good|nice|right|yes)(?![A-Za-z0-9_])|良い|いい|惜しい)[^.!?。！？]{0,100}(?:\bbut\b|\bhowever\b|not\s+quite|wrong|incorrect|違|不正解|惜しい)/iu;
const QUESTION_SENTENCE_RE = /(?:^|[\s。.!！？])([^?？\n]+[?？])/gu;

export function createStudyQuizSession(id: string, now: number, total = DEFAULT_STUDY_QUIZ_TOTAL): StudyQuizSession {
  return {
    id,
    total: normalizeQuizTotal(total),
    currentIndex: 1,
    answeredCount: 0,
    status: "active",
    questions: [],
    startedAt: now,
    updatedAt: now,
    lastUserResponseKind: "start",
  };
}

export function classifyStudyQuizUserResponse(prompt: string, current: StudyQuizSession | null): StudyQuizUserResponseKind | null {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return null;
  }
  if (UNKNOWN_RE.test(trimmed)) {
    return "unknown";
  }
  if (SKIP_RE.test(trimmed)) {
    return "skip";
  }
  if (NEXT_RE.test(trimmed)) {
    return "next";
  }
  if (QUIZ_START_RE.test(trimmed)) {
    return "start";
  }
  if (!current || current.status === "completed") {
    return null;
  }
  return "answer";
}

export function prepareStudyQuizSessionForUserPrompt(
  current: StudyQuizSession | null,
  prompt: string,
  options: { id: string; now: number; total?: number },
): StudyQuizSession | null {
  const kind = classifyStudyQuizUserResponse(prompt, current);
  if (!kind) {
    return current;
  }
  if (kind === "start") {
    return createStudyQuizSession(options.id, options.now, options.total ?? DEFAULT_STUDY_QUIZ_TOTAL);
  }
  if (!current) {
    return null;
  }
  if (kind === "skip" || kind === "next") {
    return advanceStudyQuizSession(current, kind, options.now);
  }
  return {
    ...current,
    lastUserResponseKind: kind,
    updatedAt: options.now,
  };
}

export function syncStudyQuizSessionFromAssistantText(current: StudyQuizSession, text: string, now: number): StudyQuizSession {
  const match = text.match(QUIZ_HEADING_RE);
  const parsedIndex = match ? Number.parseInt(match[1] ?? "", 10) : null;
  const parsedTotal = match?.[2] ? Number.parseInt(match[2], 10) : null;
  const total = parsedTotal && Number.isFinite(parsedTotal) ? normalizeQuizTotal(parsedTotal) : current.total;
  const questionPrompt = parsedIndex ? extractQuestionPrompt(text, parsedIndex) : null;
  const headinglessQuestionPrompt = parsedIndex ? null : extractHeadinglessQuestionPrompt(text);

  if (!parsedIndex || !Number.isFinite(parsedIndex)) {
    if (current.lastUserResponseKind === "unknown") {
      return {
        ...markCurrentQuestion(current, {
          status: "reviewed",
          prompt: headinglessQuestionPrompt,
          now,
        }),
        lastUserResponseKind: null,
      };
    }

    if (current.lastUserResponseKind === "answer" && isIncorrectAssistantFeedback(text)) {
      return {
        ...markCurrentQuestion(current, {
          status: "reviewed",
          prompt: headinglessQuestionPrompt,
          now,
        }),
        lastUserResponseKind: null,
      };
    }

    if (current.lastUserResponseKind === "answer" && isCorrectAssistantFeedback(text)) {
      const advanced = advanceStudyQuizSession(current, "next", now);
      if (advanced.status === "completed") {
        return {
          ...advanced,
          lastUserResponseKind: null,
        };
      }
      return {
        ...advanced,
        questions: headinglessQuestionPrompt
          ? upsertQuestion(advanced.questions, {
              index: advanced.currentIndex,
              prompt: headinglessQuestionPrompt,
              status: "pending",
            })
          : advanced.questions,
        lastUserResponseKind: null,
      };
    }

    return { ...current, updatedAt: now };
  }

  if (parsedIndex > total) {
    return {
      ...current,
      total,
      currentIndex: total,
      status: "completed",
      lastUserResponseKind: null,
      updatedAt: now,
    };
  }

  if (current.lastUserResponseKind === "unknown" && parsedIndex > current.currentIndex) {
    return markCurrentQuestion(current, {
      status: "reviewed",
      prompt: questionPrompt,
      now,
    });
  }

  const nextQuestions = upsertQuestion(current.questions, {
    index: parsedIndex,
    prompt: questionPrompt ?? "",
    status: "pending",
  });
  const questions =
    parsedIndex > current.currentIndex
      ? upsertQuestion(nextQuestions, {
          index: current.currentIndex,
          status: "answered",
        })
      : nextQuestions;
  return {
    ...current,
    total,
    currentIndex: Math.max(1, Math.min(parsedIndex, total)),
    answeredCount: questions.filter((question) => question.status === "answered" || question.status === "skipped").length,
    status: parsedIndex >= total && /complete|finished|終了|完了/iu.test(text) ? "completed" : "active",
    questions,
    lastUserResponseKind: null,
    updatedAt: now,
  };
}

export function formatStudyQuizSessionForPrompt(session: StudyQuizSession | null | undefined, locale: "en" | "ja"): string | null {
  if (!session) {
    return null;
  }
  const currentLabel = `Quiz ${session.currentIndex}/${session.total}`;
  const nextLabel =
    session.currentIndex < session.total ? `Quiz ${session.currentIndex + 1}/${session.total}` : `Quiz ${session.total}/${session.total}`;
  const lines = [
    "Study quiz session:",
    `- Total questions: ${session.total}.`,
    `- Current quiz: ${currentLabel}.`,
    `- Answered/skipped count: ${session.answeredCount}.`,
    `- Session status: ${session.status}.`,
  ];
  const currentQuestion = session.questions.find((question) => question.index === session.currentIndex);
  if (currentQuestion?.prompt) {
    lines.push(`- Current question prompt: ${currentQuestion.prompt}`);
  }
  if (session.status === "completed") {
    lines.push(`- The five-question quiz is complete. Do not create Quiz ${session.total + 1}/${session.total}.`);
  } else if (session.lastUserResponseKind === "unknown") {
    lines.push(
      `- Learner response: unknown. Briefly explain ${currentLabel}, then ask ${currentLabel} again or a same-number follow-up.`,
    );
    lines.push(`- Do not advance to Quiz ${Math.min(session.currentIndex + 1, session.total)}/${session.total}.`);
  } else if (session.lastUserResponseKind === "skip" || session.lastUserResponseKind === "next") {
    lines.push(`- The learner explicitly moved on. Ask ${currentLabel}.`);
  } else if (session.lastUserResponseKind === "answer") {
    lines.push(
      `- Evaluate the learner's answer to ${currentLabel}. Advance only if it is correct or the learner explicitly asked to skip/continue.`,
    );
    lines.push(`- If the answer is correct, advance with "${nextLabel}". If it is not correct, keep "${currentLabel}".`);
  } else {
    lines.push(`- Ask exactly one question as ${currentLabel}.`);
  }
  lines.push(
    `- Use the visible heading "${currentLabel}" for the current question. Never reuse this heading for a different question.`,
  );
  lines.push(`- Every visible quiz question must include a "Quiz n/${session.total}" heading.`);
  lines.push("- Question order: show the Quiz heading and question first, then any optional hint.");
  lines.push("- Never start a fresh quiz question with Hint.");
  lines.push("- Fresh quiz questions must not include a leading `Hint:` line.");
  lines.push("- Keep quiz explanations concise and do not expose this hidden quiz session state.");
  if (locale === "ja") {
    lines.push("- User-visible quiz text must follow the selected plugin language unless the user writes in another language.");
  }
  return lines.join("\n");
}

function normalizeQuizTotal(total: number): number {
  return Number.isFinite(total) && total > 0 ? Math.max(1, Math.floor(total)) : DEFAULT_STUDY_QUIZ_TOTAL;
}

function advanceStudyQuizSession(current: StudyQuizSession, kind: "next" | "skip", now: number): StudyQuizSession {
  const questions = upsertQuestion(current.questions, {
    index: current.currentIndex,
    status: kind === "skip" ? "skipped" : "answered",
  });
  if (current.currentIndex >= current.total) {
    return {
      ...current,
      questions,
      answeredCount: questions.filter((question) => question.status === "answered" || question.status === "skipped").length,
      status: "completed",
      lastUserResponseKind: kind,
      updatedAt: now,
    };
  }
  return {
    ...current,
    currentIndex: current.currentIndex + 1,
    questions,
    answeredCount: questions.filter((question) => question.status === "answered" || question.status === "skipped").length,
    status: "active",
    lastUserResponseKind: kind,
    updatedAt: now,
  };
}

function markCurrentQuestion(
  current: StudyQuizSession,
  options: { status: StudyQuizQuestion["status"]; prompt?: string | null; now: number },
): StudyQuizSession {
  const questions = upsertQuestion(current.questions, {
    index: current.currentIndex,
    prompt: options.prompt ?? undefined,
    status: options.status,
  });
  return {
    ...current,
    questions,
    answeredCount: questions.filter((question) => question.status === "answered" || question.status === "skipped").length,
    updatedAt: options.now,
  };
}

function upsertQuestion(
  questions: readonly StudyQuizQuestion[],
  patch: { index: number; prompt?: string; status?: StudyQuizQuestion["status"] },
): StudyQuizQuestion[] {
  const existing = questions.find((question) => question.index === patch.index) ?? null;
  const next: StudyQuizQuestion = {
    index: patch.index,
    prompt: patch.prompt?.trim() || existing?.prompt || "",
    choices: existing?.choices ? [...existing.choices] : [],
    answer: existing?.answer ?? null,
    explanation: existing?.explanation ?? null,
    status: patch.status ?? existing?.status ?? "pending",
  };
  return [...questions.filter((question) => question.index !== patch.index), next].sort((a, b) => a.index - b.index);
}

function extractQuestionPrompt(text: string, quizIndex: number): string | null {
  const lines = text.split(/\r?\n/u);
  const headingIndex = lines.findIndex((line) => {
    const match = line.match(QUIZ_HEADING_RE);
    return match ? Number.parseInt(match[1] ?? "", 10) === quizIndex : false;
  });
  if (headingIndex < 0) {
    return null;
  }
  for (const line of lines.slice(headingIndex + 1)) {
    const trimmed = line.trim();
    if (!trimmed || CHOICE_RE.test(trimmed) || /^reply with\b/i.test(trimmed)) {
      continue;
    }
    return trimmed.replace(/^\*\*(.+)\*\*$/u, "$1");
  }
  return null;
}

function isCorrectAssistantFeedback(text: string): boolean {
  return CORRECT_FEEDBACK_RE.test(getLeadingFeedbackLine(text));
}

function isIncorrectAssistantFeedback(text: string): boolean {
  const leadingLine = getLeadingFeedbackLine(text);
  return INCORRECT_FEEDBACK_RE.test(leadingLine) || QUALIFIED_INCORRECT_FEEDBACK_RE.test(leadingLine);
}

function getLeadingFeedbackLine(text: string): string {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean) ?? "";
}

function extractHeadinglessQuestionPrompt(text: string): string | null {
  const blocks = text
    .split(/\n{2,}/u)
    .map((block) =>
      block
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
        .join(" "),
    )
    .filter(Boolean);

  for (const block of blocks.reverse()) {
    const question = extractLastQuestionSentence(block);
    if (question) {
      return question;
    }
  }

  return null;
}

function extractLastQuestionSentence(text: string): string | null {
  const matches = [...text.matchAll(QUESTION_SENTENCE_RE)];
  const raw = matches.at(-1)?.[1]?.trim();
  if (!raw) {
    return null;
  }
  return raw
    .replace(/^\s*(?:[-*]\s+|\d+[.)]\s+)/u, "")
    .replace(/^\*\*(.+)\*\*$/u, "$1")
    .replace(/^Quiz\s+\d+(?:\s*\/\s*\d+)?\s*/iu, "")
    .trim();
}
