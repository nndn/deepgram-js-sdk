import { AbstractClient, noop } from "./AbstractClient";
import { CONNECTION_STATE, CONNECTION_EVENT, SOCKET_STATES } from "../lib/constants";
import type { DeepgramClientOptions, LiveSchema } from "../lib/types";
import type { WebSocket as WSWebSocket } from "ws";
import { isBun } from "../lib/runtime";
import { DeepgramWebSocketError } from "../lib/errors";
import { ConnectionHealthManager } from "../lib/ConnectionHealthManager";
import { ConnectionHealthOptions } from "../lib/types/ConnectionHealthOptions";
import { LiveConnectionHealthEvents } from "../lib/enums/LiveConnectionHealthEvents";
import { LiveConnectionState } from "../lib/enums/LiveConnectionState";

/**
 * Represents a constructor for a WebSocket-like object that can be used in the application.
 */
export type WebSocketConstructor = (url: string, protocols?: string | string[]) => WebSocket;

/**
 * Abstract base class for live WebSocket-based clients.
 * Provides common functionality for managing WebSocket connections with health monitoring.
 *
 * @example
 * ```typescript
 * class MyLiveClient extends AbstractLiveClient {
 *   constructor(options: DeepgramClientOptions) {
 *     super(options);
 *     this.connect({}, "/my/endpoint");
 *   }
 * }
 * ```
 */
export abstract class AbstractLiveClient extends AbstractClient {
  /**
   * Event emitter for connection events.
   */
  events: Record<string, (...args: any[]) => void>;

  /**
   * The WebSocket connection instance.
   */
  conn?: WebSocket;

  /**
   * The URL to connect to.
   */
  baseUrl: string;

  /**
   * The endpoint path to connect to.
   */
  endpoint: string;

  /**
   * Schema/options for the connection.
   */
  schema: LiveSchema = {};

  /**
   * Connection health manager for monitoring and maintaining the connection.
   */
  connectionHealth?: ConnectionHealthManager;

  /**
   * Default transcription URL.
   */
  DEFAULT_TRANSCRIPTION_URL: string = "wss://api.deepgram.com/v1/listen";

  /**
   * Default speak URL.
   */
  DEFAULT_SPEAK_URL: string = "wss://api.deepgram.com/v1/speak";

  /**
   * Default agent URL.
   */
  DEFAULT_AGENT_URL: string = "wss://api.deepgram.com/v1/agent/converse";

  /**
   * Creates a new AbstractLiveClient instance.
   *
   * @param options - Deepgram client options
   */
  constructor(options: DeepgramClientOptions) {
    super(options);

    this.events = {};
    this.baseUrl = options.url || this.DEFAULT_TRANSCRIPTION_URL;
    this.endpoint = "";
  }

  /**
   * Sets up the connection event handlers.
   *
   * @param eventMap - Mapping of connection events to emitted events
   */
  protected setupConnectionEvents(eventMap: {
    Open: string;
    Close: string;
    Error: string;
  }): void {
    if (!this.conn) {
      return;
    }

    // Handle connection open
    this.conn.onopen = () => {
      this.emit(eventMap.Open, this);
      this.log("Connection opened");
      this._setConnectionState(CONNECTION_STATE.OPEN);

      // Start health monitoring on successful connection
      if (this.connectionHealth) {
        this.connectionHealth.handleReconnectSuccess();
      }
    };

    // Handle connection close
    this.conn.onclose = (event) => {
      this.emit(eventMap.Close, event);
      this.log("Connection closed", event);
      this._setConnectionState(CONNECTION_STATE.CLOSED);

      // Stop health monitoring on close
      if (this.connectionHealth) {
        this.connectionHealth.stop();
      }

      // Attempt reconnection if enabled
      if (this.connectionHealth && this.options.connectionHealth?.reconnect?.enabled) {
        this.connectionHealth.startReconnection();
      }
    };

    // Handle connection errors
    this.conn.onerror = (event) => {
      this.emit(eventMap.Error, event);
      this.log("Connection error", event);
      this._setConnectionState(CONNECTION_STATE.ERROR);

      // Notify health manager of error
      if (this.connectionHealth) {
        this.emit(LiveConnectionHealthEvents.Error, {
          type: "ConnectionError",
          event,
        });
      }
    };
  }

  /**
   * Initializes connection health monitoring based on options.
   *
   * @param namespace - The namespace (listen, speak, agent) for default KeepAlive interval
   */
  protected initializeHealthMonitoring(namespace: string): void {
    const healthOptions = this.getHealthOptions(namespace);

    if (!healthOptions) {
      return;
    }

    const defaultKeepAliveInterval = this.getDefaultKeepAliveInterval();
    this.connectionHealth = new ConnectionHealthManager(
      healthOptions,
      defaultKeepAliveInterval
    );

    // Set up health manager callbacks
    this.connectionHealth.setKeepAliveFunction(() => this.sendKeepAliveMessage());
    this.connectionHealth.setReconnectFunction(() => this.reconnect());
    this.connectionHealth.setDisconnectFunction((code, reason) =>
      this.disconnect(code, reason)
    );

    // Set up health event listeners
    this.setupHealthEventListeners();

    this.log("Health monitoring initialized for namespace:", namespace);
  }

  /**
   * Gets the health monitoring options from client configuration.
   *
   * @param namespace - The namespace (listen, speak, agent)
   * @returns The health options, or undefined if not configured
   */
  private getHealthOptions(namespace: string): ConnectionHealthOptions | undefined {
    const namespaceKey = namespace.toLowerCase() as keyof DeepgramClientOptions;
    const namespaceOptions = this.options[namespaceKey];

    if (namespaceOptions?.connectionHealth) {
      return namespaceOptions.connectionHealth;
    }

    return this.options.connectionHealth;
  }

  /**
   * Sets up event listeners for health monitoring events.
   */
  private setupHealthEventListeners(): void {
    if (!this.connectionHealth) {
      return;
    }

    // Forward all health events
    Object.values(LiveConnectionHealthEvents).forEach((eventName) => {
      this.connectionHealth?.on(eventName, (...args: any[]) => {
        this.emit(eventName, ...args);
      });
    });
  }

  /**
   * Gets the default KeepAlive interval for the connection type.
   * Should be overridden by subclasses to provide namespace-specific intervals.
   *
   * @returns Default KeepAlive interval in milliseconds
   */
  protected getDefaultKeepAliveInterval(): number {
    return 10000; // Default 10 seconds
  }

  /**
   * Sends a KeepAlive message to the server.
   * Should be overridden by subclasses to send the appropriate message format.
   */
  protected sendKeepAliveMessage(): void {
    this.send(JSON.stringify({ type: "KeepAlive" }));
  }

  /**
   * Reconnects to the server using the same schema/options.
   */
  protected reconnect(): void {
    this.log("Reconnecting...");

    // Close existing connection
    if (this.conn) {
      this.conn.close(1000, "Reconnecting");
    }

    // Reconnect with the same schema
    this.connect(this.schema, this.endpoint);
  }

  /**
   * Disconnects from the server.
   *
   * @param code - WebSocket close code
   * @param reason - Close reason
   */
  protected disconnect(code?: number, reason?: string): void {
    this.log("Disconnecting:", reason);

    // Stop health monitoring
    if (this.connectionHealth) {
      this.connectionHealth.stop();
    }

    // Close connection
    if (this.conn) {
      this.conn.close(code, reason);
    }
  }

  /**
   * Connects to the WebSocket endpoint.
   *
   * @param schema - Schema/options for the connection
   * @param endpoint - The endpoint path
   */
  connect(schema: LiveSchema, endpoint: string): void {
    this.schema = schema;
    this.endpoint = endpoint;

    const url = this.buildUrl(schema, endpoint);
    this.log("Connecting to", url);

    this._setConnectionState(CONNECTION_STATE.CONNECTING);

    const websocketOptions = this.getWebsocketOptions();
    const protocols = this.getProtocols();

    try {
      this.conn = new (isBun ? WebSocket : (window as any).WebSocket)(
        url,
        protocols,
        websocketOptions
      );

      this.setupConnection();
    } catch (error) {
      this.log("Error creating WebSocket:", error);
      this._setConnectionState(CONNECTION_STATE.ERROR);
      this.emit(CONNECTION_EVENT.ERROR, error);
      throw new DeepgramWebSocketError(
        "Failed to create WebSocket connection",
        error as Error
      );
    }
  }

  /**
   * Sets up the connection. Should be overridden by subclasses.
   */
  protected abstract setupConnection(): void;

  /**
   * Builds the WebSocket URL.
   *
   * @param schema - Schema/options for the connection
   * @param endpoint - The endpoint path
   * @returns The complete WebSocket URL
   */
  protected buildUrl(schema: LiveSchema, endpoint: string): string {
    let url = this.baseUrl + endpoint;

    const params = new URLSearchParams();

    // Add schema parameters
    for (const [key, value] of Object.entries(schema)) {
      if (value !== undefined && value !== null) {
        if (typeof value === "object") {
          params.set(key, JSON.stringify(value));
        } else {
          params.set(key, String(value));
        }
      }
    }

    const paramString = params.toString();
    if (paramString) {
      url += `?${paramString}`;
    }

    return url;
  }

  /**
   * Gets WebSocket options from client configuration.
   *
   * @returns WebSocket options
   */
  protected getWebsocketOptions(): any {
    const namespace = this.getNamespace();
    const namespaceOptions = this.options[
      namespace.toLowerCase() as keyof DeepgramClientOptions
    ];

    if (namespaceOptions?.websocket?.options) {
      return namespaceOptions.websocket.options;
    }

    return this.options.websocket?.options;
  }

  /**
   * Gets the namespace for this client.
   * Should be overridden by subclasses.
   *
   * @returns The namespace (listen, speak, agent)
   */
  protected abstract getNamespace(): string;

  /**
   * Gets the WebSocket protocols.
   *
   * @returns WebSocket protocols
   */
  protected getProtocols(): string | string[] | undefined {
    return undefined;
  }

  /**
   * Sends data through the WebSocket connection.
   *
   * @param data - The data to send
   */
  send(data: string): void {
    if (!this.conn) {
      this.log("Error: No connection");
      this.emit(CONNECTION_EVENT.ERROR, new Error("No connection"));
      return;
    }

    if (this.conn.readyState !== SOCKET_STATES.OPEN) {
      this.log("Error: Connection not ready", this.conn.readyState);
      this.emit(
        CONNECTION_EVENT.ERROR,
        new Error(`Connection not ready (state: ${this.conn.readyState})`)
      );
      return;
    }

    this.conn.send(data);
  }

  /**
   * Registers an event listener.
   *
   * @param event - The event name
   * @param callback - The callback function
   */
  on(event: string, callback: (...args: any[]) => void): void {
    if (!this.events[event]) {
      this.events[event] = noop;
    }

    this.events[event] = callback;
  }

  /**
   * Removes an event listener.
   *
   * @param event - The event name
   */
  off(event: string): void {
    if (this.events[event]) {
      this.events[event] = noop;
    }
  }

  /**
   * Emits an event to all registered listeners.
   *
   * @param event - The event name
   * @param args - Event arguments
   */
  emit(event: string, ...args: any[]): void {
    if (this.events[event]) {
      this.events[event](...args);
    }
  }

  /**
   * Closes the WebSocket connection.
   *
   * @param code - WebSocket close code
   * @param reason - Close reason
   */
  close(code?: number, reason?: string): void {
    this.log("Closing connection");

    // Stop health monitoring
    if (this.connectionHealth) {
      this.connectionHealth.destroy();
    }

    if (this.conn) {
      this.conn.close(code, reason);
    }
  }

  /**
   * Logs a message to the console.
   *
   * @param args - Arguments to log
   */
  protected log(...args: any[]): void {
    if (this.options.debug) {
      console.log(`[AbstractLiveClient]`, ...args);
    }
  }

  /**
   * Sets the connection state.
   *
   * @param state - The connection state
   */
  private _setConnectionState(state: CONNECTION_STATE): void {
    this.connectionState = state;
    this.emit(LiveConnectionState[state], state);
  }

  /**
   * The current connection state.
   */
  protected connectionState: CONNECTION_STATE = CONNECTION_STATE.CLOSED;
}
