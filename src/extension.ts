import { joinSession } from "@github/copilot-sdk/extension";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import assets from "bud:assets";
import questions from "../content/questions.json" with { type: "json" };
import { BudService } from "./service.js";
import { createBudCanvas } from "./canvas.js";

const sessionId = process.env.SESSION_ID;
if (!sessionId) throw new Error("Bud must be started by the GitHub Copilot canvas extension host (SESSION_ID is missing).");
const home = resolve(process.env.COPILOT_HOME ?? join(homedir(), ".copilot"));
const service = new BudService({
  directory: resolve(process.env.BUD_DATA_DIR ?? join(home, "extensions", "bud", "artifacts")),
  copilotHome: home, sessionId, questions
});
const bud = createBudCanvas(service, assets);
let stopped = false;
async function stop() {
  if (stopped) return;
  stopped = true;
  await bud.close();
  service.close();
}
process.on("SIGINT", () => { void stop().then(() => process.exit(0), error => { console.error(error); process.exit(1); }); });
process.on("SIGTERM", () => { void stop().then(() => process.exit(0), error => { console.error(error); process.exit(1); }); });
try {
  const session = await joinSession({ canvases: [bud.canvas] });
  service.setSessionSender(prompt => session.send({ prompt }));
  await session.log("Bud is ready. Progress stays local; usage is imported only on request.", { level: "info" });
} catch (error) {
  await stop();
  throw error;
}
