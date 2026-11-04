import { test } from "node:test";
import assert from "node:assert/strict";
import { awardOnce, dailyView, equipItem, newProfile, submitAnswer, sumCounter, xpFor } from "../src/core/profile.js";
import { COSMETICS, levelFor, levelStart } from "../src/core/catalog.js";
import { bankFixture, newFixture } from "./fixtures.js";
import { dailyEntry } from "../src/core/questions.js";

const now = new Date("2026-11-04T12:00Z");
test("daily answer is redacted until submitted and wrong answers still earn XP once", () => {
  const state = newFixture();
  const bank = [bankFixture[0]!];
  const q = dailyView(state, bank, now);
  assert.equal(q.answerIndex, undefined);
  assert.equal(q.explanation, undefined);
  submitAnswer(state, bank, now, q.id, q.day, 1);
  const answered = dailyView(state, bank, now);
  assert.equal(answered.correct, false);
  assert.equal(answered.answerIndex, 0);
  assert.equal(xpFor(state), 20);
  submitAnswer(state, bank, now, q.id, q.day, 0);
  assert.equal(xpFor(state), 20);
  assert.equal(state.daily[0]?.correct, false);
});

test("facts acknowledge once and continue a learning streak without a correct-answer requirement", () => {
  const state = newFixture(), bank = [bankFixture[2]!];
  const q = dailyView(state, bank, now);
  submitAnswer(state, bank, now, q.id, q.day, null);
  assert.equal(state.daily[0]?.correct, null);
  assert.equal(xpFor(state), 20);
  assert.doesNotThrow(() => dailyEntry(state, bank, new Date("2026-11-05T12:00Z")));
});

test("invalid answers, stale daily identity and locked equipment reject without XP", () => {
  const state = newFixture(), bank = [bankFixture[0]!], q = dailyView(state, bank, now);
  assert.throws(() => submitAnswer(state, bank, now, q.id, q.day, 2), /available/);
  assert.throws(() => submitAnswer(state, bank, now, q.id, "2026-11-03", 0), /today/);
  assert.throws(() => equipItem(state, "beanie"), /unlocks/);
  assert.throws(() => equipItem(state, "made-up"), /exist/);
  assert.equal(xpFor(state), 0);
});

test("XP and unlock boundaries are deterministic and awards cannot replay", () => {
  const state = newProfile(now, "UTC");
  assert.equal(levelFor(0), 1);
  assert.equal(levelFor(49), 1);
  assert.equal(levelFor(50), 2);
  assert.equal(levelFor(199), 2);
  assert.equal(levelFor(200), 3);
  assert.equal(levelStart(3), 200);
  const award = { id: "example", xp: 50, at: now.toISOString(), evidence: "synthetic" };
  assert.equal(awardOnce(state, award), true);
  assert.equal(awardOnce(state, award), false);
  equipItem(state, "beanie");
  assert.equal(state.equipped.head, "beanie");
  assert.equal(COSMETICS.filter(item => !item.skill && item.level <= levelFor(xpFor(state))).length, 8);
  assert.throws(() => equipItem(state, "context-keeper"), /learning path/);
});

test("totals show zero when reported, null when absent, and exact coverage", () => {
  const base = { id: "call", sessionId: "s", at: now.toISOString(), eventType: "assistant.usage", input: null, output: 0, cacheRead: null, cacheWrite: null, cacheDetailsReported: null };
  assert.deepEqual(sumCounter([base], "input"), { value: null, covered: 0 });
  assert.deepEqual(sumCounter([base], "output"), { value: 0, covered: 1 });
  assert.deepEqual(sumCounter([base, { ...base, id: "call2", input: 20 }], "input"), { value: 20, covered: 1 });
});
