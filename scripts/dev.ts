import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { BudService } from "../src/service.js";
import { serveCanvas } from "../src/server.js";
import { buildAssets } from "./ui-assets.js";
import { validateQuestions } from "../src/core/questions.js";

const directory = resolve(process.env.BUD_DEV_DIR ?? ".bud-dev");
const home = join(directory, "synthetic-copilot");
const sessionId = "dev-session";
const log = join(home, "session-state", sessionId);
await mkdir(log, { recursive: true });
const at = new Date().toISOString();
await writeFile(join(log, "events.jsonl"), [
  { id: "synthetic-1", timestamp: at, type: "assistant.usage", data: { inputTokens: 1200, outputTokens: 180, cacheReadTokens: 700, cacheWriteTokens: 0, cacheDetailsReported: true } },
  { id: "synthetic-2", timestamp: at, type: "session.usage_info", data: { currentTokens: 2400, tokenLimit: 16000 } }
].map(item => JSON.stringify(item)).join("\n") + "\n");
const questions = validateQuestions(JSON.parse(await readFile("content/questions.json", "utf8")));
const service = new BudService({
  directory: join(directory, "profile"), copilotHome: home, sessionId,
  questions: process.env.BUD_EVIDENCE === "1" ? questions.filter(q => q.type === "quiz") : questions, development: true
});
const canvas = await serveCanvas(service, await buildAssets());
console.log(`BUD_URL=${canvas.url}`);
console.log("Canvas development harness. Synthetic usage only. Stop with Ctrl+C.");
let stopped = false;
async function stop() {
  if (stopped) return;
  stopped = true;
  await canvas.close();
  service.close();
}
process.on("SIGINT", () => { void stop(); });
process.on("SIGTERM", () => { void stop(); });
