/**
 * Logger Utility
 * Structured logging for the extension
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export class Logger {
  private static instance: Logger;
  private level: LogLevel = LogLevel.INFO;
  private prefix: string = '[TypeMap]';

  private constructor() {}

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.DEBUG) {
      console.log(`${this.prefix} [DEBUG] ${message}`, ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.INFO) {
      console.log(`${this.prefix} [INFO] ${message}`, ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.WARN) {
      console.warn(`${this.prefix} [WARN] ${message}`, ...args);
    }
  }

  error(message: string, error?: Error, ...args: unknown[]): void {
    if (this.level <= LogLevel.ERROR) {
      console.error(`${this.prefix} [ERROR] ${message}`, error, ...args);
    }
  }

  /**
   * Create a child logger with a sub-prefix
   */
  child(subPrefix: string): ChildLogger {
    return new ChildLogger(this, subPrefix);
  }
}

class ChildLogger {
  constructor(
    private parent: Logger,
    private subPrefix: string
  ) {}

  debug(message: string, ...args: unknown[]): void {
    this.parent.debug(`[${this.subPrefix}] ${message}`, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.parent.info(`[${this.subPrefix}] ${message}`, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.parent.warn(`[${this.subPrefix}] ${message}`, ...args);
  }

  error(message: string, error?: Error, ...args: unknown[]): void {
    this.parent.error(`[${this.subPrefix}] ${message}`, error, ...args);
  }
}

// Export singleton instance
export const logger = Logger.getInstance();
