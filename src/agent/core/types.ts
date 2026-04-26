import type {
  CodexRuntime,
  ComposeMode,
  ComposerAttachment,
  RuntimeMode,
  TurnContextSnapshot,
} from "../../model/types";
import type {
  ParsedAssistantOp,
  ParsedAssistantPatch,
  ParsedAssistantPlanSignal,
  ParsedAssistantProposalResult,
  ParsedAssistantStudyCheckpoint,
  ParsedAssistantSuggestionSignal,
} from "../../util/assistantProposals";
import type { ReasoningEffort } from "../../util/reasoning";
import type { CodexRunWatchdogStage } from "../../util/codexRunWatchdog";

export type AgentCapabilityKind = "slash" | "skill" | "recipe" | "mention" | "session";

export interface AgentCapability {
  id: string;
  kind: AgentCapabilityKind;
  trigger: string;
  label: string;
  description: string;
  source: "builtin" | "custom_prompt" | "skill_alias" | "study_recipe" | "mention";
  payload?: Record<string, string | number | boolean | null | undefined>;
}

export interface AgentContextNote {
  path: string;
  text: string | null;
}

export interface AgentContextSelection {
  text: string;
  sourcePath: string | null;
}

export interface AgentContextBundle {
  vaultRoot: string;
  activeNote: AgentContextNote | null;
  targetNote: AgentContextNote | null;
  selection: AgentContextSelection | null;
  attachments: {
    items: ComposerAttachment[];
    manifestText: string | null;
    contentText: string | null;
    missingPdfTextNames: string[];
    missingSourceNames: string[];
  };
  pinnedContext: {
    text: string | null;
  };
  mentions: {
    text: string | null;
    skillNames: string[];
    sourcePathHints: string[];
    explicitTargetNotePath: string | null;
    workingDirectoryHint: string | null;
  };
  externalSourceHints: string[];
  sourceAcquisition: {
    mode: TurnContextSnapshot["sourceAcquisitionMode"];
    contractText: string | null;
  };
  overlays: {
    workflowText: string | null;
    pluginFeatureText: string | null;
    studyCoachText: string | null;
    userAdaptationText: string | null;
    conversationSummaryText: string | null;
    paperStudyRuntimeOverlayText: string | null;
    skillGuideText: string | null;
    paperStudyGuideText: string | null;
    noteSourcePackText: string | null;
    contextPackText: string | null;
    dailyNotePath: string | null;
  };
  legacy: TurnContextSnapshot;
}

export type AgentArtifactKind =
  | "obsidian-patch"
  | "obsidian-ops"
  | "obsidian-plan"
  | "obsidian-suggest"
  | "obsidian-study-checkpoint";

export type AgentArtifact =
  | { kind: "obsidian-patch"; payload: ParsedAssistantPatch; sourceIndex: number }
  | { kind: "obsidian-ops"; payload: ParsedAssistantOp; sourceIndex: number }
  | { kind: "obsidian-plan"; payload: ParsedAssistantPlanSignal; sourceIndex: null }
  | { kind: "obsidian-suggest"; payload: ParsedAssistantSuggestionSignal; sourceIndex: null }
  | { kind: "obsidian-study-checkpoint"; payload: ParsedAssistantStudyCheckpoint; sourceIndex: null };

export interface AgentPermissionProfile {
  sandboxMode: "read-only" | "workspace-write";
  approvalPolicy: "untrusted" | "on-failure" | "never";
}

export interface AgentRuntimeCallbacks {
  onJsonEvent: (event: Record<string, unknown>) => void;
  onSessionId: (threadId: string) => void;
  onLiveness: (observedAt: number) => void;
  onMeaningfulProgress: (observedAt: number) => void;
  onWatchdogStageChange?: (stage: Exclude<CodexRunWatchdogStage, "healthy">) => void;
}

export interface AgentTurnRequest {
  tabId: string;
  visiblePrompt: string;
  executionPrompt: string;
  prompt: string;
  mode: RuntimeMode;
  composeMode: ComposeMode;
  threadId: string | null;
  workingDirectory: string;
  runtime: CodexRuntime;
  executablePath: string;
  launcherOverrideParts?: string[];
  model: string;
  reasoningEffort: ReasoningEffort | null;
  permissionProfile: AgentPermissionProfile;
  images: string[];
  contextBundle: AgentContextBundle;
  capabilities: AgentCapability[];
  fastMode: boolean;
  signal: AbortSignal;
  watchdogRecoveryAttempted?: boolean;
}

export interface AgentRuntimeRequest extends AgentTurnRequest, AgentRuntimeCallbacks {}

export interface AgentRuntimeResult {
  threadId: string | null;
}

export interface AgentRuntime {
  run(request: AgentRuntimeRequest): Promise<AgentRuntimeResult>;
}

export function agentContextBundleFromTurnContext(
  context: TurnContextSnapshot,
  options: {
    attachments?: readonly ComposerAttachment[];
    mentionSkillNames?: readonly string[];
    mentionSourcePathHints?: readonly string[];
    explicitTargetNotePath?: string | null;
    workingDirectoryHint?: string | null;
  } = {},
): AgentContextBundle {
  return {
    vaultRoot: context.vaultRoot,
    activeNote: context.activeFilePath ? { path: context.activeFilePath, text: context.noteSourcePackText } : null,
    targetNote: context.targetNotePath ? { path: context.targetNotePath, text: context.noteSourcePackText } : null,
    selection: context.selection ? { text: context.selection, sourcePath: context.selectionSourcePath } : null,
    attachments: {
      items: [...(options.attachments ?? [])],
      manifestText: context.attachmentManifestText,
      contentText: context.attachmentContentText,
      missingPdfTextNames: [...context.attachmentMissingPdfTextNames],
      missingSourceNames: [...context.attachmentMissingSourceNames],
    },
    pinnedContext: {
      text: context.contextPackText,
    },
    mentions: {
      text: context.mentionContextText,
      skillNames: [...(options.mentionSkillNames ?? [])],
      sourcePathHints: [...(options.mentionSourcePathHints ?? [])],
      explicitTargetNotePath: options.explicitTargetNotePath ?? null,
      workingDirectoryHint: options.workingDirectoryHint ?? null,
    },
    externalSourceHints: [...(options.mentionSourcePathHints ?? [])],
    sourceAcquisition: {
      mode: context.sourceAcquisitionMode,
      contractText: context.sourceAcquisitionContractText,
    },
    overlays: {
      workflowText: context.workflowText,
      pluginFeatureText: context.pluginFeatureText,
      studyCoachText: context.studyCoachText ?? null,
      userAdaptationText: context.userAdaptationText ?? null,
      conversationSummaryText: context.conversationSummaryText,
      paperStudyRuntimeOverlayText: context.paperStudyRuntimeOverlayText,
      skillGuideText: context.skillGuideText,
      paperStudyGuideText: context.paperStudyGuideText,
      noteSourcePackText: context.noteSourcePackText,
      contextPackText: context.contextPackText,
      dailyNotePath: context.dailyNotePath,
    },
    legacy: context,
  };
}

export function createAgentArtifacts(parsed: ParsedAssistantProposalResult): AgentArtifact[] {
  return [
    ...parsed.patches.map((patch) => ({
      kind: "obsidian-patch" as const,
      payload: patch,
      sourceIndex: patch.sourceIndex,
    })),
    ...parsed.ops.map((op) => ({
      kind: "obsidian-ops" as const,
      payload: op,
      sourceIndex: op.sourceIndex,
    })),
    parsed.plan ? { kind: "obsidian-plan" as const, payload: parsed.plan, sourceIndex: null } : null,
    parsed.suggestion ? { kind: "obsidian-suggest" as const, payload: parsed.suggestion, sourceIndex: null } : null,
    parsed.studyCheckpoint
      ? { kind: "obsidian-study-checkpoint" as const, payload: parsed.studyCheckpoint, sourceIndex: null }
      : null,
  ].filter((artifact): artifact is AgentArtifact => Boolean(artifact));
}
