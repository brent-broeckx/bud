import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BudService } from "../src/service.js";
import { bankFixture } from "./fixtures.js";
import { validateLearningStorage } from "../src/core/learning-storage.js";
import { newLearningState } from "../src/core/learning.js";

test("daily completion never gates Explore, practice XP persists, and path titles require real work", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bud-learning-integration-"));
  const options = { directory, copilotHome: directory, questions: bankFixture, clock: () => new Date("2026-11-04T12:00Z"), timezone: "UTC" };
  const service = new BudService(options);
  try {
    const initial = await service.dispatch("get_profile");
    assert.ok(initial.daily);
    await service.dispatch("submit_answer", { questionId: initial.daily.id, day: initial.daily.day, answerIndex: initial.daily.type === "quiz" ? 0 : null });
    const afterDaily = (await service.dispatch("get_profile")).profile.xp;
    await service.dispatch("start_lesson", { questionId: "a" });
    await service.dispatch("submit_lesson", { questionId: "a", answerIndex: 0 });
    await service.dispatch("start_challenge", { challengeId: "practice-handoff" });
    await service.dispatch("submit_challenge", { challengeId: "practice-handoff", answerIndex: 0 });
    await assert.rejects(service.dispatch("equip_item", { itemId: "context-keeper" }), /learning path/);
    const opened = await service.dispatch("start_challenge", { challengeId: "real-handoff" });
    const challenge = opened.learning.activeChallenge;
    assert.ok(challenge?.kind === "real");
    const checks = challenge.checklist.map(item => item.id);
    const completed = await service.dispatch("submit_challenge", { challengeId: challenge.id, checks });
    assert.equal(completed.profile.xp, afterDaily + 10 + 15 + 40);
    assert.equal(completed.cosmetics.find(item => item.id === "context-keeper")?.unlocked, true);
    await service.dispatch("equip_item", { itemId: "context-keeper" });
    assert.equal((await service.dispatch("submit_challenge", { challengeId: challenge.id, checks })).profile.xp, completed.profile.xp);
    const second = new BudService(options);
    try {
      const restored = await second.dispatch("get_learning");
      assert.equal(restored.profile.equipped.title, "context-keeper");
      assert.equal(restored.learning.progress.realCompleted, 1);
      assert.equal(restored.profile.xp, completed.profile.xp);
    } finally { second.close(); }
    await assert.rejects(service.dispatch("start_lesson", { questionId: "a", xp: 1000 }), /unsupported/);
  } finally { service.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("session bridge requires explicit consent, sends only approved challenge text and awards no XP", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bud-session-bridge-"));
  const service = new BudService({ directory, copilotHome: directory, questions: bankFixture });
  const sent: string[] = [];
  try {
    await service.dispatch("start_challenge", { challengeId: "real-handoff" });
    await assert.rejects(service.dispatch("send_challenge", { challengeId: "real-handoff", prompt: "Help with a handoff" }), /consent/);
    await assert.rejects(service.dispatch("send_challenge", { challengeId: "real-handoff", prompt: "Help with a handoff", consent: true }), /no connected session/);
    service.setSessionSender(async prompt => { sent.push(prompt); return "message-123"; });
    await assert.rejects(service.dispatch("send_challenge", { challengeId: "real-handoff", prompt: "<describe task>", consent: true }), /placeholder/);
    const delivered = await service.dispatch("send_challenge", { challengeId: "real-handoff", prompt: "Help create a handoff of the current task.", consent: true });
    assert.equal(sent.length, 1);
    assert.match(sent[0]!, /Do not edit files/);
    assert.match(sent[0]!, /Help create a handoff/);
    assert.equal(delivered.profile.xp, 0);
    assert.equal(delivered.learning.progress.realCompleted, 0);
    assert.equal(delivered.sessionInteraction.lastMessageId, "message-123");
    service.setSessionSender(async () => { throw new Error("transport unavailable"); });
    await assert.rejects(service.dispatch("send_challenge", { challengeId: "real-handoff", prompt: "Help with a handoff", consent: true }), /did not confirm delivery/);
  } finally { service.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("learning storage rejects incompatible or corrupt progress without silently resetting it", () => {
  assert.doesNotThrow(() => validateLearningStorage(newLearningState()));
  for (const value of [null, [], { ...newLearningState(), version: 2 }, { ...newLearningState(), experience: "expert" }, { ...newLearningState(), items: { bad: {} } }, { ...newLearningState(), history: [{ key: "x", day: "2026-02-31" }] }]) {
    assert.throws(() => validateLearningStorage(value), /has not been overwritten/);
  }
});

test("Explore and Practice keep the learning streak and seven-day milestone without claiming a daily discovery", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bud-learning-days-"));
  let now = new Date("2026-11-04T12:00Z");
  const service = new BudService({ directory, copilotHome: directory, questions: bankFixture, clock: () => now, timezone: "UTC" });
  try {
    for (let day = 4; day <= 10; day++) {
      now = new Date(`2026-11-${String(day).padStart(2, "0")}T12:00Z`);
      await service.dispatch("start_lesson", { questionId: "a" });
      await service.dispatch("submit_lesson", { questionId: "a", answerIndex: 0 });
    }
    const result = await service.dispatch("get_profile");
    assert.equal(result.profile.streak, 7);
    assert.equal(result.profile.xp, 60);
    assert.equal(result.daily?.answered, false);
    assert.equal(result.achievements.find(item => item.id === "steady-learner")?.unlocked, true);
  } finally { service.close(); rmSync(directory, { recursive: true, force: true }); }
});
