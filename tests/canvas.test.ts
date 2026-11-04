import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBudCanvas } from "../src/canvas.js";
import { BudService } from "../src/service.js";
import { bankFixture } from "./fixtures.js";

test("the pinned SDK accepts Bud's real declaration, actions and open/focus/close lifecycle", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bud-canvas-"));
  const service = new BudService({ directory, copilotHome: directory, questions: bankFixture, clock: () => new Date("2026-11-04T12:00Z"), timezone: "UTC" });
  const bud = createBudCanvas(service, { html: "<h1>Bud</h1>", js: "", css: "" });
  try {
    assert.equal(bud.canvas.declaration.id, "bud");
    const names = bud.canvas.declaration.actions?.map(a => a.name);
    for (const name of ["get_profile", "get_daily_question", "submit_answer", "list_achievements", "equip_item", "record_reflection", "sync_usage"]) assert.ok(names?.includes(name));
    const context = { sessionId: "s", extensionId: "bud", canvasId: "bud", instanceId: "one" };
    const [opened, focused] = await Promise.all([bud.canvas.open(context), bud.canvas.open(context)]);
    assert.equal(opened.url, focused.url);
    assert.ok(opened.url);
    assert.equal((await fetch(opened.url)).status, 200);
    await bud.canvas.onClose?.(context);
    await assert.rejects(fetch(opened.url));
    const reopened = await bud.canvas.open(context);
    assert.notEqual(reopened.url, opened.url);
  } finally { await bud.close(); service.close(); rmSync(directory, { recursive: true, force: true }); }
});
