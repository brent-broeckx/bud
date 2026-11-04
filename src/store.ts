import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { BudError, type ProfileState } from "./core/types.js";
import { validateLearningStorage } from "./core/learning-storage.js";

export class ProfileStore {
  private readonly db: DatabaseSync;
  constructor(directory: string, initial: () => ProfileState) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = join(directory, "profile.sqlite");
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
    this.db.exec("CREATE TABLE IF NOT EXISTS profile (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)");
    this.db.prepare("INSERT OR IGNORE INTO profile(id,body) VALUES(1,?)").run(JSON.stringify(initial()));
    if (process.platform !== "win32") chmodSync(file, 0o600);
  }

  transaction<T>(operation: (state: ProfileState) => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare("SELECT body FROM profile WHERE id=1").get();
      if (!row || typeof row.body !== "string") throw new BudError("storage", "Bud's profile could not be read.");
      const parsed: unknown = JSON.parse(row.body);
      if (!parsed || typeof parsed !== "object" || !("version" in parsed) || parsed.version !== 1) {
        throw new BudError("storage_version", "This profile needs a compatible version of Bud. It has not been overwritten.");
      }
      if ("learning" in parsed && parsed.learning !== undefined) validateLearningStorage(parsed.learning);
      const result = operation(parsed as ProfileState);
      this.db.prepare("UPDATE profile SET body=? WHERE id=1").run(JSON.stringify(parsed));
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try { this.db.exec("ROLLBACK"); }
      catch (rollback) { console.error("Bud transaction rollback also failed:", rollback instanceof Error ? rollback.message : "unknown failure"); }
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }
}
