import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BudService } from "../src/service.js";
import { achievementViews, evaluateAchievements } from "../src/core/achievements.js";
import { normalizeEvent, readCopilotUsage } from "../src/adapters/copilot.js";
import { dailyView, submitAnswer, xpFor } from "../src/core/profile.js";
import { validateQuestions } from "../src/core/questions.js";
import { bankFixture, newFixture } from "./fixtures.js";

test("aged content cannot leave impossible milestones pretending to be available", () => {
  const bank = validateQuestions(JSON.parse(readFileSync(new URL("../content/questions.json", import.meta.url), "utf8")));
  const views = achievementViews(newFixture(), bank, new Date("2027-03-01T12:00Z"));
  for (const id of ["fact-finder", "deep-diver", "context-aware", "curious-explorer"]) {
    assert.equal(views.find(a => a.id === id)?.unavailable, true, id);
  }
});

test("retiring a question preserves snapshotted category/difficulty progress", () => {
  const state = newFixture();
  for (let i = 0; i < 5; i++) {
    state.daily.push({ day: `2026-11-0${i + 1}`, questionId: `retired-${i}`, answered: true, selectedIndex: 0, correct: true, item: { category: "context", difficulty: "hard", type: "quiz" } });
  }
  evaluateAchievements(state, bankFixture, new Date("2026-11-10T12:00Z"));
  assert.ok(state.awards.some(a => a.id === "achievement:deep-diver"));
  assert.ok(state.awards.some(a => a.id === "achievement:context-aware"));
});

test("facts accept omitted answerIndex while maintaining a single award", () => {
  const state = newFixture(), bank = [bankFixture[2]!], now = new Date("2026-11-04T12:00Z");
  const q = dailyView(state, bank, now);
  submitAnswer(state, bank, now, q.id, q.day, undefined);
  assert.equal(xpFor(state), 20);
});

test("cache details explicitly unreported are null, not zero; foreign source sessions are excluded", () => {
  const event = { id: "x", timestamp: "2026-11-04T12:00Z", type: "assistant.usage", data: { inputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, cacheDetailsReported: false } };
  assert.equal(normalizeEvent(event, "s").call?.cacheRead, null);
  assert.equal(normalizeEvent(event, "s").call?.cacheWrite, null);
  assert.deepEqual(normalizeEvent({ ...event, data: { ...event.data, accounting: { sourceSessionId: "other", usageId: "x" } } }, "s"), {});
});

test("overlapping event formats with missing or mixed call IDs choose one source rather than double count", async () => {
  const home = mkdtempSync(join(tmpdir(), "bud-overlap-"));
  try {
    const dir = join(home, "session-state", "s");
    mkdirSync(dir, { recursive: true });
    const base = { timestamp: "2026-11-04T12:00Z" };
    const usage = { inputTokens: 10, outputTokens: 2 };
    writeFileSync(join(dir, "events.jsonl"), [
      { ...base, id: "public", type: "assistant.usage", data: { ...usage, accounting: { usageId: "known" } } },
      { ...base, id: "internal", type: "session.usage_record", data: { usage } }
    ].map(e => JSON.stringify(e)).join("\n") + "\n");
    const result = await readCopilotUsage(home, "s", new Date());
    assert.equal(result.calls.length, 1);
    assert.equal(result.calls[0]?.input, 10);
    assert.match(result.diagnostics.join(" "), /avoid duplicates/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("daily errors don't roll back equipment or imported usage, and old syncs cannot replace newer snapshots", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bud-daily-error-"));
  const now = new Date("2027-03-01T12:00Z");
  const service = new BudService({ directory, copilotHome: directory, sessionId: "s", questions: bankFixture.map(q => ({ ...q, mayGoStale: true })), clock: () => now, timezone: "UTC" });
  try {
    const result = await service.dispatch("get_profile");
    assert.equal(result.daily, null);
    assert.equal(result.dailyError?.code, "content_stale");
    assert.equal((await service.dispatch("equip_item", { itemId: "mint" })).profile.equipped.color, "mint");
    const dir = join(directory, "session-state", "s");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "events.jsonl"), JSON.stringify({ id: "x", timestamp: now.toISOString(), type: "assistant.usage", data: { inputTokens: 15 } }) + "\n");
    assert.equal((await service.dispatch("sync_usage", { consent: true })).usage.input.value, 15);
    service.store.transaction(state => { state.usage.syncedAt = "2027-03-02T12:00Z"; state.usage.calls[0]!.input = 30; });
    assert.equal((await service.dispatch("sync_usage", { consent: true })).usage.input.value, 30);
  } finally { service.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("context sample timestamps compare chronologically, not lexicographically", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bud-context-order-"));
  const service = new BudService({ directory, copilotHome: directory, sessionId: "s", questions: bankFixture, clock: () => new Date("2026-11-04T12:00Z"), timezone: "UTC" });
  try {
    service.store.transaction(state => {
      state.usage.sessionId = "s";
      state.usage.contexts = [
        { id: "earlier", sessionId: "s", at: "2026-11-04T10:00:00Z", current: 10, limit: 100, basis: "session.usage_info" },
        { id: "later", sessionId: "s", at: "2026-11-04T10:00:00.500Z", current: 20, limit: 100, basis: "session.usage_info" }
      ];
    });
    assert.equal((await service.dispatch("get_profile")).usage.context?.current, 20);
  } finally { service.close(); rmSync(directory, { recursive: true, force: true }); }
});
