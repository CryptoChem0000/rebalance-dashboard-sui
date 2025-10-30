export interface ShutdownHandler {
  cleanup: () => Promise<void>;
  waitForOperation: () => Promise<void>;
}

export class GracefulShutdown {
  private isShuttingDown = false;
  private currentOperation: Promise<any> | null = null;
  private handlers: ShutdownHandler[] = [];

  constructor() {
    // Register signal handlers once
    process.once("SIGTERM", () => this.shutdown("SIGTERM"));
    process.once("SIGINT", () => this.shutdown("SIGINT"));
  }

  registerHandler(handler: ShutdownHandler) {
    this.handlers.push(handler);
  }

  setCurrentOperation(operation: Promise<any> | null) {
    this.currentOperation = operation;
  }

  isShutdownRequested(): boolean {
    return this.isShuttingDown;
  }

  private async shutdown(signal: string) {
    if (this.isShuttingDown) return; // Prevent multiple shutdowns

    console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
    this.isShuttingDown = true;

    // Wait for current operation
    if (this.currentOperation) {
      console.log("⏳ Waiting for current operation to complete...");
      try {
        await this.currentOperation;
        console.log("✅ Operation completed successfully");
      } catch (error) {
        console.error("❌ Operation failed during shutdown:", error);
      }
    }

    // Run all cleanup handlers
    for (const handler of this.handlers) {
      try {
        await handler.waitForOperation();
        await handler.cleanup();
      } catch (error) {
        console.error("❌ Cleanup error:", error);
      }
    }

    console.log("👋 Shutdown complete");
    process.exit(0);
  }
}

// Singleton instance
export const gracefulShutdown = new GracefulShutdown();

export async function simpleGracefulShutdown<T>(
  operation: () => Promise<T>,
  cleanup?: () => Promise<void> | void
): Promise<T> {
  try {
    if (cleanup) {
      gracefulShutdown.registerHandler({
        waitForOperation: async () => {},
        cleanup: async () => cleanup(),
      });
    }

    const operationPromise = operation();
    gracefulShutdown.setCurrentOperation(operationPromise);
    const result = await operationPromise;
    gracefulShutdown.setCurrentOperation(null);
    return result;
  } catch (error) {
    gracefulShutdown.setCurrentOperation(null);
    throw error;
  }
}
