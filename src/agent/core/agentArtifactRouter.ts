import type { AssistantOutputVisibility } from "../../app/threadEventReducer";
import { extractAssistantProposals, type ParsedAssistantProposalResult } from "../../util/assistantProposals";
import { createAgentArtifacts, type AgentArtifact } from "./types";

export interface AgentArtifactRouteRequest {
  tabId: string;
  messageId: string;
  text: string;
  visibility: AssistantOutputVisibility;
  originTurnId: string | null;
}

export interface AgentArtifactRouteResult extends AgentArtifactRouteRequest {
  parsed: ParsedAssistantProposalResult;
  artifacts: AgentArtifact[];
}

export interface AgentArtifactRouterDeps {
  onRoute?: (result: AgentArtifactRouteResult) => void | Promise<void>;
}

export class AgentArtifactRouter {
  constructor(private readonly deps: AgentArtifactRouterDeps = {}) {}

  async routeAssistantText(request: AgentArtifactRouteRequest): Promise<AgentArtifactRouteResult> {
    const parsed = extractAssistantProposals(request.text);
    const result = {
      ...request,
      parsed,
      artifacts: createAgentArtifacts(parsed),
    };
    await this.deps.onRoute?.(result);
    return result;
  }
}
