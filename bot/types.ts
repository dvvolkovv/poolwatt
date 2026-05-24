export interface SessionRecord {
  claudeSessionId: string;
  startedAt: number;
  lastActivity: number;
}

export type StreamEvent =
  | { kind: "init"; sessionId: string }
  | { kind: "tool_use"; toolName: string; input: unknown }
  | { kind: "text"; text: string }
  | { kind: "result"; isError: boolean }
  | { kind: "unknown"; raw: unknown };

export interface RunResult {
  exitCode: number;
  finalText: string;
  stderrTail: string;
  sessionId: string | null;
  durationMs: number;
  timedOut: boolean;
  canceled: boolean;
}
