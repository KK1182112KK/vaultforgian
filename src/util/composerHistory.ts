export interface ComposerHistoryState {
  entries: string[];
  index: number | null;
  draft: string | null;
}

export const EMPTY_COMPOSER_HISTORY_STATE: ComposerHistoryState = {
  entries: [],
  index: null,
  draft: null,
};

export function pushComposerHistoryEntry(
  state: ComposerHistoryState,
  prompt: string,
  maxEntries = 50,
): ComposerHistoryState {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return {
      ...state,
      index: null,
      draft: null,
    };
  }
  const entries = [...state.entries, trimmed].slice(-maxEntries);
  return {
    entries,
    index: null,
    draft: null,
  };
}

export function clearComposerHistoryNavigation(state: ComposerHistoryState): ComposerHistoryState {
  if (state.index === null && state.draft === null) {
    return state;
  }
  return {
    ...state,
    index: null,
    draft: null,
  };
}

export function stepComposerHistory(
  state: ComposerHistoryState,
  currentDraft: string,
  direction: "older" | "newer",
): { nextState: ComposerHistoryState; nextDraft: string | null } {
  if (direction === "older") {
    if (state.entries.length === 0) {
      return { nextState: state, nextDraft: null };
    }
    if (state.index === null) {
      const nextIndex = state.entries.length - 1;
      return {
        nextState: {
          entries: [...state.entries],
          index: nextIndex,
          draft: currentDraft,
        },
        nextDraft: state.entries[nextIndex] ?? "",
      };
    }
    const nextIndex = Math.max(0, state.index - 1);
    return {
      nextState: {
        ...state,
        index: nextIndex,
      },
      nextDraft: state.entries[nextIndex] ?? "",
    };
  }

  if (state.index === null) {
    return { nextState: state, nextDraft: null };
  }
  const nextIndex = state.index + 1;
  if (nextIndex >= state.entries.length) {
    return {
      nextState: {
        entries: [...state.entries],
        index: null,
        draft: null,
      },
      nextDraft: state.draft ?? "",
    };
  }
  return {
    nextState: {
      ...state,
      index: nextIndex,
    },
    nextDraft: state.entries[nextIndex] ?? "",
  };
}
