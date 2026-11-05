import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { resolveDataDirectory } from "../src/data-directory.js";
import { ProfileStore } from "../src/store.js";
import { newFixture } from "./fixtures.js";

function setup() {
  const home = mkdtempSync(join(tmpdir(), "bud-data-directory-"));
  const directory = join(home, "extensions", "bud", "artifacts");
  const legacy = join(home, "bud-data");
  return { home, directory, legacy, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

test("new profiles live inside the Bud folder and reopen without losing progress", () => {
  const { home, directory, cleanup } = setup();
  try {
    const installation = join(home, "extensions", "bud");
    mkdirSync(installation, { recursive: true });
    writeFileSync(join(installation, "extension.mjs"), "// synthetic installation");
    assert.equal(resolveDataDirectory(home), directory);
    const store = new ProfileStore(resolveDataDirectory(home), newFixture);
    try { store.transaction(state => { state.awards.push({ id: "test", at: state.createdAt, evidence: "synthetic", xp: 10 }); }); }
    finally { store.close(); }
    assert.equal(existsSync(join(directory, "profile.sqlite")), true);
    assert.equal(existsSync(join(home, "bud-data")), false);
    writeFileSync(join(installation, "extension.mjs"), "// updated synthetic installation");
    const reopened = new ProfileStore(resolveDataDirectory(home), newFixture);
    try { assert.equal(reopened.transaction(state => state.awards[0]?.xp), 10); }
    finally { reopened.close(); }
  } finally { cleanup(); }
});

test("legacy profiles block a silent reset without modifying the database or sidecars", () => {
  const { home, directory, legacy, cleanup } = setup();
  try {
    mkdirSync(legacy, { recursive: true });
    for (const suffix of ["", "-wal", "-shm"]) writeFileSync(join(legacy, `profile.sqlite${suffix}`), `synthetic${suffix}`);
    assert.throws(() => resolveDataDirectory(home), error => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes(legacy));
      assert.ok(error.message.includes(directory));
      assert.match(error.message, /Close all Bud canvases.*WAL\/SHM/);
      return true;
    });
    assert.equal(existsSync(directory), false);
    for (const suffix of ["", "-wal", "-shm"]) {
      assert.equal(readFileSync(join(legacy, `profile.sqlite${suffix}`), "utf8"), `synthetic${suffix}`);
    }
  } finally { cleanup(); }
});

test("moving a stopped bud-data profile into Bud preserves progress", () => {
  const { home, directory, legacy, cleanup } = setup();
  try {
    const store = new ProfileStore(legacy, newFixture);
    try { store.transaction(state => { state.awards.push({ id: "test", at: state.createdAt, evidence: "synthetic", xp: 10 }); }); }
    finally { store.close(); }
    assert.throws(() => resolveDataDirectory(home), /existing profile/);
    mkdirSync(join(home, "extensions", "bud"), { recursive: true });
    renameSync(legacy, directory);
    const migrated = new ProfileStore(resolveDataDirectory(home), newFixture);
    try { assert.equal(migrated.transaction(state => state.awards[0]?.xp), 10); }
    finally { migrated.close(); }
  } finally { cleanup(); }
});

test("an existing Bud profile takes precedence over leftover bud-data", () => {
  const { home, directory, legacy, cleanup } = setup();
  try {
    for (const path of [directory, legacy]) {
      mkdirSync(path, { recursive: true });
      writeFileSync(join(path, "profile.sqlite"), "synthetic");
    }
    assert.equal(resolveDataDirectory(home), directory);
  } finally { cleanup(); }
});

test("explicit data overrides keep their exact meaning even when legacy data exists", () => {
  const { home, directory, legacy, cleanup } = setup();
  try {
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "profile.sqlite"), "synthetic");
    assert.equal(resolveDataDirectory(home, legacy), legacy);
    assert.equal(resolveDataDirectory(home, relative(process.cwd(), directory)), resolve(directory));
  } finally { cleanup(); }
});

test("an empty bud-data directory does not block a fresh profile", () => {
  const { home, directory, legacy, cleanup } = setup();
  try {
    mkdirSync(legacy, { recursive: true });
    assert.equal(resolveDataDirectory(home), directory);
  } finally { cleanup(); }
});
