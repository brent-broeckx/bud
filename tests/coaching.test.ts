import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BudService } from "../src/service.js";
import { bankFixture } from "./fixtures.js";
import { reviewPrompts, summarizeUsage } from "../src/core/coaching.js";

test("local coaching is an honest checklist, not a score", () => {
  const review = reviewPrompts(["Fix src\\app.ts without changing the API. Verify the result with a test."], "prompt");
  assert.ok(review.feedback.every(item => item.observed));
  assert.match(review.basis, /not an AI quality grade/);
  assert.throws(() => reviewPrompts([" "], "prompt"), /No readable/);
});

test("context coaching uses the stated 70% cue without calling samples peaks or compaction thresholds", () => {
  const usage = {
    sessionId: "test", syncedAt: null, calls: [], diagnostics: [],
    contexts: [{ id: "c", sessionId: "test", at: "2026-11-04T10:00Z", current: 699, limit: 1000, basis: "session.usage_info" as const }]
  };
  assert.equal(summarizeUsage(usage).tips[1]?.title, "Choose context intentionally");
  usage.contexts[0]!.current = 700;
  const summary = summarizeUsage(usage);
  assert.equal(summary.tips[1]?.title, "Practise a session handoff");
  assert.match(summary.tips[1]!.explanation, /not a compaction threshold/);
  assert.equal(summary.questions.length, 1);
});

test("history deduplicates sessions, retains coverage, and text review has independent consent and no persistence", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bud-coaching-"));
  const service = new BudService({ directory, copilotHome: directory, sessionId: "one", questions: bankFixture });
  try {
    for (const [id, input] of [["one", 25], ["two", 75]] as const) {
      mkdirSync(join(directory, "session-state", id), { recursive: true });
      writeFileSync(join(directory, "session-state", id, "events.jsonl"), [
        { id: "counter", timestamp: "2026-11-04T10:00Z", type: "assistant.usage", data: { inputTokens: input, outputTokens: 0 } },
        { id: "prompt", timestamp: "2026-11-04T10:01Z", type: "user.message", data: { content: "PRIVATE_SENTINEL Fix this file" } }
      ].map(item => JSON.stringify(item)).join("\n") + "\n");
    }
    await assert.rejects(service.dispatch("sync_history"), /consent/);
    await service.dispatch("sync_usage", { consent: true });
    await assert.rejects(service.dispatch("review_session"), /separate explicit consent/);
    const history = await service.dispatch("sync_history", { consent: true });
    assert.equal(history.history.totals.input.value, 100);
    assert.equal(history.history.totals.output.value, 0);
    assert.equal(history.history.totals.cacheRead.value, null);
    assert.equal(history.history.sessions.length, 2);
    await service.dispatch("sync_history", { consent: true });
    const again = await service.dispatch("sync_usage", { consent: true });
    assert.equal(again.history.totals.input.value, 100);
    const second = new BudService({ directory, copilotHome: directory, sessionId: "two", questions: bankFixture });
    try {
      await second.dispatch("sync_usage", { consent: true });
      assert.equal((await service.dispatch("get_profile")).usage.input.value, 25);
      assert.equal((await second.dispatch("get_profile")).usage.input.value, 75);
    } finally { second.close(); }
    const reviewed = await service.dispatch("review_session", { consent: true });
    assert.equal(reviewed.review?.reviewedPrompts, 1);
    assert.ok(!JSON.stringify(reviewed).includes("PRIVATE_SENTINEL"));
    await assert.rejects(service.dispatch("review_prompt", { consent: true, text: "x".repeat(6001) }), /6000/);
    assert.equal((await service.dispatch("clear_review")).review, null);
    const cleared = await service.dispatch("clear_history");
    assert.equal(cleared.history.sessions.length, 0);
    assert.equal(cleared.usage.input.value, null);
    assert.equal(cleared.profile.xp, 0);
  } finally { service.close(); }
  try {
    assert.ok(!readFileSync(join(directory, "profile.sqlite")).includes(Buffer.from("PRIVATE_SENTINEL")));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("older history remains importable beyond the first 100 directories without duplicate totals", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bud-history-batches-"));
  const service = new BudService({ directory, copilotHome: directory, questions: bankFixture });
  try {
    for (let index = 0; index < 101; index++) {
      const path = join(directory, "session-state", `session-${index}`);
      mkdirSync(path, { recursive: true });
      writeFileSync(join(path, "events.jsonl"), JSON.stringify({ id: "counter", timestamp: "2026-11-04T10:00Z", type: "assistant.usage", data: { inputTokens: 1 } }) + "\n");
    }
    await assert.rejects(service.dispatch("sync_history", { consent: true, offset: -1 }), /non-negative/);
    const first = await service.dispatch("sync_history", { consent: true });
    assert.equal(first.history.sessions.length, 100);
    assert.equal(first.history.nextOffset, 100);
    const rest = await service.dispatch("sync_history", { consent: true, offset: first.history.nextOffset });
    assert.equal(rest.history.sessions.length, 101);
    assert.equal(rest.history.totals.input.value, 101);
    assert.equal(rest.history.nextOffset, null);
    assert.equal((await service.dispatch("sync_history", { consent: true, offset: 100 })).history.totals.input.value, 101);
  } finally { service.close(); rmSync(directory, { recursive: true, force: true }); }
});
