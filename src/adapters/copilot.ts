import { open, stat, realpath } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join, relative, isAbsolute, sep } from "node:path";
import { BudError, type ContextSample, type UsageCall, type UsageState } from "../core/types.js";

type Bag = Record<string, unknown>;
function bag(value: unknown): Bag {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Bag : {};
}
function counter(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function normalizeEvent(raw: unknown, sessionId: string): { call?: UsageCall; context?: ContextSample } {
  const event = bag(raw), data = bag(event.data);
  if (typeof event.id !== "string" || typeof event.timestamp !== "string" || Number.isNaN(Date.parse(event.timestamp))) return {};
  const id = `${sessionId}:${event.id}`;
  if (event.type === "session.usage_record" || event.type === "assistant.usage") {
    const usage = event.type === "session.usage_record" ? bag(data.usage) : data;
    const accounting = bag(usage.accounting);
    const usageId = typeof accounting.usageId === "string" ? accounting.usageId : event.id;
    const sourceSession = typeof accounting.sourceSessionId === "string" ? accounting.sourceSessionId : sessionId;
    if (sourceSession !== sessionId) return {};
    const cacheUnavailable = usage.cacheDetailsReported === false;
    return { call: {
      id: `${sourceSession}:${usageId}`, sessionId, at: event.timestamp, eventType: event.type,
      input: counter(usage.inputTokens), output: counter(usage.outputTokens),
      cacheRead: cacheUnavailable ? null : counter(usage.cacheReadTokens), cacheWrite: cacheUnavailable ? null : counter(usage.cacheWriteTokens),
      cacheDetailsReported: typeof usage.cacheDetailsReported === "boolean" ? usage.cacheDetailsReported : null
    } };
  }
  if (event.type === "session.usage_info") {
    const current = counter(data.currentTokens), limit = counter(data.tokenLimit);
    if (current !== null && limit !== null && limit > 0) {
      return { context: { id, sessionId, at: event.timestamp, current, limit, basis: "session.usage_info" } };
    }
  }
  if (event.type === "tool.execution_complete") {
    const metrics = bag(bag(data.toolTelemetry).metrics);
    const current = counter(metrics.context_current_tokens), limit = counter(metrics.context_token_limit);
    if (current !== null && limit !== null && limit > 0) {
      return { context: { id, sessionId, at: event.timestamp, current, limit, basis: "tool-telemetry" } };
    }
  }
  return {};
}

export async function readCopilotUsage(home: string, sessionId: string, now: Date): Promise<UsageState> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(sessionId)) throw new BudError("session_id", "The host did not provide a valid session ID.");
  let path = join(home, "session-state", sessionId, "events.jsonl");
  let file;
  try {
    const root = await realpath(join(home, "session-state"));
    path = await realpath(path);
    const local = relative(root, path);
    if (isAbsolute(local) || local === ".." || local.startsWith(`..${sep}`)) throw new BudError("usage_path", "The usage log is outside local session storage.");
    file = await open(path, "r");
  }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new BudError("usage_unavailable", "This Copilot session has no local event log yet. Try again after a model turn.");
    }
    throw error;
  }
  const calls = new Map<string, UsageCall>(), contexts = new Map<string, ContextSample>();
  const unidentified = new Set<string>();
  const formats = new Set<string>();
  let malformed = 0, lines = 0, partial = false;
  try {
    const metadata = await file.stat();
    if (metadata.size > 64 * 1024 * 1024) throw new BudError("usage_size", "This session log exceeds Bud's 64 MB import limit. Start a fresh session; no partial totals were imported.");
    if (metadata.size) {
      const last = Buffer.alloc(1);
      await file.read(last, 0, 1, metadata.size - 1);
      partial = last[0] !== 10;
    }
    const stream = file.createReadStream({ start: 0, end: Math.max(0, metadata.size - 1), autoClose: false });
    const reader = createInterface({ input: stream, crlfDelay: Infinity });
    let pending: string | undefined;
    const consume = (line: string) => {
      if (!line.trim()) return;
      lines++;
      let raw: unknown;
      try { raw = JSON.parse(line); } catch { malformed++; return; }
      const normalized = normalizeEvent(raw, sessionId);
      if (normalized.call) {
        formats.add(normalized.call.eventType);
        const eventData = bag(bag(raw).data);
        const accounting = bag(bag(normalized.call.eventType === "session.usage_record" ? eventData.usage : eventData).accounting);
        if (typeof accounting.usageId !== "string") unidentified.add(normalized.call.id);
        calls.set(normalized.call.id, normalized.call);
      }
      if (normalized.context) contexts.set(normalized.context.id, normalized.context);
    };
    for await (const line of reader) {
      if (pending !== undefined) consume(pending);
      pending = line;
    }
    if (pending !== undefined && !partial) consume(pending);
    const after = await stat(path);
    if (after.size < metadata.size || after.ino !== metadata.ino) throw new BudError("usage_changed", "The session log changed during import. Retry to read a consistent snapshot.");
  } finally { await file.close(); }
  const diagnostics = [
    "Current Copilot session only. Provider-reported counters; no transcript text is stored.",
    "Cache ratios are unavailable until their denominator is verified. Context samples do not establish peak usage."
  ];
  if (formats.size > 1 && unidentified.size > 0) {
    for (const [id, call] of calls) {
      if (call.eventType !== "session.usage_record") calls.delete(id);
    }
    diagnostics.push("Overlapping usage event formats lacked reliable call IDs. Only session.usage_record was counted to avoid duplicates; coverage may be incomplete.");
  }
  if (partial) diagnostics.push("An unfinished final log line was deferred until the next import.");
  if (malformed) diagnostics.push(`${malformed} of ${lines} complete log lines were invalid. Totals cover only readable records.`);
  if (!calls.size) diagnostics.push("No supported per-call usage records were found. Counters are unavailable, not zero.");
  return { calls: [...calls.values()], contexts: [...contexts.values()], syncedAt: now.toISOString(), sessionId, diagnostics };
}
