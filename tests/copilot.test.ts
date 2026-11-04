import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { normalizeEvent, readCopilotUsage } from "../src/adapters/copilot.js";

const event = (type: string, data: unknown, id = "e1") => ({ id, type, timestamp: "2026-11-04T10:00:00Z", data });

test("normalizes both observed and public usage events, preserving missing versus zero", () => {
  const data = { inputTokens: 0, outputTokens: 12, cacheReadTokens: 0, accounting: { usageId: "call" }, cacheDetailsReported: true };
  const a = normalizeEvent(event("assistant.usage", data), "s");
  const b = normalizeEvent(event("session.usage_record", { usage: data }, "e2"), "s");
  assert.equal(a.call?.id, b.call?.id);
  assert.equal(a.call?.input, 0);
  assert.equal(a.call?.cacheWrite, null);
  assert.equal(a.call?.output, 12);
  assert.equal(a.call?.cacheDetailsReported, true);
});

test("rejects unsafe/negative counters and extracts only allowlisted context/usage", () => {
  assert.equal(normalizeEvent(event("assistant.usage", { inputTokens: -1, outputTokens: Infinity, content: "PRIVATE" }), "s").call?.input, null);
  assert.deepEqual(normalizeEvent(event("user.message", { content: "PRIVATE" }), "s"), {});
  const context = normalizeEvent(event("session.usage_info", { currentTokens: 50, tokenLimit: 100 }), "s").context;
  assert.equal(context?.basis, "session.usage_info");
  assert.equal(context?.limit, 100);
  assert.deepEqual(normalizeEvent(event("session.usage_info", { currentTokens: 50, tokenLimit: 0 }), "s"), {});
});

test("reader deduplicates calls, defers partial lines, reports malformed input and never persists transcript text", async () => {
  const home = await mkdtemp(join(tmpdir(), "bud-adapter-"));
  try {
    const dir = join(home, "session-state", "session");
    await mkdir(dir, { recursive: true });
    const call = JSON.stringify(event("assistant.usage", { inputTokens: 10, outputTokens: 4, secret: "PRIVATE" }));
    await writeFile(join(dir, "events.jsonl"), `${call}\n${call}\nnot-json\n${JSON.stringify(event("user.message", { content: "PRIVATE" }))}\n{"partial":`);
    const result = await readCopilotUsage(home, "session", new Date("2026-11-04T12:00Z"));
    assert.equal(result.calls.length, 1);
    assert.equal(result.calls[0]?.input, 10);
    assert.match(result.diagnostics.join(" "), /unfinished/);
    assert.match(result.diagnostics.join(" "), /invalid/);
    assert.ok(!JSON.stringify(result).includes("PRIVATE"));
    assert.deepEqual(await readCopilotUsage(home, "session", new Date("2026-11-04T12:00Z")), result);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("missing logs and path traversal produce explicit errors", async () => {
  await assert.rejects(readCopilotUsage(tmpdir(), "..\\escape", new Date()), /valid session/);
  await assert.rejects(readCopilotUsage(tmpdir(), "bud-no-such-session-xyz", new Date()), /no local event log/);
});
