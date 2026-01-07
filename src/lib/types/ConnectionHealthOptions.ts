/**
 * Configuration options for automatic KeepAlive message sending.
 * KeepAlive messages are sent periodically to maintain the WebSocket connection.
 */
export interface KeepAliveOptions {
  /**
   * Whether to automatically send KeepAlive messages.
   * @default false
   */
  enabled: boolean;

  /**
   * Interval in milliseconds between KeepAlive messages.
   * - Agent: defaults to 8000ms (8 seconds)
   * - Listen/Speak: defaults to 10000ms (10 seconds)
   */
  interval: number;
}

/**
 * Configuration options for connection health monitoring.
 * Health monitoring uses a heartbeat mechanism to detect silent disconnects
 * (connections that appear open but are actually dead).
 */
export interface HealthMonitorOptions {
  /**
   * Whether to enable connection health monitoring.
   * @default false
   */
  enabled: boolean;

  /**
   * Interval in milliseconds between heartbeat checks.
   * @default 5000
   */
  heartbeatInterval: number;

  /**
   * Timeout in milliseconds to wait for a response before considering
   * the connection dead. Should be greater than heartbeatInterval.
   * @default 10000
   */
  heartbeatTimeout: number;
}

/**
 * Backoff strategy for reconnection attempts.
 */
export enum BackoffStrategy {
  /**
   * Exponential backoff: delay = initialDelay * (2 ^ attemptCount)
   */
  Exponential = "exponential",

  /**
   * Linear backoff: delay = initialDelay + (attemptCount * stepDelay)
   */
  Linear = "linear",

  /**
   * Fixed delay: always use initialDelay
   */
  Fixed = "fixed",
}

/**
 * Configuration options for automatic reconnection.
 */
export interface ReconnectOptions {
  /**
   * Whether to automatically attempt reconnection on connection loss.
   * @default false
   */
  enabled: boolean;

  /**
   * Maximum number of reconnection attempts before giving up.
   * @default 5
   */
  maxAttempts: number;

  /**
   * Strategy to use for calculating delay between reconnection attempts.
   * @default BackoffStrategy.Exponential
   */
  backoffStrategy: BackoffStrategy;

  /**
   * Initial delay in milliseconds before first reconnection attempt.
   * @default 1000
   */
  initialDelay: number;

  /**
   * Maximum delay in milliseconds between reconnection attempts.
   * Used to prevent excessively long delays with exponential backoff.
   * @default 30000
   */
  maxDelay: number;

  /**
   * Step delay in milliseconds for linear backoff.
   * Only used when backoffStrategy is Linear.
   * @default 1000
   */
  stepDelay?: number;
}

/**
 * Configuration options for connection health management.
 * Includes KeepAlive, health monitoring, and reconnection options.
 */
export interface ConnectionHealthOptions {
  /**
   * Automatic KeepAlive configuration.
   */
  keepAlive?: Partial<KeepAliveOptions>;

  /**
   * Health monitoring configuration.
   */
  healthMonitor?: Partial<HealthMonitorOptions>;

  /**
   * Automatic reconnection configuration.
   */
  reconnect?: Partial<ReconnectOptions>;
}
