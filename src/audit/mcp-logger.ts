/**
 * MCP Logger for sending log notifications to MCP clients
 * Implements the MCP logging specification: https://modelcontextprotocol.io/specification/2025-06-18/server/utilities/logging
 */

import { LogLevel, LOG_LEVELS, MCPLogMessage } from '../types/index';

export interface MCPLoggerConfig {
  enabled: boolean;
  minLevel: LogLevel;
  rateLimitPerMinute: number;
  maxQueueSize: number;
  includeContext: boolean;
}

export interface LogNotificationCallback {
  (message: MCPLogMessage): void;
}

export class MCPLogger {
  private config: MCPLoggerConfig;
  private notificationCallback?: LogNotificationCallback;
  private messageQueue: MCPLogMessage[] = [];
  private rateLimitCounter: number = 0;
  private rateLimitResetTime: number = 0;

  constructor(config: MCPLoggerConfig) {
    this.config = config;
    this.resetRateLimit();
  }

  /**
   * Set the callback function for sending notifications to MCP clients
   */
  setNotificationCallback(callback: LogNotificationCallback): void {
    this.notificationCallback = callback;
  }

  /**
   * Set the minimum log level for filtering messages
   */
  setMinLevel(level: LogLevel): void {
    this.config.minLevel = level;
  }

  /**
   * Get the current minimum log level
   */
  getMinLevel(): LogLevel {
    return this.config.minLevel;
  }

  /**
   * Log a message at the specified level
   */
  log(level: LogLevel, message: string, logger?: string, context?: any): void {
    if (!this.config.enabled) {
      return;
    }

    // Check if message should be logged based on level
    if (!this.shouldLog(level)) {
      return;
    }

    // Check rate limiting
    if (!this.checkRateLimit()) {
      return;
    }

    // Create log message
    const logMessage: MCPLogMessage = {
      level,
      logger,
      data: {
        message,
        timestamp: new Date().toISOString(),
        pid: process.pid,
        ...(this.config.includeContext && context ? { context } : {})
      }
    };

    // Send notification if callback is set
    if (this.notificationCallback) {
      try {
        this.notificationCallback(logMessage);
      } catch (error) {
        // Avoid infinite loops by not logging MCP notification errors
        console.error('Failed to send MCP log notification:', error);
      }
    } else {
      // Queue message if no callback is set yet
      this.queueMessage(logMessage);
    }
  }

  /**
   * Convenience methods for each log level
   */
  emergency(message: string, logger?: string, context?: any): void {
    this.log('emergency', message, logger, context);
  }

  alert(message: string, logger?: string, context?: any): void {
    this.log('alert', message, logger, context);
  }

  critical(message: string, logger?: string, context?: any): void {
    this.log('critical', message, logger, context);
  }

  error(message: string, logger?: string, context?: any): void {
    this.log('error', message, logger, context);
  }

  warning(message: string, logger?: string, context?: any): void {
    this.log('warning', message, logger, context);
  }

  notice(message: string, logger?: string, context?: any): void {
    this.log('notice', message, logger, context);
  }

  info(message: string, logger?: string, context?: any): void {
    this.log('info', message, logger, context);
  }

  debug(message: string, logger?: string, context?: any): void {
    this.log('debug', message, logger, context);
  }

  /**
   * Process any queued messages when callback becomes available
   */
  processQueuedMessages(): void {
    if (!this.notificationCallback || this.messageQueue.length === 0) {
      return;
    }

    const messages = [...this.messageQueue];
    this.messageQueue = [];

    for (const message of messages) {
      try {
        this.notificationCallback(message);
      } catch (error) {
        console.error('Failed to send queued MCP log notification:', error);
      }
    }
  }

  /**
   * Get logging statistics
   */
  getStats(): {
    enabled: boolean;
    minLevel: LogLevel;
    queuedMessages: number;
    rateLimitCounter: number;
    rateLimitResetTime: number;
  } {
    return {
      enabled: this.config.enabled,
      minLevel: this.config.minLevel,
      queuedMessages: this.messageQueue.length,
      rateLimitCounter: this.rateLimitCounter,
      rateLimitResetTime: this.rateLimitResetTime
    };
  }

  /**
   * Check if a message at the given level should be logged
   */
  private shouldLog(level: LogLevel): boolean {
    const messageLevel = LOG_LEVELS[level];
    const minLevel = LOG_LEVELS[this.config.minLevel];
    return messageLevel <= minLevel; // Lower numbers = higher priority
  }

  /**
   * Check rate limiting
   */
  private checkRateLimit(): boolean {
    const now = Date.now();
    
    // Reset counter if minute has passed
    if (now >= this.rateLimitResetTime) {
      this.resetRateLimit();
    }

    // Check if under rate limit
    if (this.rateLimitCounter >= this.config.rateLimitPerMinute) {
      return false;
    }

    this.rateLimitCounter++;
    return true;
  }

  /**
   * Reset rate limiting counter
   */
  private resetRateLimit(): void {
    this.rateLimitCounter = 0;
    this.rateLimitResetTime = Date.now() + 60000; // 1 minute from now
  }

  /**
   * Queue a message when no callback is available
   */
  private queueMessage(message: MCPLogMessage): void {
    if (this.messageQueue.length >= this.config.maxQueueSize) {
      // Remove oldest message to make room
      this.messageQueue.shift();
    }
    this.messageQueue.push(message);
  }
}

/**
 * Utility function to convert legacy log levels to RFC 5424 levels
 */
export function convertLegacyLogLevel(legacyLevel: string): LogLevel {
  switch (legacyLevel.toLowerCase()) {
    case 'debug': return 'debug';
    case 'info': return 'info';
    case 'warn': 
    case 'warning': return 'warning';
    case 'error': return 'error';
    default: return 'info';
  }
}

/**
 * Utility function to validate log level strings
 */
export function isValidLogLevel(level: string): level is LogLevel {
  return level in LOG_LEVELS;
}
