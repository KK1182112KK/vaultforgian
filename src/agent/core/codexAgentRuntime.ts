import type { AgentRuntime, AgentRuntimeRequest, AgentRuntimeResult } from "./types";
import type { CodexRuntimeAdapter } from "../../app/codexRuntimeAdapter";

export class CodexCliAgentRuntime implements AgentRuntime {
  constructor(private readonly adapter: CodexRuntimeAdapter) {}

  async run(request: AgentRuntimeRequest): Promise<AgentRuntimeResult> {
    const result = await this.adapter.run({
      prompt: request.prompt,
      tabId: request.tabId,
      threadId: request.threadId,
      workingDirectory: request.workingDirectory,
      runtime: request.runtime,
      executablePath: request.executablePath,
      launcherOverrideParts: request.launcherOverrideParts,
      sandboxMode: request.permissionProfile.sandboxMode,
      approvalPolicy: request.permissionProfile.approvalPolicy,
      images: request.images,
      model: request.model,
      reasoningEffort: request.reasoningEffort,
      fastMode: request.fastMode,
      signal: request.signal,
      watchdogRecoveryAttempted: request.watchdogRecoveryAttempted,
      onJsonEvent: request.onJsonEvent,
      onSessionId: request.onSessionId,
      onLiveness: request.onLiveness,
      onMeaningfulProgress: request.onMeaningfulProgress,
      onWatchdogStageChange: request.onWatchdogStageChange,
    });
    return { threadId: result.threadId };
  }
}
