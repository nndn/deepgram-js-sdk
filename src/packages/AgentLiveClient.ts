import { DEFAULT_AGENT_URL } from "../lib/constants";
import { AgentEvents } from "../lib/enums/AgentEvents";
import type { AgentLiveSchema, DeepgramClientOptions, FunctionCallResponse } from "../lib/types";
import { AbstractLiveClient } from "./AbstractLiveClient";

export class AgentLiveClient extends AbstractLiveClient {
  public namespace: string = "agent";

  constructor(options: DeepgramClientOptions, endpoint: string = "/:version/agent/converse") {
    super(options);
    this.baseUrl = options.url || DEFAULT_AGENT_URL;
    this.endpoint = endpoint;
  }

  /**
   * Event handler for incoming messages
   */
  onmessage = (event: MessageEvent): void => {
    const response: FunctionCallResponse = JSON.parse(event.data);

    this.emit(AgentEvents.FunctionCallResponse, response);
  };

  /**
   * Get the default KeepAlive interval for Agent connections
   * Returns 8000ms (8 seconds) for Agent-specific timing
   */
  protected getDefaultKeepAliveInterval(): number {
    return 8000;
  }
}
