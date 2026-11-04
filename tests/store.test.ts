import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProfileStore } from "../src/store.js";
import { newFixture } from "./fixtures.js";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

test("transactions persist across connections and rollback partial mutations", () => {
  const dir = mkdtempSync(join(tmpdir(), "bud-store-"));
  const a = new ProfileStore(dir, newFixture), b = new ProfileStore(dir, newFixture);
  try {
    a.transaction(state => { state.awards.push({ id: "test", at: state.createdAt, evidence: "synthetic", xp: 10 }); });
    assert.equal(b.transaction(state => state.awards.length), 1);
    assert.throws(() => b.transaction(state => { state.awards.length = 0; throw new Error("cancel"); }), /cancel/);
    assert.equal(a.transaction(state => state.awards.length), 1);
  } finally { a.close(); b.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("independent processes serialize repeated awards without duplicates or lost updates", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bud-concurrent-"));
  try {
    await Promise.all(Array.from({ length: 4 }, () => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./concurrency-worker.ts", import.meta.url)), dir], { stdio: ["ignore", "ignore", "pipe"] });
      let error = "";
      child.stderr.on("data", chunk => { error += String(chunk); });
      child.once("error", reject);
      child.once("exit", code => code === 0 ? resolve() : reject(new Error(error || `Worker exited ${code}`)));
    })));
    const store = new ProfileStore(dir, newFixture);
    try { assert.equal(store.transaction(state => state.awards.length), 10); }
    finally { store.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
