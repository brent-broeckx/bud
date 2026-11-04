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
  const directory = join(home, "bud-data");
  const legacy = join(home, "extensions", "bud", "artifacts");
  return { home, directory, legacy, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

test("new profiles live outside extension installation and survive replacing the installation", () => {
  const { home, directory, cleanup } = setup();
  try {
    assert.equal(resolveDataDirectory(home), directory);
    const store = new ProfileStore(resolveDataDirectory(home), newFixture);
    try { store.transaction(state => { state.awards.push({ id: "test", at: state.createdAt, evidence: "synthetic", xp: 10 }); }); }
    finally { store.close(); }
    const installation = join(home, "extensions", "bud");
    mkdirSync(installation, { recursive: true });
    writeFileSync(join(installation, "extension.mjs"), "// synthetic installation");
    rmSync(installation, { recursive: true });
    mkdirSync(installation);
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

test("moving a stopped legacy profile preserves progress in the new default", () => {
  const { home, directory, legacy, cleanup } = setup();
  try {
    const store = new ProfileStore(legacy, newFixture);
    try { store.transaction(state => { state.awards.push({ id: "test", at: state.createdAt, evidence: "synthetic", xp: 10 }); }); }
    finally { store.close(); }
    assert.throws(() => resolveDataDirectory(home), /existing profile/);
    renameSync(legacy, directory);
    const migrated = new ProfileStore(resolveDataDirectory(home), newFixture);
    try { assert.equal(migrated.transaction(state => state.awards[0]?.xp), 10); }
    finally { migrated.close(); }
  } finally { cleanup(); }
});

test("an existing new profile takes precedence over leftover legacy data", () => {
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

test("an empty legacy artifacts directory does not block a fresh profile", () => {
  const { home, directory, legacy, cleanup } = setup();
  try {
    mkdirSync(legacy, { recursive: true });
    assert.equal(resolveDataDirectory(home), directory);
  } finally { cleanup(); }
});
