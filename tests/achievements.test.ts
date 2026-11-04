import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateQuestions } from "../src/core/questions.js";
import { achievementViews, evaluateAchievements } from "../src/core/achievements.js";
import { newFixture } from "./fixtures.js";
import { xpFor } from "../src/core/profile.js";

const bank = validateQuestions(JSON.parse(readFileSync(new URL("../content/questions.json", import.meta.url), "utf8")));
const now = new Date("2026-12-20T12:00Z");

test("the verified bank supports all seven categories and reachable achievement thresholds", () => {
  assert.ok(bank.length >= 30);
  assert.equal(new Set(bank.map(q => q.category)).size, 7);
  assert.ok(bank.filter(q => q.type === "did-you-know").length >= 10);
  assert.ok(bank.filter(q => q.type === "quiz" && q.difficulty === "hard").length >= 5);
  assert.ok(bank.every(q => /^https:\/\/(docs\.github\.com|github\.com\/github\/copilot-sdk|modelcontextprotocol\.io)(?:\/|$)/.test(q.sourceUrl)));
});

test("learning milestones are awarded exactly once; usage volume awards nothing", () => {
  const state = newFixture();
  evaluateAchievements(state, bank, now);
  assert.equal(xpFor(state), 0);
  for (const [index, q] of bank.entries()) {
    state.daily.push({ day: new Date(Date.UTC(2026, 10, index + 1)).toISOString().slice(0, 10), questionId: q.id, answered: true, selectedIndex: q.answerIndex, correct: q.type === "quiz" ? true : null });
  }
  evaluateAchievements(state, bank, now);
  const awards = state.awards.length, xp = xpFor(state);
  assert.equal(awards, 6);
  evaluateAchievements(state, bank, now);
  assert.equal(state.awards.length, awards);
  assert.equal(xpFor(state), xp);
  assert.ok(achievementViews(state, bank, now).filter(a => a.unavailable).every(a => !a.unlocked));
});

test("correctness achievements count distinct first encounters, not retries or repeated IDs", () => {
  const state = newFixture(), hard = bank.find(q => q.difficulty === "hard" && q.type === "quiz")!;
  state.daily.push({ day: "2026-11-01", questionId: hard.id, answered: true, selectedIndex: 0, correct: false });
  for (let day = 2; day <= 8; day++) {
    state.daily.push({ day: `2026-11-0${day}`, questionId: hard.id, answered: true, selectedIndex: hard.answerIndex, correct: true });
  }
  evaluateAchievements(state, bank, now);
  assert.ok(!state.awards.some(a => a.id === "achievement:deep-diver"));
  assert.ok(!state.awards.some(a => a.id === "achievement:context-aware"));
  assert.ok(state.awards.some(a => a.id === "achievement:steady-learner"));
});

test("reflections require three distinct days and remain explicitly self-reported", () => {
  const state = newFixture();
  for (const kind of ["fresh-session", "lean-instructions", "mcp-cleanup"] as const) {
    state.reflections.push({ id: `${kind}:2026-11-04`, kind, at: "2026-11-04T12:00Z" });
  }
  evaluateAchievements(state, bank, now);
  assert.equal(state.awards.length, 0);
  state.reflections.push({ id: "fresh-session:2026-11-05", kind: "fresh-session", at: "2026-11-05T12:00Z" });
  state.reflections.push({ id: "fresh-session:2026-11-06", kind: "fresh-session", at: "2026-11-06T12:00Z" });
  evaluateAchievements(state, bank, now);
  assert.equal(xpFor(state), 15);
  assert.match(state.awards[0]!.evidence, /Self-reported/);
});
