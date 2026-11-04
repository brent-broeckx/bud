import { spawn } from "node:child_process";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const helper = process.env.BUD_EVIDENCE_HELPER ?? join(homedir(), ".copilot", "skills", "video-evidence", "scripts", "evidence.mjs");
const { startEvidence } = await import(pathToFileURL(helper).href);
const directory = await mkdtemp(join(tmpdir(), "bud-evidence-"));
const child = spawn(process.execPath, ["--import", "tsx", "scripts/dev.ts"], {
  cwd: process.cwd(), env: { ...process.env, BUD_DEV_DIR: directory, BUD_EVIDENCE: "1" }, stdio: ["ignore", "pipe", "pipe"]
});
let diagnostics = "";
child.stderr.on("data", chunk => { diagnostics += String(chunk); });
let ev;
try {
  const baseURL = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`Canvas did not start: ${diagnostics}`)), 30_000);
    child.once("exit", code => { clearTimeout(timer); reject(new Error(`Canvas exited (${code}): ${diagnostics}`)); });
    child.stdout.on("data", chunk => {
      output += String(chunk);
      const match = /BUD_URL=(http:\/\/[^\s]+)/.exec(output);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  assert.equal((await fetch(baseURL)).status, 200);
  const origin = new URL(baseURL).origin;
  const command = async (action, input = {}) => {
    const response = await fetch(new URL("api", baseURL), {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json", "X-Bud-Request": "1" },
      body: JSON.stringify({ action, input })
    });
    return { status: response.status, body: await response.json() };
  };
  const bank = JSON.parse(await readFile("content/questions.json", "utf8"));
  const initial = (await command("get_profile")).body;
  const question = bank.find(q => q.id === initial.daily.id);
  assert.equal(question.type, "quiz");
  const wrongIndex = (question.answerIndex + 1) % question.options.length;
  ev = await startEvidence({
    title: "Bud Copilot canvas: learning, shared state and privacy",
    slug: "bud-canvas", baseURL,
    context: "Real canvas renderer and service, with isolated storage and explicitly synthetic usage. Covers wrong answers, replay protection, cosmetics, shared commands, usage consent and responsive themes. This is not a recording inside the Copilot app host.",
    stepPause: 1000, slowMo: 130
  });
  const { page } = ev;
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const externalRequests = [];
  page.on("request", request => { if (!request.url().startsWith(origin)) externalRequests.push(request.url()); });
  await ev.step("Open the isolated canvas: no invented progress or imported usage", async () => {
    await page.goto(baseURL);
    await page.getByRole("heading", { name: "Your daily discovery" }).waitFor();
    assert.equal(await page.locator(".level-line").innerText(), "Level 1\n0 XP");
    assert.ok((await page.locator(".metrics").innerText()).includes("Unavailable"));
    assert.ok((await page.locator(".development-notice").innerText()).includes("Synthetic"));
  });
  await ev.step("Answer incorrectly: explanation appears, with the same learning XP", async () => {
    await page.locator(`input[name="answer"][value="${wrongIndex}"]`).check();
    await page.getByRole("button", { name: "Check answer", exact: true }).click();
    await page.getByText("That's how we learn. You still earned your XP.", { exact: true }).waitFor();
    assert.ok((await page.locator(".level-line").innerText()).includes("30 XP"));
    assert.ok((await page.locator(".explanation").innerText()).includes(question.explanation));
  });
  await ev.step("Replay the answer and reload: XP stays at 30 and learning remains saved", async () => {
    const repeated = await command("submit_answer", { questionId: initial.daily.id, day: initial.daily.day, answerIndex: wrongIndex });
    assert.equal(repeated.body.profile.xp, 30);
    await page.reload();
    await page.getByText("Learned today", { exact: true }).waitFor();
    assert.ok((await page.locator(".level-line").innerText()).includes("30 XP"));
  });
  await ev.step("Customize Bud with Mint; level-two cosmetics remain locked", async () => {
    await page.getByRole("button", { name: "Wardrobe", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: /Cozy beanie/ }).isDisabled(), true);
    await page.getByRole("button", { name: /^Mint/ }).click();
    await page.locator(".bot-mint").waitFor();
    assert.equal((await command("get_profile")).body.profile.equipped.color, "mint");
  });
  await ev.step("A shared command changes headwear; the canvas picks up the same saved state", async () => {
    assert.equal((await command("equip_item", { itemId: "bare" })).status, 200);
    await page.locator(".head-bare").waitFor({ timeout: 10_000 });
    assert.equal((await command("get_profile")).body.profile.xp, 30);
  });
  await ev.step("Read synthetic local counters; missing consent is rejected and no XP is awarded", async () => {
    assert.equal((await command("sync_usage", {})).status, 400);
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await page.getByRole("button", { name: "Read local usage", exact: true }).click();
    await page.getByText("Local counters refreshed. Nothing was uploaded.", { exact: true }).waitFor();
    assert.ok((await page.locator(".metrics").innerText()).includes("1,200"));
    assert.ok((await page.locator(".metrics").innerText()).includes("Reported / 1 of 1 calls"));
    assert.equal((await command("get_profile")).body.profile.xp, 30);
  });
  await ev.step("Collection distinguishes unlocked learning from unavailable efficiency claims", async () => {
    await page.getByRole("button", { name: "Collection", exact: true }).click();
    assert.equal(await page.locator(".achievement.is-unlocked").count(), 1);
    assert.ok((await page.locator(".achievement").filter({ hasText: "Cache gardener" }).innerText()).includes("Unavailable"));
    await page.getByRole("button", { name: "Started fresh", exact: true }).click();
    assert.ok((await page.locator(".feedback").innerText()).includes("self-reported"));
    assert.equal((await command("get_profile")).body.profile.xp, 30);
  });
  await ev.step("Dark mobile layout stays usable and makes no outbound requests", async () => {
    await page.getByRole("button", { name: "Switch to dark theme", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Today", exact: true }).click();
    assert.equal(await page.locator("html").getAttribute("data-color-mode"), "dark");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    assert.deepEqual(externalRequests, []);
  });
} finally {
  try {
    if (ev) {
      const result = await ev.finish();
      const report = await readFile(result.report, "utf8");
      await writeFile(result.report, report.replace("_(fill in)_", "This captures the actual renderer/service in Chromium, not the Copilot app's right panel. SDK registration is checked separately. No production profile or private usage appears in this recording. Multi-day progression is covered by deterministic core tests, not by changing the computer clock."));
    }
  } finally {
    child.kill();
    await new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once("exit", resolve); });
    await rm(directory, { recursive: true, force: true });
  }
}
