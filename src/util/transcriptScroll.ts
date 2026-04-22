export interface TranscriptScrollDecisionInput {
  activeTabId: string | null;
  previousTabId: string | null;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  threshold?: number;
}

export const DEFAULT_TRANSCRIPT_BOTTOM_THRESHOLD = 8;

export function shouldStickTranscriptToBottom(input: TranscriptScrollDecisionInput): boolean {
  if (input.activeTabId !== input.previousTabId) {
    return true;
  }
  const threshold = input.threshold ?? DEFAULT_TRANSCRIPT_BOTTOM_THRESHOLD;
  const distanceFromBottom = input.scrollHeight - (input.scrollTop + input.clientHeight);
  return distanceFromBottom <= threshold;
}

export function clampTranscriptScrollTop(scrollTop: number, scrollHeight: number, clientHeight: number): number {
  return Math.max(0, Math.min(scrollTop, Math.max(0, scrollHeight - clientHeight)));
}
