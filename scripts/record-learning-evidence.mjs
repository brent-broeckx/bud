import { spawn } from "node:child_process";
import { readFile, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const helper = process.env.BUD_EVIDENCE_HELPER ?? join(homedir(), ".copilot", "skills", "video-evidence", "scripts", "evidence.mjs");
const { startEvidence } = await import(pathToFileURL(helper).href);
const directory = await mkdtemp(join(tmpdir(), "bud-learning-evidence-"));
const child = spawn(process.execPath, ["--import", "tsx", "scripts/dev.ts"], {
  cwd: process.cwd(), env: { ...process.env, BUD_DEV_DIR: directory, BUD_EVIDENCE: "1" }, stdio: ["ignore", "pipe", "pipe"]
});
let diagnostics = "", ev;
child.stderr.on("data", chunk => { diagnostics += String(chunk); });
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
  const profile = async () => (await command("get_profile")).body;
  const bank = JSON.parse(await readFile("content/questions.json", "utf8"));
  const initial = await profile();
  const question = bank.find(q => q.id === initial.daily.id);
  let baseline, lessonXP, practiceXP;
  ev = await startEvidence({
    title: "Bud: continuous learning, practice and private usage coaching",
    slug: "bud-continuous-learning", baseURL, stepPause: 1000, slowMo: 90,
    context: "Real renderer and service in Chromium with isolated synthetic usage. Covers daily-to-Explore continuity, repeat protection, both experience levels, authored practice, self-reported real work, usage history, separate review consent, persistence and responsive themes. Not the Copilot app host."
  });
  const { page } = ev;
  const errors = [], external = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (!request.url().startsWith(origin)) external.push(request.url()); });
  await ev.step("Finish today's discovery: learning earns XP and immediately offers more to do", async () => {
    await page.goto(baseURL);
    await page.getByRole("heading", { name: "Your daily discovery" }).waitFor();
    await page.locator(`input[name="answer"][value="${(question.answerIndex + 1) % question.options.length}"]`).check();
    await page.getByRole("button", { name: "Check answer", exact: true }).click();
    await page.getByRole("button", { name: "Keep exploring", exact: true }).waitFor();
    baseline = (await profile()).profile.xp;
    assert.equal(baseline, 30);
  });
  await ev.step("Explore another lesson today, with source-linked feedback and no daily lock", async () => {
    await page.getByRole("button", { name: "Keep exploring", exact: true }).click();
    await page.getByRole("button", { name: "Next lesson", exact: true }).click();
    await page.locator("#lesson-title").waitFor();
    const current = (await profile()).learning.activeLesson;
    assert.equal(current.answerIndex, undefined);
    const answer = bank.find(q => q.id === current.id).answerIndex;
    await page.locator(`input[name="lesson-answer"][value="${answer}"]`).check();
    await page.getByRole("button", { name: "Check lesson", exact: true }).click();
    await page.getByText("Correct. Nicely done.", { exact: true }).waitFor();
    lessonXP = (await profile()).profile.xp;
    assert.equal(lessonXP, baseline + 10);
  });
  await ev.step("Reload and replay a completed lesson: progress persists and XP cannot be farmed", async () => {
    const active = (await profile()).learning.activeLesson;
    assert.equal((await command("submit_lesson", { questionId: active.id, answerIndex: active.answerIndex })).body.profile.xp, lessonXP);
    await page.reload();
    await page.getByRole("button", { name: "Explore", exact: true }).click();
    await page.getByText("Correct. Nicely done.", { exact: true }).waitFor();
    assert.equal((await profile()).profile.xp, lessonXP);
  });
  await ev.step("Choose experienced recommendations and complete a quick practical exercise", async () => {
    await page.getByRole("button", { name: "Practice", exact: true }).click();
    await page.getByLabel("Suggest material for").selectOption("experienced");
    await page.getByText("Recommendations updated. Every path remains available.", { exact: true }).waitFor();
    assert.equal((await profile()).learning.experience, "experienced");
    await page.locator('[data-challenge="practice-prompt-rewrite"]').click();
    await page.locator("#challenge-title").waitFor();
    assert.equal((await profile()).learning.activeChallenge.answerIndex, undefined);
    await page.locator('input[name="practice-answer"][value="2"]').check();
    await page.getByRole("button", { name: "Check practice", exact: true }).click();
    await page.getByText("Correct. Here's why.", { exact: true }).waitFor();
    practiceXP = (await profile()).profile.xp;
    assert.equal(practiceXP, lessonXP + 15);
  });
  await ev.step("Real work has a copyable brief; an incomplete checklist is rejected without XP", async () => {
    await page.getByRole("button", { name: "Practise here", exact: true }).click();
    await page.locator('[data-challenge="real-handoff"]').click();
    await page.locator("#challenge-prompt").waitFor();
    assert.ok((await page.locator("#challenge-prompt").inputValue()).length > 40);
    await page.getByRole("button", { name: "Record completed checklist", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Confirm every checklist item" }).waitFor();
    assert.equal((await profile()).profile.xp, practiceXP);
  });
  await ev.step("Confirm the synthetic demonstration checklist: explicitly self-reported, awarded once", async () => {
    for (const checkbox of await page.locator('input[name="challenge-check"]').all()) await checkbox.check();
    await page.getByRole("button", { name: "Record completed checklist", exact: true }).click();
    await page.getByText("Recorded as self-reported.", { exact: true }).waitFor();
    const current = await profile();
    assert.equal(current.profile.xp, practiceXP + 40);
    const active = current.learning.activeChallenge;
    const repeated = await command("submit_challenge", { challengeId: active.id, checks: active.checklist.map(item => item.id) });
    assert.equal(repeated.body.profile.xp, current.profile.xp);
  });
  await ev.step("Import synthetic session and local-history counters, with coverage and context samples", async () => {
    await page.getByRole("button", { name: "My usage", exact: true }).click();
    await page.getByRole("button", { name: "Read local usage", exact: true }).click();
    await page.getByText("Local counters refreshed. Nothing was uploaded.", { exact: true }).waitFor();
    assert.ok((await page.locator(".usage-metrics").first().innerText()).includes("1,200"));
    assert.equal(await page.locator(".chart-point").count(), 1);
    await page.getByRole("button", { name: "Local history", exact: true }).click();
    await page.getByRole("button", { name: "Read local history", exact: true }).click();
    await page.getByText("Local history counters imported. Coverage is listed below.", { exact: true }).waitFor();
    assert.equal((await profile()).history.sessions.length, 1);
    assert.match(await page.locator(".history-chart").innerText(), /1,200/);
  });
  await ev.step("Text review needs separate consent, stays local, and never awards usage XP", async () => {
    const xp = (await profile()).profile.xp;
    assert.equal((await command("review_session", {})).status, 400);
    await page.getByLabel("Selected prompt (up to 6,000 characters)").fill("Fix app.ts without changing the API. Verify with a regression test.");
    await page.getByRole("button", { name: "Review selected prompt", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "separate consent" }).waitFor();
    await page.locator("#review-consent").check();
    await page.getByRole("button", { name: "Review selected prompt", exact: true }).click();
    await page.getByRole("heading", { name: "Local prompt review", exact: true }).waitFor();
    assert.match(await page.locator(".explanation").innerText(), /not an AI quality grade/);
    assert.equal((await profile()).profile.xp, xp);
  });
  await ev.step("Dark narrow-canvas layout works; forgetting counters preserves learning and makes no uploads", async () => {
    await page.getByRole("button", { name: "Switch to dark theme", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".privacy-details").getByText("Coverage and privacy", { exact: true }).click();
    await page.getByRole("button", { name: "Forget imported counters", exact: true }).click();
    await page.getByText("Imported counters forgotten.", { exact: true }).waitFor();
    const current = await profile();
    assert.equal(current.history.sessions.length, 0);
    assert.equal(current.learning.progress.realCompleted, 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator("html").getAttribute("data-color-mode"), "dark");
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
  });
} finally {
  try {
    if (ev) {
      const result = await ev.finish();
      assert.ok((await stat(result.report)).size > 0);
      const report = await readFile(result.report, "utf8");
      await writeFile(result.report, report.replace("_(fill in)_", "This records the actual renderer/service with synthetic data, not the Copilot app right panel. The real-work checklist is deliberately a self-reported synthetic demonstration; no code work is represented as verified. SDK session.send integration is typechecked and unit-tested with a fake sender, not exercised against a live model. Multi-day mastery, storage validation, path-title locks and concurrency are covered by deterministic tests. No production profile or private usage appears."));
      console.log(`BUD_EVIDENCE_REPORT=${result.report}`);
    }
  } finally {
    child.kill();
    await new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once("exit", resolve); });
    await rm(directory, { recursive: true, force: true });
  }
}
