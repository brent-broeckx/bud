import { test } from "node:test";
import assert from "node:assert/strict";
import { dailyEntry, dayFor, streak, validateQuestions } from "../src/core/questions.js";
import { newFixture as fakeState, bankFixture as fakeBank } from "./fixtures.js";

test("bank validation rejects duplicate IDs, bad answers and non-HTTPS sources", () => {
  assert.equal(validateQuestions(fakeBank).length, 3);
  assert.throws(() => validateQuestions([...fakeBank, fakeBank[0]]), /invalid/);
  assert.throws(() => validateQuestions([{ ...fakeBank[0], answerIndex: 9 }]), /invalid/);
  assert.throws(() => validateQuestions([{ ...fakeBank[0], sourceUrl: "http://example.com" }]), /invalid/);
});

test("daily selection is stable, rotates without consecutive repeats, and spans categories", () => {
  const state = fakeState();
  const first = dailyEntry(state, fakeBank, new Date("2026-11-04T12:00Z"));
  assert.equal(dailyEntry(state, fakeBank, new Date("2026-11-04T23:59Z")), first);
  const second = dailyEntry(state, fakeBank, new Date("2026-11-05T12:00Z"));
  const third = dailyEntry(state, fakeBank, new Date("2026-11-06T12:00Z"));
  assert.equal(new Set([first.questionId, second.questionId, third.questionId]).size, 3);
  assert.notEqual(dailyEntry(state, fakeBank, new Date("2026-11-07T12:00Z")).questionId, third.questionId);
});

test("stale and future items are excluded and clock rollback cannot mint days", () => {
  const state = fakeState();
  assert.throws(() => dailyEntry(state, fakeBank.map(q => ({ ...q, mayGoStale: true })), new Date("2027-04-04T12:00Z")), /fresh/);
  assert.throws(() => dailyEntry(state, fakeBank, new Date("2025-11-04T12:00Z")), /fresh/);
  dailyEntry(state, fakeBank, new Date("2026-11-05T12:00Z"));
  assert.throws(() => dailyEntry(state, fakeBank, new Date("2026-11-04T12:00Z")), /backwards/);
});

test("streak allows learning today after yesterday; a missed day resets without penalty", () => {
  const state = fakeState();
  for (const date of ["2026-11-01", "2026-11-02", "2026-11-03"]) {
    state.daily.push({ day: date, questionId: "a", answered: true, selectedIndex: 1, correct: false });
  }
  assert.equal(streak(state, new Date("2026-11-04T10:00Z")), 3);
  assert.equal(streak(state, new Date("2026-11-05T10:00Z")), 0);
});

test("calendar dates respect the profile timezone, including DST", () => {
  assert.equal(dayFor(new Date("2026-11-04T00:30Z"), "America/New_York"), "2026-11-03");
  assert.equal(dayFor(new Date("2026-11-04T00:30Z"), "Asia/Tokyo"), "2026-11-04");
});
