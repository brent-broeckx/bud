import { ProfileStore } from "../src/store.js";
import { awardOnce } from "../src/core/profile.js";
import { newFixture } from "./fixtures.js";

const directory = process.argv[2];
if (!directory) throw new Error("Missing test directory.");
const store = new ProfileStore(directory, newFixture);
try {
  for (let i = 0; i < 10; i++) {
    store.transaction(state => { awardOnce(state, { id: `concurrent:${i}`, xp: 1, at: "2026-11-04T12:00Z", evidence: "synthetic multi-process test" }); });
  }
} finally { store.close(); }
