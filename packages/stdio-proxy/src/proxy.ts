/**
 * STDIO Proxy for MCP Server Observability
 *
 * This proxy wraps an MCP server and records all stdin/stdout traffic
 * without modifying the message content.
 *
 * Key constraints (from MCP spec):
 * - Server MUST NOT write anything to stdout that is not a valid MCP message
 * - Messages are newline-delimited JSON
 * - Messages MUST NOT contain embedded newlines
 *
 * Safety measures:
 * - All logging goes to stderr or file (NEVER stdout)
 * - Unbuffered I/O to prevent message loss
 * - Signal handling for clean shutdown
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import { createInterface } from "node:readline";
import type {
  ProxyOptions,
  ProxyState,
  McpMessage,
  JsonRpcRequest,
  JsonRpcResponse,
} from "./types.js";

/** Mutex for synchronized stdout reading */
class ReadMutex {
  private locked = false;
  private queue: (() => void)[] = [];

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }

    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}

export class StdioProxy {
  private options: ProxyOptions;
  private state: ProxyState;
  private child: ChildProcess | null = null;
  private logStream: WriteStream | null = null;
  private readMutex = new ReadMutex();
  private shutdownRequested = false;

  constructor(options: ProxyOptions) {
    this.options = options;
    this.state = {
      running: false,
      requestCount: 0,
      responseCount: 0,
    };
  }

  /** Log to stderr (NEVER stdout) */
  private log(message: string): void {
    if (this.options.debug) {
      process.stderr.write(`[agent-recorder] ${message}\n`);
    }
  }

  /** Record a message to file and/or endpoint */
  private async recordMessage(message: McpMessage): Promise<void> {
    const line = JSON.stringify(message) + "\n";

    // Write to file if configured
    if (this.logStream) {
      this.logStream.write(line);
    }

    // POST to endpoint if configured
    if (this.options.endpoint) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);

        await fetch(this.options.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...message,
            sessionId: this.options.sessionId,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);
      } catch {
        // Fail silently - don't block the proxy
        this.log(`Failed to POST to endpoint: ${this.options.endpoint}`);
      }
    }
  }

  /** Parse JSON-RPC message for telemetry */
  private parseMessage(
    raw: string,
    direction: "request" | "response"
  ): McpMessage {
    const timestamp = new Date().toISOString();
    const message: McpMessage = { timestamp, direction, raw };

    try {
      const parsed = JSON.parse(raw) as JsonRpcRequest | JsonRpcResponse;

      if ("method" in parsed) {
        // Request
        message.method = parsed.method;
        message.id = parsed.id;
      } else {
        // Response
        message.id = parsed.id;
        message.isError = "error" in parsed;
      }
    } catch {
      // Invalid JSON - just record raw
      this.log(`Invalid JSON: ${raw.slice(0, 100)}`);
    }

    return message;
  }

  /** Set up signal handlers for clean shutdown */
  private setupSignalHandlers(): void {
    const shutdown = (signal: string) => {
      if (this.shutdownRequested) return;
      this.shutdownRequested = true;

      this.log(`Received ${signal}, shutting down...`);
      this.stop();
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGHUP", () => shutdown("SIGHUP"));

    // Handle parent process death
    process.on("disconnect", () => shutdown("disconnect"));
  }

  /** Start the proxy */
  async start(): Promise<void> {
    if (this.state.running) {
      throw new Error("Proxy is already running");
    }

    this.log(
      `Starting proxy for: ${this.options.command} ${this.options.args.join(" ")}`
    );

    // Open log file if configured
    if (this.options.outputFile) {
      this.logStream = createWriteStream(this.options.outputFile, {
        flags: "a",
      });
      this.log(`Logging to: ${this.options.outputFile}`);
    }

    // Set up signal handlers
    this.setupSignalHandlers();

    // Build environment - pass through all env vars
    const env = {
      ...process.env,
      ...this.options.env,
    };

    // Spawn child process with unbuffered pipes
    this.child = spawn(this.options.command, this.options.args, {
      cwd: this.options.cwd ?? process.cwd(),
      env,
      stdio: ["pipe", "pipe", "pipe"],
      // Don't use shell - direct execution is safer
      shell: false,
    });

    this.state.childPid = this.child.pid;
    this.state.startedAt = new Date().toISOString();
    this.state.running = true;

    this.log(`Child process started with PID: ${this.child.pid}`);

    // Handle child process errors
    this.child.on("error", (err) => {
      process.stderr.write(
        `[agent-recorder] Child process error: ${err.message}\n`
      );
      this.stop(1);
    });

    // Handle child process exit
    this.child.on("exit", (code, signal) => {
      this.log(`Child process exited with code ${code}, signal ${signal}`);
      this.state.running = false;

      // Close log stream
      if (this.logStream) {
        this.logStream.end();
        this.logStream = null;
      }

      // Exit with same code as child
      process.exit(code ?? 0);
    });

    // Pipe stdin from parent to child (requests)
    this.setupStdinPipe();

    // Pipe stdout from child to parent (responses)
    this.setupStdoutPipe();

    // Forward stderr from child to parent stderr
    if (this.child.stderr) {
      this.child.stderr.pipe(process.stderr);
    }
  }

  /** Set up stdin pipe with recording */
  private setupStdinPipe(): void {
    if (!this.child?.stdin) return;

    // Use readline for line-by-line processing (JSON-RPC messages are newline-delimited)
    const rl = createInterface({
      input: process.stdin,
      crlfDelay: Infinity,
    });

    rl.on("line", async (line) => {
      if (!this.child?.stdin || this.shutdownRequested) return;

      // Record the request
      const message = this.parseMessage(line, "request");
      this.state.requestCount++;

      // Log method for debugging
      if (message.method) {
        this.log(`→ ${message.method} (id: ${message.id})`);
      }

      // Record asynchronously (don't block)
      this.recordMessage(message).catch(() => {});

      // Forward to child stdin immediately (unbuffered)
      this.child.stdin.write(line + "\n");
    });

    rl.on("close", () => {
      this.log("Parent stdin closed");
      // Close child stdin to signal EOF
      this.child?.stdin?.end();
    });
  }

  /** Set up stdout pipe with recording */
  private setupStdoutPipe(): void {
    if (!this.child?.stdout) return;

    // Use readline for line-by-line processing
    const rl = createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity,
    });

    rl.on("line", async (line) => {
      if (this.shutdownRequested) return;

      // Use mutex to prevent concurrent stdout corruption
      await this.readMutex.acquire();

      try {
        // Record the response
        const message = this.parseMessage(line, "response");
        this.state.responseCount++;

        // Log for debugging
        if (message.isError) {
          this.log(`← ERROR (id: ${message.id})`);
        } else if (message.id !== undefined) {
          this.log(`← response (id: ${message.id})`);
        }

        // Record asynchronously (don't block)
        this.recordMessage(message).catch(() => {});

        // Forward to parent stdout immediately (unbuffered)
        // This is the ONLY place we write to stdout
        process.stdout.write(line + "\n");
      } finally {
        this.readMutex.release();
      }
    });

    rl.on("close", () => {
      this.log("Child stdout closed");
    });
  }

  /** Stop the proxy and clean up */
  stop(exitCode = 0): void {
    this.log("Stopping proxy...");
    this.shutdownRequested = true;

    // Kill child process if running
    if (this.child && !this.child.killed) {
      this.log(`Terminating child process PID ${this.child.pid}`);

      // Try graceful shutdown first
      this.child.kill("SIGTERM");

      // Force kill after timeout
      setTimeout(() => {
        if (this.child && !this.child.killed) {
          this.log("Force killing child process");
          this.child.kill("SIGKILL");
        }
      }, 5000);
    }

    // Close log stream
    if (this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }

    this.state.running = false;

    // Log final stats
    this.log(
      `Stats: ${this.state.requestCount} requests, ${this.state.responseCount} responses`
    );

    // Exit if child hasn't exited yet
    if (!this.child?.killed) {
      setTimeout(() => process.exit(exitCode), 100);
    }
  }

  /** Get current proxy state */
  getState(): ProxyState {
    return { ...this.state };
  }
}
