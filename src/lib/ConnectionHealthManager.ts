import { EventEmitter } from "events";
import { BackoffStrategy } from "../types/ConnectionHealthOptions";
import type {
  ConnectionHealthOptions,
  KeepAliveOptions,
  HealthMonitorOptions,
  ReconnectOptions,
} from "../types/ConnectionHealthOptions";
import { LiveConnectionHealthEvents } from "../enums/LiveConnectionHealthEvents";

/**
 * Manages connection health for WebSocket connections.
 * Handles automatic KeepAlive, health monitoring, and reconnection.
 *
 * This class is responsible for:
 * - Sending KeepAlive messages to maintain connection
 * - Monitoring connection health with heartbeat checks
 * - Detecting silent disconnects
 * - Automatically reconnecting with configurable backoff strategies
 *
 * @example
 * ```typescript
 * const healthManager = new ConnectionHealthManager({
 *   keepAlive: { enabled: true, interval: 10000 },
 *   healthMonitor: { enabled: true, heartbeatInterval: 5000, heartbeatTimeout: 10000 },
 *   reconnect: { enabled: true, maxAttempts: 5, backoffStrategy: BackoffStrategy.Exponential }
 * }, 10000);
 *
 * healthManager.setKeepAliveFunction(() => connection.send('ping'));
 * healthManager.setReconnectFunction(() => connection.reconnect());
 * healthManager.setDisconnectFunction((code, reason) => connection.close(code, reason));
 *
 * healthManager.start();
 * ```
 */
export class ConnectionHealthManager extends EventEmitter {
  private keepAliveTimer?: NodeJS.Timeout;
  private healthCheckTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private heartbeatTimeoutTimer?: NodeJS.Timeout;

  private keepAliveOptions: KeepAliveOptions;
  private healthMonitorOptions: HealthMonitorOptions;
  private reconnectOptions: ReconnectOptions;

  private reconnectAttemptCount: number = 0;
  private lastActivityTime: number = Date.now();
  private heartbeatSequence: number = 0;
  private reconnectStartTime?: number;

  private isRunning: boolean = false;
  private isReconnecting: boolean = false;
  private keepAliveFunction?: () => void;
  private reconnectFunction?: () => void;
  private disconnectFunction?: (code?: number, reason?: string) => void;

  /**
   * Creates a new ConnectionHealthManager instance.
   *
   * @param options - Connection health configuration options
   * @param defaultKeepAliveInterval - Default KeepAlive interval in milliseconds (depends on client type)
   */
  constructor(
    options: ConnectionHealthOptions = {},
    defaultKeepAliveInterval: number = 10000
  ) {
    super();

    // Initialize KeepAlive options with defaults
    this.keepAliveOptions = {
      enabled: options.keepAlive?.enabled ?? false,
      interval: options.keepAlive?.interval ?? defaultKeepAliveInterval,
    };

    // Initialize health monitor options with defaults
    this.healthMonitorOptions = {
      enabled: options.healthMonitor?.enabled ?? false,
      heartbeatInterval: options.healthMonitor?.heartbeatInterval ?? 5000,
      heartbeatTimeout: options.healthMonitor?.heartbeatTimeout ?? 10000,
    };

    // Initialize reconnect options with defaults
    this.reconnectOptions = {
      enabled: options.reconnect?.enabled ?? false,
      maxAttempts: options.reconnect?.maxAttempts ?? 5,
      backoffStrategy: options.reconnect?.backoffStrategy ?? BackoffStrategy.Exponential,
      initialDelay: options.reconnect?.initialDelay ?? 1000,
      maxDelay: options.reconnect?.maxDelay ?? 30000,
      stepDelay: options.reconnect?.stepDelay ?? 1000,
    };
  }

  /**
   * Sets the function to call for sending KeepAlive messages.
   *
   * @param fn - Function that sends a KeepAlive message
   */
  setKeepAliveFunction(fn: () => void): void {
    this.keepAliveFunction = fn;
  }

  /**
   * Sets the function to call for reconnecting.
   *
   * @param fn - Function that initiates reconnection
   */
  setReconnectFunction(fn: () => void): void {
    this.reconnectFunction = fn;
  }

  /**
   * Sets the function to call for disconnecting.
   *
   * @param fn - Function that closes the connection
   */
  setDisconnectFunction(fn: (code?: number, reason?: string) => void): void {
    this.disconnectFunction = fn;
  }

  /**
   * Starts the connection health monitoring.
   * Initializes KeepAlive, health monitoring, and sets up event handlers.
   */
  start(): void {
    if (this.isRunning) {
      this.log("warning", "Health manager already running");
      return;
    }

    this.isRunning = true;
    this.log("info", "Starting connection health manager");

    // Start KeepAlive if enabled
    if (this.keepAliveOptions.enabled) {
      this.startKeepAlive();
    }

    // Start health monitoring if enabled
    if (this.healthMonitorOptions.enabled) {
      this.startHealthMonitor();
    }
  }

  /**
   * Stops the connection health monitoring.
   * Stops all timers and clears event handlers.
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    this.isReconnecting = false;

    this.stopKeepAlive();
    this.stopHealthMonitor();
    this.stopReconnection();

    this.log("info", "Stopped connection health manager");
  }

  /**
   * Starts the KeepAlive mechanism.
   * Sends periodic KeepAlive messages to maintain the connection.
   */
  private startKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
    }

    this.keepAliveTimer = setInterval(() => {
      if (this.isReconnecting) {
        return;
      }

      this.sendKeepAlive();
    }, this.keepAliveOptions.interval);

    this.log(
      "info",
      `KeepAlive started with interval: ${this.keepAliveOptions.interval}ms`
    );
  }

  /**
   * Sends a KeepAlive message.
   */
  private sendKeepAlive(): void {
    if (!this.keepAliveFunction) {
      this.log("warning", "KeepAlive function not set, cannot send KeepAlive");
      return;
    }

    try {
      this.keepAliveFunction();
      this.emit(LiveConnectionHealthEvents.KeepAliveSent, {
        timestamp: Date.now(),
      });
      this.log("debug", "KeepAlive message sent");
    } catch (error) {
      this.emit(LiveConnectionHealthEvents.Error, {
        type: "KeepAliveSendError",
        error,
      });
      console.error("Error sending KeepAlive:", error);
    }
  }

  /**
   * Stops the KeepAlive mechanism.
   */
  private stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = undefined;
    }
  }

  /**
   * Starts the health monitor.
   * Periodically checks connection health and detects silent disconnects.
   */
  private startHealthMonitor(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    this.healthCheckTimer = setInterval(() => {
      if (this.isReconnecting) {
        return;
      }

      this.performHealthCheck();
    }, this.healthMonitorOptions.heartbeatInterval);

    this.log(
      "info",
      `Health monitor started with heartbeat interval: ${this.healthMonitorOptions.heartbeatInterval}ms, timeout: ${this.healthMonitorOptions.heartbeatTimeout}ms`
    );
  }

  /**
   * Performs a health check by sending a heartbeat.
   * Monitors for a response within the timeout period.
   */
  private performHealthCheck(): void {
    this.heartbeatSequence++;

    const checkData = {
      sequence: this.heartbeatSequence,
      timestamp: Date.now(),
    };

    this.emit(LiveConnectionHealthEvents.HeartbeatSent, checkData);
    this.log("debug", `Health check #${checkData.sequence} sent`);

    // Set a timeout for the heartbeat response
    this.heartbeatTimeoutTimer = setTimeout(
      () => this.handleHealthCheckTimeout(checkData),
      this.healthMonitorOptions.heartbeatTimeout
    );
  }

  /**
   * Handles a health check timeout.
   * Called when no response is received within the timeout period.
   *
   * @param checkData - The health check data
   */
  private handleHealthCheckTimeout(checkData: {
    sequence: number;
    timestamp: number;
  }): void {
    const timeSinceCheck = Date.now() - checkData.timestamp;
    const timeSinceActivity = Date.now() - this.lastActivityTime;

    this.log(
      "warning",
      `Health check #${checkData.sequence} timed out after ${timeSinceCheck}ms (last activity: ${timeSinceActivity}ms ago)`
    );

    this.emit(LiveConnectionHealthEvents.HealthCheckFailed, {
      sequence: checkData.sequence,
      timestamp: checkData.timestamp,
      timeout: this.healthMonitorOptions.heartbeatTimeout,
      lastActivity: this.lastActivityTime,
    });

    // If no recent activity and we haven't seen any KeepAlive acks, treat as silent disconnect
    if (timeSinceActivity > this.healthMonitorOptions.heartbeatTimeout * 2) {
      this.handleSilentDisconnect();
    }
  }

  /**
   * Handles a silent disconnect detection.
   * Initiates reconnection if enabled.
   */
  private handleSilentDisconnect(): void {
    this.log("warning", "Silent disconnect detected, closing connection");

    // Close the connection if we can
    if (this.disconnectFunction) {
      try {
        this.disconnectFunction(1000, "Silent disconnect detected");
      } catch (error) {
        console.error("Error disconnecting:", error);
      }
    }

    // Start reconnection if enabled
    if (this.reconnectOptions.enabled) {
      this.startReconnection();
    }
  }

  /**
   * Records activity on the connection.
   * Should be called when any message is received.
   */
  recordActivity(): void {
    this.lastActivityTime = Date.now();

    // If we receive activity while waiting for a heartbeat, clear the timeout
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = undefined;

      this.emit(LiveConnectionHealthEvents.HealthCheckPassed, {
        timestamp: Date.now(),
        lastActivity: this.lastActivityTime,
      });

      this.log("debug", "Health check passed - activity received");
    }
  }

  /**
   * Stops the health monitor.
   */
  private stopHealthMonitor(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }

    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = undefined;
    }
  }

  /**
   * Starts the reconnection process.
   * Attempts to reconnect using the configured backoff strategy.
   */
  private startReconnection(): void {
    if (this.isReconnecting || !this.reconnectOptions.enabled) {
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttemptCount = 0;
    this.reconnectStartTime = Date.now();

    this.log("info", "Starting reconnection process");
    this.scheduleReconnectAttempt();
  }

  /**
   * Schedules the next reconnection attempt.
   */
  private scheduleReconnectAttempt(): void {
    const delay = this.calculateBackoffDelay(this.reconnectAttemptCount);

    this.emit(LiveConnectionHealthEvents.Reconnecting, {
      attempt: this.reconnectAttemptCount + 1,
      maxAttempts: this.reconnectOptions.maxAttempts,
      delay,
    });

    this.log(
      "info",
      `Scheduling reconnection attempt ${this.reconnectAttemptCount + 1}/${this.reconnectOptions.maxAttempts} in ${delay}ms`
    );

    this.reconnectTimer = setTimeout(
      () => this.performReconnectAttempt(),
      delay
    );
  }

  /**
   * Performs a reconnection attempt.
   */
  private performReconnectAttempt(): void {
    if (!this.isReconnecting) {
      return;
    }

    this.reconnectAttemptCount++;

    if (this.reconnectAttemptCount > this.reconnectOptions.maxAttempts) {
      this.handleReconnectFailed();
      return;
    }

    this.log(
      "info",
      `Reconnection attempt ${this.reconnectAttemptCount}/${this.reconnectOptions.maxAttempts}`
    );

    if (this.reconnectFunction) {
      try {
        this.reconnectFunction();
      } catch (error) {
        this.log("error", "Error during reconnection attempt:", error);
        console.error("Error during reconnection attempt:", error);
        // Schedule next attempt
        this.scheduleReconnectAttempt();
      }
    }
  }

  /**
   * Handles a successful reconnection.
   * Resets reconnection state and restarts health monitoring.
   */
  handleReconnectSuccess(): void {
    if (!this.isReconnecting) {
      return;
    }

    const totalTime = this.reconnectStartTime
      ? Date.now() - this.reconnectStartTime
      : 0;

    this.isReconnecting = false;
    this.reconnectAttemptCount = 0;
    this.reconnectStartTime = undefined;

    this.emit(LiveConnectionHealthEvents.Reconnected, {
      attempt: this.reconnectAttemptCount,
      totalTime,
    });

    this.log(
      "info",
      `Reconnection successful after ${this.reconnectAttemptCount} attempts (${totalTime}ms)`
    );

    // Restart health monitoring
    if (this.isRunning) {
      if (this.keepAliveOptions.enabled) {
        this.startKeepAlive();
      }
      if (this.healthMonitorOptions.enabled) {
        this.startHealthMonitor();
      }
    }
  }

  /**
   * Handles reconnection failure (max attempts reached).
   */
  private handleReconnectFailed(): void {
    if (!this.isReconnecting) {
      return;
    }

    const totalTime = this.reconnectStartTime
      ? Date.now() - this.reconnectStartTime
      : 0;

    this.isReconnecting = false;
    const attempts = this.reconnectAttemptCount;
    this.reconnectAttemptCount = 0;
    this.reconnectStartTime = undefined;

    this.emit(LiveConnectionHealthEvents.MaxReconnectAttemptsReached, {
      attempts,
      totalTime,
    });

    this.log(
      "error",
      `Reconnection failed after ${attempts} attempts (${totalTime}ms)`
    );
  }

  /**
   * Stops the reconnection process.
   */
  private stopReconnection(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  /**
   * Calculates the delay for the next reconnection attempt.
   * Uses the configured backoff strategy.
   *
   * @param attemptCount - The current attempt count (0-indexed)
   * @returns The delay in milliseconds
   */
  private calculateBackoffDelay(attemptCount: number): number {
    const { backoffStrategy, initialDelay, maxDelay, stepDelay = 1000 } =
      this.reconnectOptions;
    let delay: number;

    switch (backoffStrategy) {
      case BackoffStrategy.Exponential:
        delay = initialDelay * Math.pow(2, attemptCount);
        break;

      case BackoffStrategy.Linear:
        delay = initialDelay + attemptCount * stepDelay;
        break;

      case BackoffStrategy.Fixed:
      default:
        delay = initialDelay;
        break;
    }

    // Cap at max delay
    return Math.min(delay, maxDelay);
  }

  /**
   * Logs a message if health monitoring is enabled.
   *
   * @param kind - The log level
   * @param msg - The message to log
   * @param data - Optional data to log
   */
  private log(kind: string, msg: string, data?: any): void {
    if (this.keepAliveOptions.enabled || this.healthMonitorOptions.enabled) {
      console.log(`[ConnectionHealthManager] ${kind}: ${msg}`, data || "");
    }
  }

  /**
   * Destroys the health manager.
   * Stops all timers and removes all event listeners.
   */
  destroy(): void {
    this.stop();
    this.removeAllListeners();
  }
}
