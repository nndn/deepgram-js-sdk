import { EventEmitter } from "events";
import { BackoffStrategy } from "./types/ConnectionHealthOptions";
import type {
  ConnectionHealthOptions,
  KeepAliveOptions,
  HealthMonitorOptions,
  ReconnectOptions,
} from "./types/ConnectionHealthOptions";

/**
 * Manages connection health for WebSocket connections.
 * Handles automatic KeepAlive, health monitoring, and reconnection.
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
  constructor(options: ConnectionHealthOptions = {}, defaultKeepAliveInterval: number = 10000) {
    super();

    // Merge with defaults
    this.keepAliveOptions = {
      enabled: false,
      interval: defaultKeepAliveInterval,
      ...options.keepAlive,
    };

    this.healthMonitorOptions = {
      enabled: false,
      heartbeatInterval: 5000,
      heartbeatTimeout: 10000,
      ...options.healthMonitor,
    };

    this.reconnectOptions = {
      enabled: false,
      maxAttempts: 5,
      backoffStrategy: BackoffStrategy.Exponential,
      initialDelay: 1000,
      maxDelay: 30000,
      stepDelay: 1000,
      ...options.reconnect,
    };

    // Validate health monitor timeout
    if (this.healthMonitorOptions.heartbeatTimeout <= this.healthMonitorOptions.heartbeatInterval) {
      console.warn(
        `Health monitor timeout (${this.healthMonitorOptions.heartbeatTimeout}ms) should be greater than interval (${this.healthMonitorOptions.heartbeatInterval}ms)`
      );
    }
  }

  /**
   * Sets the function to call for sending KeepAlive messages.
   */
  public setKeepAliveFunction(fn: () => void): void {
    this.keepAliveFunction = fn;
  }

  /**
   * Sets the function to call for reconnection attempts.
   */
  public setReconnectFunction(fn: () => void): void {
    this.reconnectFunction = fn;
  }

  /**
   * Sets the function to call for disconnection.
   */
  public setDisconnectFunction(fn: (code?: number, reason?: string) => void): void {
    this.disconnectFunction = fn;
  }

  /**
   * Starts all health management features.
   */
  public start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    if (this.keepAliveOptions.enabled && this.keepAliveFunction) {
      this.startKeepAlive();
    }

    if (this.healthMonitorOptions.enabled) {
      this.startHealthMonitor();
    }
  }

  /**
   * Stops all health management features.
   */
  public stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    this.stopKeepAlive();
    this.stopHealthMonitor();
    this.stopReconnection();
  }

  /**
   * Starts automatic KeepAlive messages.
   */
  private startKeepAlive(): void {
    this.stopKeepAlive();

    this.keepAliveTimer = setInterval(() => {
      if (this.keepAliveFunction) {
        try {
          this.keepAliveFunction();
          this.emit("KeepAliveSent", {
            timestamp: Date.now(),
          });
        } catch (error) {
          console.error("Error sending KeepAlive:", error);
        }
      }
    }, this.keepAliveOptions.interval);
  }

  /**
   * Stops automatic KeepAlive messages.
   */
  private stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = undefined;
    }
  }

  /**
   * Starts health monitoring with heartbeat checks.
   */
  private startHealthMonitor(): void {
    this.stopHealthMonitor();

    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.healthMonitorOptions.heartbeatInterval);
  }

  /**
   * Stops health monitoring.
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
   * Performs a health check by sending a heartbeat.
   */
  private performHealthCheck(): void {
    this.heartbeatSequence++;

    const checkData = {
      sequence: this.heartbeatSequence,
      timestamp: Date.now(),
    };

    this.emit("HeartbeatSent", checkData);

    // Set timeout to detect no response
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
    }

    this.heartbeatTimeoutTimer = setTimeout(() => {
      this.handleHealthCheckTimeout(checkData);
    }, this.healthMonitorOptions.heartbeatTimeout);
  }

  /**
   * Handles health check timeout (no response received).
   */
  private handleHealthCheckTimeout(checkData: { sequence: number; timestamp: number }): void {
    const timeSinceLastActivity = Date.now() - this.lastActivityTime;

    this.emit("HealthCheckFailed", {
      sequence: checkData.sequence,
      timestamp: checkData.timestamp,
      timeout: this.healthMonitorOptions.heartbeatTimeout,
      lastActivity: this.lastActivityTime,
      timeSinceLastActivity,
    });

    // Silent disconnect detected - trigger reconnection if enabled
    if (this.reconnectOptions.enabled && !this.isReconnecting) {
      this.handleSilentDisconnect();
    }
  }

  /**
   * Handles silent disconnect detection.
   */
  private handleSilentDisconnect(): void {
    this.log("warn", "Silent disconnect detected, closing connection");

    // Close the connection if we can
    if (this.disconnectFunction) {
      try {
        this.disconnectFunction(1000, "Silent disconnect detected");
      } catch (error) {
        console.error("Error disconnecting:", error);
      }
    }

    // Start reconnection
    this.startReconnection();
  }

  /**
   * Starts automatic reconnection attempts.
   */
  private startReconnection(): void {
    if (this.isReconnecting || !this.reconnectOptions.enabled) {
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttemptCount = 0;
    this.reconnectStartTime = Date.now();

    this.scheduleReconnectAttempt();
  }

  /**
   * Stops reconnection attempts.
   */
  private stopReconnection(): void {
    this.isReconnecting = false;
    this.reconnectAttemptCount = 0;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  /**
   * Schedules the next reconnection attempt.
   */
  private scheduleReconnectAttempt(): void {
    const delay = this.calculateBackoffDelay(this.reconnectAttemptCount);

    this.emit("Reconnecting", {
      attempt: this.reconnectAttemptCount + 1,
      maxAttempts: this.reconnectOptions.maxAttempts,
      delay,
    });

    this.reconnectTimer = setTimeout(() => {
      this.performReconnectAttempt();
    }, delay);
  }

  /**
   * Performs a reconnection attempt.
   */
  private performReconnectAttempt(): void {
    this.reconnectAttemptCount++;

    if (this.reconnectFunction) {
      try {
        this.reconnectFunction();
      } catch (error) {
        console.error("Error during reconnection attempt:", error);
        this.handleReconnectFailed();
        return;
      }
    }
  }

  /**
   * Handles successful reconnection.
   */
  public handleReconnectSuccess(): void {
    if (!this.isReconnecting) {
      return;
    }

    const totalTime = this.reconnectStartTime ? Date.now() - this.reconnectStartTime : 0;

    this.emit("Reconnected", {
      attempt: this.reconnectAttemptCount,
      totalTime,
    });

    this.stopReconnection();

    // Reset health monitoring
    this.lastActivityTime = Date.now();
    this.heartbeatSequence = 0;

    // Restart health management if it was running
    if (this.isRunning) {
      this.start();
    }
  }

  /**
   * Handles failed reconnection attempt.
   */
  private handleReconnectFailed(): void {
    if (!this.isReconnecting) {
      return;
    }

    if (this.reconnectAttemptCount >= this.reconnectOptions.maxAttempts) {
      // Max attempts reached
      const totalTime = this.reconnectStartTime ? Date.now() - this.reconnectStartTime : 0;

      this.emit("MaxReconnectAttemptsReached", {
        attempts: this.reconnectAttemptCount,
        totalTime,
      });

      this.stopReconnection();
    } else {
      // Schedule next attempt
      this.scheduleReconnectAttempt();
    }
  }

  /**
   * Calculates the delay before the next reconnection attempt based on the configured strategy.
   */
  private calculateBackoffDelay(attemptCount: number): number {
    const { backoffStrategy, initialDelay, maxDelay, stepDelay = 1000 } = this.reconnectOptions;

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

    // Cap at maxDelay
    return Math.min(delay, maxDelay);
  }

  /**
   * Records activity on the connection (message received/sent).
   * This is used for health monitoring to determine if the connection is alive.
   */
  public recordActivity(): void {
    this.lastActivityTime = Date.now();

    // If we receive activity, clear any pending heartbeat timeout
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = undefined;

      this.emit("HealthCheckPassed", {
        timestamp: Date.now(),
        lastActivity: this.lastActivityTime,
      });
    }
  }

  /**
   * Logs a message using the configured logger.
   */
  private log(kind: string, msg: string, data?: any): void {
    if (this.keepAliveOptions.enabled || this.healthMonitorOptions.enabled) {
      console.log(`[ConnectionHealthManager] ${kind}: ${msg}`, data || "");
    }
  }

  /**
   * Cleans up resources.
   */
  public destroy(): void {
    this.stop();
    this.removeAllListeners();
  }
}
