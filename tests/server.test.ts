import { test } from "node:test";
import assert from "node:assert/strict";
import { serveCanvas } from "../src/server.js";
import type { AppView } from "../src/core/view.js";

test("canvas server requires secret path, same origin, JSON and custom header", async () => {
  let calls = 0;
  const host = await serveCanvas({ dispatch: async () => { calls++; return {} as AppView; } }, { html: "<h1>Bud</h1>", js: "", css: "" });
  try {
    const origin = new URL(host.url).origin;
    assert.equal((await fetch(host.url)).status, 200);
    assert.equal((await fetch(origin)).status, 404);
    const headers = { "Content-Type": "application/json", "X-Bud-Request": "1", Origin: origin };
    assert.equal((await fetch(host.url + "api", { method: "POST", headers: { ...headers, Origin: "https://evil.example" }, body: '{"action":"x"}' })).status, 403);
    assert.equal((await fetch(host.url + "api", { method: "POST", headers, body: "{" })).status, 400);
    assert.equal(calls, 0);
    assert.equal((await fetch(host.url + "api", { method: "POST", headers, body: '{"action":"x"}' })).status, 200);
    assert.equal(calls, 1);
    assert.equal((await fetch(host.url + "api", { method: "GET", headers })).status, 404);
  } finally { await host.close(); }
});
