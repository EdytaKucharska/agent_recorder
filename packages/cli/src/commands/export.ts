/**
 * Export command - export session events to various formats.
 * Supports: JSON, JSONL, HAR, OpenTelemetry
 */

import { writeFileSync } from "node:fs";
import { getActualListenPort, type Session, type BaseEvent } from "@agent-recorder/core";

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export interface ExportCommandOptions {
  format?: string;
  out?: string;
}

/**
 * Convert events to HAR (HTTP Archive) format.
 * HAR is commonly used for HTTP traffic analysis.
 */
function toHarFormat(session: Session, events: BaseEvent[]): object {
  const entries = events.map((event) => {
    const startTime = new Date(event.startedAt).getTime();
    const endTime = event.endedAt
      ? new Date(event.endedAt).getTime()
      : startTime;
    const duration = endTime - startTime;

    // Parse input JSON for request params
    let inputData: Record<string, unknown> = {};
    try {
      if (event.inputJson) inputData = JSON.parse(event.inputJson);
    } catch {
      /* ignore */
    }

    return {
      startedDateTime: event.startedAt,
      time: duration,
      request: {
        method: "POST",
        url: `mcp://${event.upstreamKey ?? "builtin"}/${event.mcpMethod ?? "tools/call"}`,
        httpVersion: "MCP/1.0",
        headers: [
          { name: "X-Tool-Name", value: event.toolName ?? "" },
          { name: "X-Event-Type", value: event.eventType },
          { name: "X-Agent-Name", value: event.agentName },
          { name: "X-Session-Id", value: event.sessionId },
        ],
        queryString: [],
        cookies: [],
        headersSize: -1,
        bodySize: event.inputJson?.length ?? 0,
        postData: {
          mimeType: "application/json",
          text: event.inputJson ?? "{}",
          params: Object.entries(inputData).map(([name, value]) => ({
            name,
            value: typeof value === "string" ? value : JSON.stringify(value),
          })),
        },
      },
      response: {
        status: event.status === "success" ? 200 : 500,
        statusText: event.status,
        httpVersion: "MCP/1.0",
        headers: [
          { name: "X-Duration-Ms", value: String(duration) },
          { name: "X-Event-Id", value: event.id },
        ],
        cookies: [],
        content: {
          size: event.outputJson?.length ?? 0,
          mimeType: "application/json",
          text: event.outputJson ?? "null",
        },
        redirectURL: "",
        headersSize: -1,
        bodySize: event.outputJson?.length ?? 0,
      },
      cache: {},
      timings: {
        blocked: 0,
        dns: 0,
        connect: 0,
        send: 0,
        wait: duration,
        receive: 0,
        ssl: 0,
      },
      serverIPAddress: "127.0.0.1",
      comment: `${event.eventType}: ${event.toolName ?? event.agentName}`,
    };
  });

  return {
    log: {
      version: "1.2",
      creator: {
        name: "agent-recorder",
        version: "2.0.8",
      },
      browser: {
        name: "Claude Code",
        version: "1.0",
      },
      pages: [
        {
          startedDateTime: session.startedAt,
          id: session.id,
          title: `Session ${session.id}`,
          pageTimings: {
            onContentLoad: -1,
            onLoad: -1,
          },
        },
      ],
      entries,
      comment: `Agent Recorder session export - ${events.length} events`,
    },
  };
}

/**
 * Convert events to OpenTelemetry format.
 * OTLP JSON format for traces.
 */
function toOpenTelemetryFormat(session: Session, events: BaseEvent[]): object {
  const resourceSpans = [
    {
      resource: {
        attributes: [
          { key: "service.name", value: { stringValue: "agent-recorder" } },
          { key: "service.version", value: { stringValue: "2.0.8" } },
          { key: "session.id", value: { stringValue: session.id } },
          { key: "session.status", value: { stringValue: session.status } },
        ],
      },
      scopeSpans: [
        {
          scope: {
            name: "agent-recorder",
            version: "2.0.8",
          },
          spans: events.map((event) => {
            const startNano = new Date(event.startedAt).getTime() * 1_000_000;
            const endNano = event.endedAt
              ? new Date(event.endedAt).getTime() * 1_000_000
              : startNano;

            return {
              traceId: session.id.replace(/-/g, "").slice(0, 32),
              spanId: event.id.replace(/-/g, "").slice(0, 16),
              parentSpanId: event.parentEventId
                ? event.parentEventId.replace(/-/g, "").slice(0, 16)
                : undefined,
              name: `${event.eventType}: ${event.toolName ?? event.agentName}`,
              kind: 3, // SPAN_KIND_CLIENT
              startTimeUnixNano: String(startNano),
              endTimeUnixNano: String(endNano),
              attributes: [
                { key: "event.type", value: { stringValue: event.eventType } },
                {
                  key: "tool.name",
                  value: { stringValue: event.toolName ?? "" },
                },
                {
                  key: "mcp.method",
                  value: { stringValue: event.mcpMethod ?? "" },
                },
                {
                  key: "mcp.server",
                  value: { stringValue: event.upstreamKey ?? "builtin" },
                },
                {
                  key: "agent.name",
                  value: { stringValue: event.agentName },
                },
                {
                  key: "agent.role",
                  value: { stringValue: event.agentRole },
                },
                ...(event.inputJson
                  ? [
                      {
                        key: "tool.input",
                        value: { stringValue: event.inputJson },
                      },
                    ]
                  : []),
                ...(event.outputJson
                  ? [
                      {
                        key: "tool.output",
                        value: { stringValue: event.outputJson },
                      },
                    ]
                  : []),
                ...(event.errorCategory
                  ? [
                      {
                        key: "error.category",
                        value: { stringValue: event.errorCategory },
                      },
                    ]
                  : []),
              ],
              status: {
                code: event.status === "success" ? 1 : 2, // OK or ERROR
                message: event.status,
              },
              events: [],
              links: [],
            };
          }),
        },
      ],
    },
  ];

  return { resourceSpans };
}

/**
 * Export a session's events to various formats.
 */
export async function exportCommand(
  id: string,
  options: ExportCommandOptions
): Promise<void> {
  const baseUrl = `http://127.0.0.1:${getActualListenPort()}`;
  const format = options.format ?? "jsonl";

  // Validate format
  const validFormats = ["json", "jsonl", "har", "otlp"];
  if (!validFormats.includes(format)) {
    console.error(`Invalid format. Use one of: ${validFormats.join(", ")}`);
    process.exit(1);
  }

  try {
    // Fetch session and events
    const session = await fetchJson<Session>(`${baseUrl}/api/sessions/${id}`);
    const events = await fetchJson<BaseEvent[]>(
      `${baseUrl}/api/sessions/${id}/events`
    );

    let output: string;

    switch (format) {
      case "jsonl": {
        // JSONL format: each line is an object with "type" field
        const lines: string[] = [];
        lines.push(JSON.stringify({ type: "session", ...session }));
        for (const event of events) {
          lines.push(JSON.stringify({ type: "event", ...event }));
        }
        output = lines.join("\n") + "\n";
        break;
      }

      case "json": {
        // JSON format: object with session and events arrays
        output = JSON.stringify({ session, events }, null, 2) + "\n";
        break;
      }

      case "har": {
        // HAR format: HTTP Archive for traffic analysis
        const har = toHarFormat(session, events);
        output = JSON.stringify(har, null, 2) + "\n";
        break;
      }

      case "otlp": {
        // OpenTelemetry format: OTLP JSON traces
        const otlp = toOpenTelemetryFormat(session, events);
        output = JSON.stringify(otlp, null, 2) + "\n";
        break;
      }

      default:
        output = "";
    }

    if (options.out) {
      writeFileSync(options.out, output);
      console.log(`Exported ${events.length} events to ${options.out}`);
    } else {
      process.stdout.write(output);
    }
  } catch {
    console.error(`Failed to export session: ${id}`);
    process.exit(1);
  }
}
