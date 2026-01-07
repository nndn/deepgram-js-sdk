/**
 * Enumeration of events related to connection health monitoring.
 * These events are emitted by live clients when connection health features are enabled.
 *
 * Events are organized by category:
 * - KeepAlive events: Automatic KeepAlive message lifecycle
 * - Health monitor events: Connection health checking and silent disconnect detection
 * - Reconnect events: Automatic reconnection attempts
 */
export enum LiveConnectionHealthEvents {
  /**
   * Emitted when a KeepAlive message is automatically sent.
   * Event data includes timestamp of the KeepAlive.
   */
  KeepAliveSent = "KeepAliveSent",

  /**
   * Emitted when a health check heartbeat is sent.
   * Event data includes timestamp and sequence number.
   */
  HeartbeatSent = "HeartbeatSent",

  /**
   * Emitted when a health check passes (response received within timeout).
   * Event data includes response time in milliseconds.
   */
  HealthCheckPassed = "HealthCheckPassed",

  /**
   * Emitted when a health check fails (no response within timeout).
   * This typically indicates a silent disconnect where the connection
   * appears open but is actually dead.
   *
   * Event data includes:
   * - timestamp: When the health check was initiated
   * - timeout: The timeout threshold that was exceeded
   * - lastActivity: Timestamp of last known activity
   */
  HealthCheckFailed = "HealthCheckFailed",

  /**
   * Emitted when an automatic reconnection attempt is initiated.
   * Event data includes:
   * - attempt: Current attempt number (1-indexed)
   * - maxAttempts: Maximum number of attempts configured
   * - delay: Delay before this attempt in milliseconds
   */
  Reconnecting = "Reconnecting",

  /**
   * Emitted when reconnection is successful.
   * Event data includes:
   * - attempt: The attempt number that succeeded
   * - totalTime: Total time to reconnect in milliseconds
   */
  Reconnected = "Reconnected",

  /**
   * Emitted when maximum reconnection attempts are reached without success.
   * Event data includes:
   * - attempts: Total number of attempts made
   * - totalTime: Total time spent attempting to reconnect
   */
  MaxReconnectAttemptsReached = "MaxReconnectAttemptsReached",
}
