import { lstat, readdir, open, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { BudError, type UsageState } from "../core/types.js";
import { readCopilotUsage } from "./copilot.js";

export async function readUsageHistory(home: string, now: Date, offset = 0): Promise<{ sessions: UsageState[]; diagnostics: string[]; nextOffset: number | null; totalDirectories: number }> {
  const directory = join(home, "session-state");
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") throw new BudError("history_unavailable", "No local Copilot session history exists yet.");
    throw error;
  }
  const candidates = entries.filter(entry => entry.isDirectory() && /^[a-zA-Z0-9_-]{1,128}$/.test(entry.name));
  const dated = await Promise.all(candidates.map(async entry => ({ id: entry.name, at: (await lstat(join(directory, entry.name))).mtimeMs })));
  const selected = dated.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id)).slice(offset, offset + 100);
  const sessions: UsageState[] = [], diagnostics: string[] = [];
  let bytes = 0;
  for (const entry of selected) {
    try {
      const size = (await stat(join(directory, entry.id, "events.jsonl"))).size;
      if (bytes + size > 128 * 1024 * 1024) {
        diagnostics.push(`${entry.id}: skipped because the 128 MB total history-read budget would be exceeded.`);
        continue;
      }
      bytes += size;
      sessions.push(await readCopilotUsage(home, entry.id, now));
    }
    catch (error) {
      if (error instanceof BudError) diagnostics.push(`${entry.id}: ${error.message}`);
      else if (error instanceof Error && "code" in error && error.code === "ENOENT") diagnostics.push(`${entry.id}: no readable event log exists.`);
      else throw error;
    }
  }
  const nextOffset = offset + selected.length < candidates.length ? offset + selected.length : null;
  diagnostics.unshift(`This batch read ${sessions.length} of ${selected.length} selected directories (${candidates.length} local directories found). Batches contain up to 100 directories, newest first; each log is limited to 64 MB and each batch to 128 MB. Import further batches to include older sessions. Changing local directory contents can shift batch boundaries. This is imported coverage, not lifetime usage.`);
  return { sessions, diagnostics, nextOffset, totalDirectories: candidates.length };
}

export async function readSessionPrompts(home: string, sessionId: string): Promise<string[]> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(sessionId)) throw new BudError("session_id", "The host did not provide a valid session ID.");
  let root: string, path: string;
  try {
    root = await realpath(join(home, "session-state"));
    path = await realpath(join(root, sessionId, "events.jsonl"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") throw new BudError("review_unavailable", "This session has no local event log yet. Paste a selected prompt instead.");
    throw error;
  }
  const local = relative(root, path);
  if (isAbsolute(local) || local === ".." || local.startsWith(`..${sep}`)) throw new BudError("review_path", "The selected log is outside local session storage.");
  const file = await open(path, "r");
  let content: string;
  try {
    const size = (await file.stat()).size;
    if (size > 8 * 1024 * 1024) throw new BudError("review_size", "Session review is limited to 8 MB. Paste a selected prompt instead.");
    const buffer = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const read = await file.read(buffer, offset, size - offset, offset);
      if (!read.bytesRead) throw new BudError("review_changed", "The session log changed during review. Retry or paste a selected prompt.");
      offset += read.bytesRead;
    }
    content = buffer.toString("utf8");
  } finally { await file.close(); }
  const lines = content.split("\n");
  const prompts: string[] = [];
  for (const line of lines.slice(0, -1)) {
    if (!line.trim()) continue;
    let event: unknown;
    try { event = JSON.parse(line); }
    catch { throw new BudError("review_format", "This log has malformed records. Paste a selected prompt instead."); }
    if (!event || typeof event !== "object" || !("type" in event) || event.type !== "user.message" || !("data" in event)) continue;
    const data = event.data;
    if (data && typeof data === "object" && "content" in data && typeof data.content === "string" && data.content.trim()) prompts.push(data.content);
  }
  if (!prompts.length) throw new BudError("review_unavailable", "No supported user.message text records were found. Paste a selected prompt instead.");
  return prompts;
}
