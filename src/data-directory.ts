import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export function resolveDataDirectory(copilotHome: string, override?: string): string {
  if (override !== undefined) return resolve(override);

  const directory = resolve(copilotHome, "bud-data");
  const legacy = resolve(copilotHome, "extensions", "bud", "artifacts");
  if (!existsSync(join(directory, "profile.sqlite")) && existsSync(join(legacy, "profile.sqlite"))) {
    throw new Error(
      `Bud found an existing profile in "${legacy}". Close all Bud canvases and stop Bud processes, ` +
      `then move that directory (including profile.sqlite and any WAL/SHM files) to "${directory}". ` +
      "Bud has not moved or overwritten your data. BUD_DATA_DIR can explicitly select a different data directory."
    );
  }
  return directory;
}
