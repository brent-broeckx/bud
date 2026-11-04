import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BudService } from "../src/service.js";
import { bankFixture } from "./fixtures.js";

test("UI/agent commands share durable state and parallel answers cannot double-award", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bud-service-"));
  let now = new Date("2026-11-04T12:00Z");
  const options = { directory, copilotHome: directory, questions: [bankFixture[0]], clock: () => now, timezone: "UTC" };
  const user = new BudService(options), agent = new BudService(options);
  try {
    const initial = await user.dispatch("get_profile");
    assert.ok(initial.daily);
    const input = { questionId: initial.daily.id, day: initial.daily.day, answerIndex: 1 };
    const results = await Promise.all([user.dispatch("submit_answer", input), agent.dispatch("submit_answer", input)]);
    assert.ok(results.every(v => v.profile.xp === 30));
    assert.equal((await agent.dispatch("get_profile")).daily?.correct, false);
    await assert.rejects(user.dispatch("equip_item", { itemId: "beanie" }), /unlocks/);
    await user.dispatch("equip_item", { itemId: "mint" });
    assert.equal((await agent.dispatch("get_profile")).profile.equipped.color, "mint");
    now = new Date("2026-11-05T12:00Z");
    const next = await agent.dispatch("get_profile");
    assert.ok(next.daily);
    const levelTwo = await user.dispatch("submit_answer", { questionId: next.daily.id, day: next.daily.day, answerIndex: 0 });
    assert.equal(levelTwo.profile.xp, 50);
    assert.equal(levelTwo.profile.level, 2);
    await agent.dispatch("equip_item", { itemId: "beanie" });
    assert.equal((await user.dispatch("get_profile")).profile.equipped.head, "beanie");
    now = new Date("2026-11-04T12:00Z");
    await assert.rejects(user.dispatch("submit_answer", input), /backwards/);
  } finally { user.close(); agent.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("untrusted actions cannot set XP or backfill answers; reflections are bounded by day and do not award immediately", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bud-commands-"));
  const service = new BudService({ directory, copilotHome: directory, questions: bankFixture, clock: () => new Date("2026-11-04T12:00Z"), timezone: "UTC" });
  try {
    await assert.rejects(service.dispatch("get_profile", { xp: 1000 }), /unsupported/);
    await assert.rejects(service.dispatch("set_xp", { xp: 1000 }), /not supported/);
    await assert.rejects(service.dispatch("record_reflection", { kind: "invented" }), /supported/);
    for (let i = 0; i < 10; i++) await service.dispatch("record_reflection", { kind: "fresh-session" });
    const result = await service.dispatch("get_profile");
    assert.equal(result.profile.reflections.length, 1);
    assert.equal(result.profile.xp, 0);
    await assert.rejects(service.dispatch("sync_usage", { consent: true }), /current Copilot session/);
  } finally { service.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("usage sync is consent-gated, idempotent and specific to the current session", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bud-sync-"));
  const options = { directory, copilotHome: directory, questions: bankFixture, clock: () => new Date("2026-11-04T12:00Z"), timezone: "UTC" };
  const service = new BudService({ ...options, sessionId: "one" });
  const other = new BudService({ ...options, sessionId: "two" });
  try {
    mkdirSync(join(directory, "session-state", "one"), { recursive: true });
    writeFileSync(join(directory, "session-state", "one", "events.jsonl"), JSON.stringify({ id: "u", timestamp: "2026-11-04T10:00Z", type: "assistant.usage", data: { inputTokens: 25, outputTokens: 0, content: "PRIVATE" } }) + "\n");
    await assert.rejects(service.dispatch("sync_usage", {}), /consent/);
    const result = await service.dispatch("sync_usage", { consent: true });
    assert.deepEqual(result.usage.input, { value: 25, covered: 1 });
    assert.deepEqual(result.usage.cacheRead, { value: null, covered: 0 });
    assert.equal(result.profile.xp, 0);
    assert.ok(!JSON.stringify(result).includes("PRIVATE"));
    const again = await service.dispatch("sync_usage", { consent: true });
    assert.equal(again.usage.input.value, 25);
    assert.equal((await other.dispatch("get_profile")).usage.input.value, null);
  } finally { service.close(); other.close(); rmSync(directory, { recursive: true, force: true }); }
});
