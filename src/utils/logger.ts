import fs from "node:fs/promises";
import path from "path";
import { createWriteStream, WriteStream } from "node:fs";

import { getWorkingDirectory } from "../utils";

export class Logger {
  private logStream?: WriteStream;
  private logPath: string;
  private originalConsoleLog: typeof console.log;
  private originalConsoleError: typeof console.error;
  private originalConsoleWarn: typeof console.warn;

  constructor(logFileName?: string) {
    this.originalConsoleLog = console.log.bind(console);
    this.originalConsoleError = console.error.bind(console);
    this.originalConsoleWarn = console.warn.bind(console);
    this.logPath = logFileName || "";
  }

  async initialize(): Promise<void> {
    const workingDir = await getWorkingDirectory();
    const logsDir = path.join(workingDir, "logs");

    // Create logs directory if it doesn't exist
    try {
      await fs.access(logsDir);
    } catch {
      await fs.mkdir(logsDir, { recursive: true });
    }

    // Generate log filename if not provided
    if (!this.logPath) {
      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, -5);
      this.logPath = path.join(logsDir, `liquidity-manager-${timestamp}.log`);
    } else if (!path.isAbsolute(this.logPath)) {
      this.logPath = path.join(logsDir, this.logPath);
    }

    // Create write stream
    this.logStream = createWriteStream(this.logPath, { flags: "a" });

    // Write header
    this.writeToLog(`\n${"=".repeat(80)}`);
    this.writeToLog(
      `Liquidity Manager Log - Started at ${new Date().toISOString()}`
    );
    this.writeToLog(`${"=".repeat(80)}\n`);

    // Override console methods
    this.overrideConsole();
  }

  private writeToLog(message: string): void {
    if (this.logStream && !this.logStream.destroyed) {
      this.logStream.write(message + "\n");
    }
  }

  private formatMessage(args: any[]): string {
    return args
      .map((arg) => {
        if (typeof arg === "object") {
          try {
            return JSON.stringify(arg, null, 2);
          } catch {
            return String(arg);
          }
        }
        return String(arg);
      })
      .join(" ");
  }

  private overrideConsole(): void {
    console.log = (...args: any[]) => {
      const timestamp = new Date().toISOString();
      const message = this.formatMessage(args);

      // Write to original console
      this.originalConsoleLog(...args);

      // Write to log file
      this.writeToLog(`[${timestamp}] [INFO] ${message}`);
    };

    console.error = (...args: any[]) => {
      const timestamp = new Date().toISOString();
      const message = this.formatMessage(args);

      // Write to original console
      this.originalConsoleError(...args);

      // Write to log file
      this.writeToLog(`[${timestamp}] [ERROR] ${message}`);
    };

    console.warn = (...args: any[]) => {
      const timestamp = new Date().toISOString();
      const message = this.formatMessage(args);

      // Write to original console
      this.originalConsoleWarn(...args);

      // Write to log file
      this.writeToLog(`[${timestamp}] [WARN] ${message}`);
    };
  }

  restoreConsole(): void {
    console.log = this.originalConsoleLog;
    console.error = this.originalConsoleError;
    console.warn = this.originalConsoleWarn;
  }

  close(): void {
    this.restoreConsole();

    if (this.logStream && !this.logStream.destroyed) {
      this.writeToLog(`\nLog closed at ${new Date().toISOString()}`);
      this.logStream.end();
    }
  }

  getLogPath(): string {
    return this.logPath;
  }
}
