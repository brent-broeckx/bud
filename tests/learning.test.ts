import { test } from "node:test";
import assert from "node:assert/strict";
import { CHALLENGES, applyLearningAction, learningView, newLearningState } from "../src/core/learning.js";
import { validateQuestions } from "../src/core/questions.js";
import { readFileSync } from "node:fs";
import { bankFixture } from "./fixtures.js";

const day1 = new Date("2026-11-04T12:00Z");
const day2 = new Date("2026-11-05T12:00Z");

test("exploration lists every non-stale eligible item, unlimited and source-linked", () => {
  const state = newLearningState();
  const bank = [...bankFixture, { ...bankFixture[0]!, id: "stale", mayGoStale: true, verifiedOn: "2026-01-01" }, { ...bankFixture[0]!, id: "future", verifiedOn: "2026-12-01" }];
  const view = learningView(state, bank, day1);
  const ids = view.paths.flatMap(p => p.lessons.map(l => l.id)).sort();
  assert.deepEqual(ids, ["a", "b", "c"]);
  assert.ok(view.paths.flatMap(p => p.lessons).every(l => l.sourceUrl.startsWith("https://")));
  assert.throws(() => applyLearningAction(state, bank, day1, "start_lesson", { questionId: "stale" }), { code: "content_stale" });
  for (const id of ["a", "b", "c"]) {
    applyLearningAction(state, bank, day1, "start_lesson", { questionId: id });
    const result = applyLearningAction(state, bank, day1, "submit_lesson", { questionId: id, answerIndex: id === "c" ? null : 0 });
    assert.equal(result.award?.id, `learning:lesson:${id}`);
  }
  assert.equal(learningView(state, bank, day1).progress.lessonsCompleted, 3);
});

test("answers and explanations stay hidden until submission", () => {
  const state = newLearningState();
  applyLearningAction(state, bankFixture, day1, "start_lesson", { questionId: "b" });
  const before = learningView(state, bankFixture, day1).activeLesson;
  assert.ok(before && !("answerIndex" in before) && !("explanation" in before));
  applyLearningAction(state, bankFixture, day1, "submit_lesson", { questionId: "b", answerIndex: 1 });
  const after = learningView(state, bankFixture, day1).activeLesson;
  assert.equal(after?.answerIndex, 1);
  assert.equal(after?.correct, true);

  applyLearningAction(state, bankFixture, day1, "start_challenge", { challengeId: "practice-handoff" });
  const practice = learningView(state, bankFixture, day1).activeChallenge;
  assert.ok(practice?.kind === "practice" && practice.answerIndex === undefined && practice.explanation === undefined && practice.hint);
  assert.ok(learningView(state, bankFixture, day1).challenges.every(c => !("answerIndex" in c) && !("options" in c)));
});

test("invalid input is rejected with BudError codes", () => {
  const state = newLearningState();
  assert.throws(() => applyLearningAction(state, bankFixture, day1, "explode", {}), { code: "learning_action" });
  assert.throws(() => applyLearningAction(state, bankFixture, day1, "start_lesson", null as never), { code: "learning_input" });
  assert.throws(() => applyLearningAction(state, bankFixture, day1, "start_lesson", { questionId: 3 }), { code: "learning_input" });
  assert.throws(() => applyLearningAction(state, bankFixture, day1, "start_lesson", { questionId: "nope" }), { code: "lesson_missing" });
  assert.throws(() => applyLearningAction(state, bankFixture, day1, "submit_lesson", { questionId: "a", answerIndex: 0 }), { code: "lesson_changed" });
  applyLearningAction(state, bankFixture, day1, "start_lesson", { questionId: "a" });
  for (const answerIndex of [-1, 2, 0.5, "0", undefined]) {
    assert.throws(() => applyLearningAction(state, bankFixture, day1, "submit_lesson", { questionId: "a", answerIndex }), { code: "answer" });
  }
  applyLearningAction(state, bankFixture, day1, "start_lesson", { questionId: "c" });
  assert.throws(() => applyLearningAction(state, bankFixture, day1, "submit_lesson", { questionId: "c", answerIndex: 0 }), { code: "answer" });
  assert.throws(() => applyLearningAction(state, bankFixture, day1, "start_challenge", { challengeId: "nope" }), { code: "challenge_missing" });
  assert.equal(state.history.length, 0);
});

test("retrying never farms XP; one award per invocation", () => {
  const state = newLearningState();
  const awards: string[] = [];
  for (let i = 0; i < 4; i++) {
    applyLearningAction(state, bankFixture, day1, "start_lesson", { questionId: "a" });
    const result = applyLearningAction(state, bankFixture, day1, "submit_lesson", { questionId: "a", answerIndex: i % 2 });
    if (result.award) awards.push(result.award.id);
    assert.equal(applyLearningAction(state, bankFixture, day1, "submit_lesson", { questionId: "a", answerIndex: 0 }).award, undefined);
  }
  for (let i = 0; i < 3; i++) {
    applyLearningAction(state, bankFixture, day2, "start_challenge", { challengeId: "practice-regression" });
    const result = applyLearningAction(state, bankFixture, day2, "submit_challenge", { challengeId: "practice-regression", answerIndex: 1 });
    if (result.award) awards.push(result.award.id);
  }
  assert.deepEqual(awards, ["learning:lesson:a", "learning:practice:practice-regression"]);
  assert.equal(state.items["lesson:a"]?.attempts, 4);
});

test("a correct first answer can't be turned into mastery XP later", () => {
  const state = newLearningState();
  applyLearningAction(state, bankFixture, day1, "start_lesson", { questionId: "a" });
  applyLearningAction(state, bankFixture, day1, "submit_lesson", { questionId: "a", answerIndex: 0 });
  applyLearningAction(state, bankFixture, day1, "start_lesson", { questionId: "a" });
  applyLearningAction(state, bankFixture, day1, "submit_lesson", { questionId: "a", answerIndex: 1 });
  applyLearningAction(state, bankFixture, day2, "start_lesson", { questionId: "a" });
  assert.equal(applyLearningAction(state, bankFixture, day2, "submit_lesson", { questionId: "a", answerIndex: 0 }).award, undefined);
  assert.equal(learningView(state, bankFixture, day2).revisit.length, 0);
});

test("wrong answers are revisited and earn mastery only on a later local day, once", () => {
  const state = newLearningState();
  applyLearningAction(state, bankFixture, day1, "start_lesson", { questionId: "a" });
  assert.equal(applyLearningAction(state, bankFixture, day1, "submit_lesson", { questionId: "a", answerIndex: 1 }).award?.id, "learning:lesson:a");
  let view = learningView(state, bankFixture, day1);
  assert.deepEqual(view.revisit.map(r => [r.id, r.due]), [["a", false]]);

  applyLearningAction(state, bankFixture, day1, "start_lesson", { questionId: "a" });
  assert.equal(applyLearningAction(state, bankFixture, day1, "submit_lesson", { questionId: "a", answerIndex: 0 }).award, undefined);

  // 23:30 in Tokyo on Nov 4 UTC is already Nov 5 locally.
  const tokyoNextDay = new Date("2026-11-04T15:30Z");
  assert.equal(learningView(state, bankFixture, tokyoNextDay).revisit[0]?.due, false);
  assert.equal(learningView(state, bankFixture, tokyoNextDay, "Asia/Tokyo").revisit[0]?.due, true);
  view = learningView(state, bankFixture, day2);
  assert.equal(view.recommended.lessonId, "a");

  applyLearningAction(state, bankFixture, day2, "start_lesson", { questionId: "a" });
  assert.equal(applyLearningAction(state, bankFixture, day2, "submit_lesson", { questionId: "a", answerIndex: 0 }).award?.id, "learning:mastery:lesson:a");
  applyLearningAction(state, bankFixture, day2, "start_lesson", { questionId: "a" });
  assert.equal(applyLearningAction(state, bankFixture, day2, "submit_lesson", { questionId: "a", answerIndex: 0 }).award, undefined);
  view = learningView(state, bankFixture, day2);
  assert.equal(view.revisit.length, 0);
  assert.equal(view.progress.mastered, 1);
  assert.equal(view.paths.find(p => p.id === "context")?.lessons.find(l => l.id === "a")?.status, "mastered");

  assert.throws(() => applyLearningAction(state, bankFixture, day1, "submit_lesson", { questionId: "a", answerIndex: 0 }), { code: "clock_rollback" });
});

test("practice mistakes recover the same way", () => {
  const state = newLearningState();
  applyLearningAction(state, bankFixture, day1, "start_challenge", { challengeId: "practice-prompt-rewrite" });
  assert.equal(applyLearningAction(state, bankFixture, day1, "submit_challenge", { challengeId: "practice-prompt-rewrite", answerIndex: 0 }).award?.xp, 15);
  assert.equal(learningView(state, bankFixture, day1).revisit[0]?.kind, "practice");
  applyLearningAction(state, bankFixture, day2, "start_challenge", { challengeId: "practice-prompt-rewrite" });
  assert.equal(applyLearningAction(state, bankFixture, day2, "submit_challenge", { challengeId: "practice-prompt-rewrite", answerIndex: 2 }).award?.id, "learning:mastery:practice:practice-prompt-rewrite");
});

test("real-work challenges require the full explicit checklist and are labelled self-reported", () => {
  const state = newLearningState();
  const id = "real-handoff";
  applyLearningAction(state, bankFixture, day1, "start_challenge", { challengeId: id });
  const active = learningView(state, bankFixture, day1).activeChallenge;
  assert.ok(active?.kind === "real" && active.launchPrompt.length > 40 && !active.completed && active.feedback === undefined);
  assert.match(active.evidence, /Self-reported/);
  const all = active.checklist.map(item => item.id);
  for (const checks of [undefined, "goal", [], all.slice(1), [...all, "extra"], [...all.slice(1), all[1]], [1, 2]]) {
    assert.throws(() => applyLearningAction(state, bankFixture, day1, "submit_challenge", { challengeId: id, checks }), { code: "checklist" });
  }
  assert.throws(() => applyLearningAction(state, bankFixture, day1, "submit_challenge", { challengeId: id, checks: all, answerIndex: 0 }), { code: "learning_input" });
  const result = applyLearningAction(state, bankFixture, day1, "submit_challenge", { challengeId: id, checks: [...all].reverse() });
  assert.deepEqual(result.award, { id: "learning:real:real-handoff", xp: 40, evidence: active.evidence });
  assert.match(result.message, /did not verify/);
  assert.equal(applyLearningAction(state, bankFixture, day2, "submit_challenge", { challengeId: id, checks: all }).award, undefined);
  const done = learningView(state, bankFixture, day1).activeChallenge;
  assert.ok(done?.kind === "real" && done.completed && done.feedback);
});

test("experience selection validates and reorders suggestions", () => {
  const state = newLearningState();
  assert.throws(() => applyLearningAction(state, bankFixture, day1, "set_experience", { experience: "expert" }), { code: "learning_input" });
  assert.equal(learningView(state, bankFixture, day1).experience, null);
  applyLearningAction(state, bankFixture, day1, "set_experience", { experience: "experienced" });
  let view = learningView(state, bankFixture, day1);
  assert.equal(view.experience, "experienced");
  assert.equal(CHALLENGES.find(c => c.id === view.recommended.challengeId)?.difficulty, "experienced");
  assert.ok(view.challenges.filter(c => c.suggested).every(c => c.difficulty === "experienced"));
  assert.equal(view.recommended.lessonId, "c");
  applyLearningAction(state, bankFixture, day1, "set_experience", { experience: "beginner" });
  view = learningView(state, bankFixture, day1);
  assert.equal(CHALLENGES.find(c => c.id === view.recommended.challengeId)?.difficulty, "beginner");
  assert.equal(view.recommended.lessonId, "a");
});

test("authored content covers every path and earns a title only with real work", () => {
  const practice = CHALLENGES.filter(c => c.kind === "practice");
  const real = CHALLENGES.filter(c => c.kind === "real");
  assert.ok(practice.length >= 6 && real.length >= 4);
  for (const c of practice) assert.ok(c.answerIndex >= 0 && c.answerIndex < c.options.length && c.explanation.length > 60 && c.hint);
  assert.equal(new Set(CHALLENGES.map(c => c.id)).size, CHALLENGES.length);

  const state = newLearningState();
  for (const id of ["practice-relevant-context", "practice-handoff"]) {
    applyLearningAction(state, bankFixture, day1, "start_challenge", { challengeId: id });
    applyLearningAction(state, bankFixture, day1, "submit_challenge", { challengeId: id, answerIndex: 2 });
  }
  applyLearningAction(state, bankFixture, day1, "start_lesson", { questionId: "a" });
  applyLearningAction(state, bankFixture, day1, "submit_lesson", { questionId: "a", answerIndex: 0 });
  assert.equal(learningView(state, bankFixture, day1).unlocks.find(u => u.id === "context-keeper")?.earned, false);
  const handoff = CHALLENGES.find(c => c.id === "real-handoff");
  assert.ok(handoff?.kind === "real");
  applyLearningAction(state, bankFixture, day1, "start_challenge", { challengeId: handoff.id });
  applyLearningAction(state, bankFixture, day1, "submit_challenge", { challengeId: handoff.id, checks: handoff.checklist.map(i => i.id) });
  const view = learningView(state, bankFixture, day1);
  assert.equal(view.unlocks.find(u => u.id === "context-keeper")?.earned, true);
  assert.equal(view.paths.find(p => p.id === "context")?.skillName, "Growing");
});

test("real knowledge bank maps every category to a path", () => {
  const bank = validateQuestions(JSON.parse(readFileSync(new URL("../content/questions.json", import.meta.url), "utf8")));
  const view = learningView(newLearningState(), bank, day1);
  assert.equal(view.paths.length, 4);
  assert.ok(view.progress.lessonsAvailable > 0);
});
