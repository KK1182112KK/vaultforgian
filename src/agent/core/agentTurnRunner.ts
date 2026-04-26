import type { AgentRuntime, AgentRuntimeCallbacks, AgentRuntimeResult, AgentTurnRequest } from "./types";

export interface AgentTurnRunnerDeps {
  runtime: AgentRuntime;
}

export class AgentTurnRunner {
  constructor(private readonly deps: AgentTurnRunnerDeps) {}

  async run(request: AgentTurnRequest, callbacks: AgentRuntimeCallbacks): Promise<AgentRuntimeResult> {
    return await this.deps.runtime.run({
      ...request,
      ...callbacks,
    });
  }
}
