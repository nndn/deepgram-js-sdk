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
  private activityTimestamp: number;
  private consecutiveHealthChecksFailed = 0;
  private reconnectAttempts = 0;
  private socket: WebSocket | null = null;
  private isPaused = false;
  private options: ConnectionHealthOptions;

  /**
   * Health state enum
   */
  public readonly HealthState = {
    HEALTHY: "healthy" as const,
    DEGRADED: "degraded" as const,
    UNHEALTHY: "unhealthy" as const,
  };

  constructor(options: ConnectionHealthOptions) {
    super();
    this.options = options;
    this.activityTimestamp = Date.now();
  }

  /**
   * Attach a WebSocket socket to this health manager
   */
  public attach(socket: WebSocket): void {
    this.socket = socket;
    this.setupSocketListeners();
  }

  /**
   * Record socket activity (called when data is sent/received)
   */
  public recordActivity(): void {
    this.activityTimestamp = Date.now();
    this.consecutiveHealthChecksFailed = 0;
    this.reconnectAttempts = 0;
  }

  /**
   * Start health monitoring and KeepAlive
   */
  public start(): void {
    if (this.isPaused) return;

    this.startKeepAlive();
    this.startHealthChecks();
  }

  /**
   * Pause health monitoring (e.g., during manual reconnection)
   */
  public pause(): void {
    this.isPaused = true;
    this.stopKeepAlive();
    this.stopHealthChecks();
    this.stopReconnectAttempts();
  }

  /**
   * Resume health monitoring
   */
  public resume(): void {
    this.isPaused = false;
    this.start();
  }

  /**
   * Stop health monitoring and clean up timers
   */
  public stop(): void {
    this.isPaused = true;
    this.stopKeepAlive();
    this.stopHealthChecks();
    this.stopReconnectAttempts();
  }

  /**
   * Get current health status
   */
  public getHealthStatus(): { state: string; lastActivity: number } {
    const timeSinceActivity = Date.now() - this.activityTimestamp;
    const { healthCheck, keepAlive } = this.options;

    let state = this.HealthState.HEALTHY;
    
    if (timeSinceActivity > healthCheck.unhealthyThreshold) {
      state = this.HealthState.UNHEALTHY;
    } else if (timeSinceActivity > healthCheck.degradedThreshold) {
      state = this.HealthState.DEGRADED;
    }

    return {
      state,
      lastActivity: timeSinceActivity,
    };
  }

  /**
   * Update configuration options
   */
  public updateOptions(options: Partial<ConnectionHealthOptions>): void {
    this.options = { ...this.options, ...options };
    
    // Restart with new options if not paused
    if (!this.isPaused) {
      this.stop();
      this.start();
    }
  }

  /**
   * Get the configured KeepAlive interval (override in subclasses)
   */
  protected getKeepAliveInterval(): number {
    return this.options.keepAlive.interval;
  }

  /**
   * Get the message to send for KeepAlive (override in subclasses)
   */
  protected getKeepAliveMessage(): any {
    return this.options.keepAlive.message;
  }

  /**
   * Setup socket event listeners
   */
  private setupSocketListeners(): void {
    if (!this.socket) return;

    this.socket.addEventListener("open", () => {
      this.emit("connection:opened");
      this.recordActivity();
      this.startKeepAlive();
      this.startHealthChecks();
      this.reconnectAttempts = 0;
    });

    this.socket.addEventListener("message", () => {
      this.recordActivity();
    });

    this.socket.addEventListener("error", (error) => {
      this.emit("connection:error", error);
      this.pause();
      
      if (this.options.reconnect.enabled) {
        this.scheduleReconnect();
      }
    });

    this.socket.addEventListener("close", (event) => {
      this.emit("connection:closed", event);
      this.pause();
      
      if (!event.wasClean && this.options.reconnect.enabled) {
        this.scheduleReconnect();
      }
    });
  }

  /**
   * Start KeepAlive mechanism
   */
  private startKeepAlive(): void {
    if (!this.options.keepAlive.enabled || this.isPaused) return;

    this.stopKeepAlive();

    const interval = this.getKeepAliveInterval();
    
    this.keepAliveTimer = setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        try {
          const message = this.getKeepAliveMessage();
          this.socket.send(typeof message === "string" ? message : JSON.stringify(message));
          this.emit("keepalive:sent");
        } catch (error) {
          this.emit("keepalive:error", error);
        }
      }
    }, interval);
  }

  /**
   * Stop KeepAlive mechanism
   */
  private stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = undefined;
    }
  }

  /**
   * Start health checks
   */
  private startHealthChecks(): void {
    if (!this.options.healthCheck.enabled || this.isPaused) return;

    this.stopHealthChecks();

    const { interval, degradedThreshold, unhealthyThreshold } = this.options.healthCheck;

    this.healthCheckTimer = setInterval(() => {
      const timeSinceActivity = Date.now() - this.activityTimestamp;
      const status = this.getHealthStatus();

      if (status.state === this.HealthState.UNHEALTHY) {
        this.consecutiveHealthChecksFailed++;
        this.emit("connection:unhealthy", {
          timeSinceActivity,
          consecutiveFailures: this.consecutiveHealthChecksFailed,
        });

        // Close socket if unhealthy threshold exceeded
        if (this.consecutiveHealthChecksFailed >= this.options.healthCheck.maxUnhealthyChecks) {
          this.emit("connection:timeout", {
            timeSinceActivity,
            threshold: unhealthyThreshold,
          });
          
          if (this.socket) {
            this.socket.close(1000, "Connection unhealthy - timed out");
          }
        }
      } else if (status.state === this.HealthState.DEGRADED) {
        this.emit("connection:degraded", {
          timeSinceActivity,
          threshold: degradedThreshold,
        });
      }
    }, interval);
  }

  /**
   * Stop health checks
   */
  private stopHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    const { reconnect } = this.options;

    if (!reconnect.enabled) return;

    const delay = this.calculateReconnectDelay(this.reconnectAttempts);

    this.emit("reconnect:scheduled", {
      attempt: this.reconnectAttempts + 1,
      delay,
    });

    this.reconnectTimer = setTimeout(() => {
      this.attemptReconnect();
    }, delay);
  }

  /**
   * Stop reconnection attempts
   */
  private stopReconnectAttempts(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  /**
   * Attempt to reconnect
   */
  private attemptReconnect(): void {
    this.reconnectAttempts++;

    this.emit("reconnect:attempting", {
      attempt: this.reconnectAttempts,
    });

    if (this.reconnectAttempts > this.options.reconnect.maxAttempts) {
      this.emit("reconnect:failed", {
        attempts: this.reconnectAttempts,
      });
      return;
    }

    // Emit event for the parent to handle actual reconnection
    this.emit("reconnect", {
      attempt: this.reconnectAttempts,
    });
  }

  /**
   * Calculate delay before next reconnection attempt using backoff strategy
   */
  private calculateReconnectDelay(attempt: number): number {
    const { reconnect } = this.options;
    const { initialDelay, maxDelay, backoffStrategy } = reconnect;

    switch (backoffStrategy) {
      case BackoffStrategy.EXPONENTIAL:
        return Math.min(initialDelay * Math.pow(2, attempt), maxDelay);
      
      case BackoffStrategy.LINEAR:
        return Math.min(initialDelay * (attempt + 1), maxDelay);
      
      case BackoffStrategy.CONSTANT:
      default:
        return initialDelay;
    }
  }

  /**
   * Clean up resources
   */
  public destroy(): void {
    this.stop();
    this.socket = null;
    this.removeAllListeners();
  }
}
