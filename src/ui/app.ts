import "@primer/primitives/dist/css/primitives.css";
import "@primer/primitives/dist/css/functional/themes/light.css";
import "@primer/primitives/dist/css/functional/themes/dark.css";
import "@primer/css/dist/primer.css";
import "./style.css";
import type { AppView } from "../core/view.js";
import type { DailyView } from "../core/types.js";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Bud's application root is missing.");
const app = root;
let view: AppView | undefined;
let tab = "today";
let busy = false;
let notice = "";
let error = "";
let answer: number | null = null;
let theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
let lastQuestion = "";
let mutation = 0;

const escape = (value: string | number) => String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);
const number = (value: number | null) => value === null ? "Unavailable" : new Intl.NumberFormat().format(value);

async function request(action: string, input: unknown = {}): Promise<AppView> {
  const response = await fetch("./api", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Bud-Request": "1" },
    body: JSON.stringify({ action, input })
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const message = body && typeof body === "object" && "message" in body && typeof body.message === "string" ? body.message : "Bud could not complete that action.";
    throw new Error(message);
  }
  return body as AppView;
}

function bot(): string {
  if (!view) return "";
  const { equipped } = view.profile;
  const title = view.cosmetics.find(item => item.id === equipped.title)?.name ?? "Curious companion";
  return `<div class="avatar-stage">
    <div class="stage-orbit" aria-hidden="true"></div>
    <div class="bot bot-${escape(equipped.color)} head-${escape(equipped.head)} outfit-${escape(equipped.outfit)}" role="img" aria-label="Your Bud with ${escape(equipped.color)} color, ${escape(equipped.head)} headwear, and ${escape(equipped.outfit)} outfit">
      <div class="bot-top"><i></i><b></b></div>
      <div class="bot-ears"></div>
      <div class="bot-head"><div class="bot-face"><i></i><i></i><span></span></div><div class="cheek left"></div><div class="cheek right"></div></div>
      <div class="bot-body"><div class="bot-badge"></div></div>
      <div class="bot-arm left"></div><div class="bot-arm right"></div>
      <div class="bot-foot left"></div><div class="bot-foot right"></div>
    </div>
    <div class="bot-shadow" aria-hidden="true"></div>
    <span class="avatar-caption">${escape(title)}</span>
  </div>`;
}

function daily(q: DailyView): string {
  const fact = q.type === "did-you-know";
  const source = `<a href="${escape(q.sourceUrl)}" target="_blank" rel="noreferrer">Read the official source <span aria-hidden="true">&#8599;</span></a>`;
  return `<section class="learning-panel" aria-labelledby="daily-title">
    <div class="section-top"><span class="eyebrow">A little wiser, every day</span><span class="xp-label">${q.answered ? "Learned today" : "+20 XP"}</span></div>
    <h2 id="daily-title">Your daily discovery</h2>
    <div class="question-meta">${escape(q.category)} <span aria-hidden="true">/</span> ${escape(q.difficulty)} <span aria-hidden="true">/</span> ${fact ? "Nice to know" : "Quick question"}</div>
    <h3 class="question">${escape(q.question)}</h3>
    ${fact ? `<p class="fact-copy">${q.answered ? "" : "No quiz this time. Open a small discovery about working with Copilot."}</p>` : `<fieldset class="answers" ${q.answered || busy ? "disabled" : ""}><legend class="sr-only">Choose an answer</legend>${q.options.map((option, i) => `<label class="answer ${answer === i ? "selected" : ""} ${q.answered && q.answerIndex === i ? "correct" : ""}"><input type="radio" name="answer" value="${i}" ${answer === i || q.selectedIndex === i ? "checked" : ""}><span class="answer-letter" aria-hidden="true">${String.fromCharCode(65 + i)}</span><span>${escape(option)}</span>${q.answered && q.answerIndex === i ? '<span class="answer-mark">Correct answer</span>' : ""}</label>`).join("")}</fieldset>`}
    ${q.answered ? `<div class="explanation" role="status"><strong>${fact ? "A new thing in your toolkit." : q.correct ? "You got it. Nice thinking!" : "That's how we learn. You still earned your XP."}</strong><p>${escape(q.explanation ?? "")}</p>${source}</div><p class="tomorrow">Another discovery tomorrow. Your Bud will be here.</p>` : `<div class="question-footer"><button class="btn btn-primary" data-action="answer" ${busy || (!fact && answer === null) ? "disabled" : ""}>${fact ? "Discover this" : "Check answer"}</button><span>No pressure. Curiosity earns the XP.</span></div><p class="verification">Verified ${escape(q.verifiedOn)}${q.mayGoStale ? " / Time-sensitive; reviewed on update" : ""}. ${source}</p>`}
  </section>`;
}

function usage(): string {
  if (!view) return "";
  const u = view.usage;
  return `<section class="usage-section" aria-labelledby="usage-title"><div class="section-heading"><div><h2 id="usage-title">Small footprint. Real progress.</h2><p>Your current Copilot session, without the guesswork.</p></div><button class="btn btn-sm" data-action="sync" ${busy || !u.sessionAvailable ? "disabled" : ""}>${busy ? "Working..." : "Read local usage"}</button></div>
    <div class="metrics">${([["Input tokens", u.input], ["Output tokens", u.output], ["Cache-read tokens", u.cacheRead]] as const).map(([label, metric]) => `<div class="metric"><span>${label}</span><strong>${number(metric.value)}</strong><small>${u.syncedAt ? `Reported / ${metric.covered} of ${u.callCount} calls` : "Not imported yet"}</small></div>`).join("")}</div>
    ${u.context ? `<p class="context-note">Latest context sample: <strong>${number(u.context.current)} / ${number(u.context.limit)}</strong> tokens. Sample only, not a measured peak. ${escape(u.context.basis)}.</p>` : ""}
    <details class="privacy-details"><summary>What Bud can (and can't) measure</summary><p>Only this session's local event log is read when you request it. Bud saves allowlisted counters, never transcript text. No uploads, analytics, rankings, or spending rewards.</p><p>Cache-hit ratios and under-half-context task achievements are unavailable: the evidence isn't strong enough. Missing counters never become zero.</p>${u.diagnostics.map(item => `<p>${escape(item)}</p>`).join("")}<p>Profile data lives outside your repository. Agent-invoked results enter the host conversation when requested; Bud does not send anything itself.</p></details>
  </section>`;
}

function wardrobe(): string {
  if (!view) return "";
  return `<section class="wardrobe"><h2>Make Bud yours.</h2><p>Little rewards for learning, not for burning tokens.</p>${(["color", "head", "outfit", "title"] as const).map(slot => `<section class="wardrobe-group"><h3>${({ color: "Colors", head: "Headwear", outfit: "Outfits", title: "Titles" })[slot]}</h3><div class="cosmetics">${view?.cosmetics.filter(item => item.slot === slot).map(item => `<button class="cosmetic ${item.equipped ? "is-equipped" : ""}" data-equip="${escape(item.id)}" ${!item.unlocked || busy ? "disabled" : ""} aria-pressed="${item.equipped}">${slot === "color" ? `<span class="swatch swatch-${escape(item.id)}" aria-hidden="true"></span>` : `<span class="cosmetic-symbol" aria-hidden="true">${slot === "head" ? "⌒" : slot === "outfit" ? "▤" : "Aa"}</span>`}<span>${escape(item.name)}</span><small>${item.equipped ? "Equipped" : item.unlocked ? "Equip" : `Unlocks at level ${item.level}`}</small></button>`).join("")}</div></section>`).join("")}</section>`;
}

function collection(): string {
  if (!view) return "";
  return `<section class="collection"><h2>Good habits, collected.</h2><p>One-time milestones. No grinding, no keeping up with anyone.</p><div class="achievement-grid">${view.achievements.map(a => `<article class="achievement ${a.unlocked ? "is-unlocked" : ""}"><span class="achievement-stamp" aria-hidden="true">${a.unlocked ? "✦" : a.unavailable ? "?" : "◇"}</span><div><h3>${escape(a.name)}</h3><p>${escape(a.description)}</p><small>${a.unavailable ? "Unavailable" : a.unlocked ? "Unlocked" : `+${a.xp} XP`} / ${escape(a.evidence)}</small></div></article>`).join("")}</div>
    <div class="reflection"><h3>Notice a good habit?</h3><p>Acknowledge something you did. These are self-reported, not measured efficiency claims. Reflect on three different days to unlock Thoughtful tinkerer.</p><div class="reflection-buttons">${([["fresh-session", "Started fresh"], ["lean-instructions", "Reviewed instructions"], ["mcp-cleanup", "Reviewed MCP servers"]] as const).map(([kind, label]) => `<button class="btn btn-sm" data-reflect="${kind}" ${busy || view?.dailyError || view?.profile.reflections.some(r => r.id === `${kind}:${view?.today}`) ? "disabled" : ""}>${view?.profile.reflections.some(r => r.id === `${kind}:${view?.today}`) ? "Recorded: " : ""}${label}</button>`).join("")}</div></div>
  </section>`;
}

function render(): void {
  document.documentElement.dataset.colorMode = theme;
  if (!view) {
    app.innerHTML = `<main class="loading" role="${error ? "alert" : "status"}">${error ? `<h1>Bud couldn't wake up.</h1><p>${escape(error)}</p><button class="btn" data-action="retry">Try again</button>` : "Waking up your Bud..."}</main>`;
    return;
  }
  if (lastQuestion !== view.daily?.id) { answer = null; lastQuestion = view.daily?.id ?? ""; }
  const p = view.profile;
  const unlocked = view.achievements.filter(a => a.unlocked).length;
  const next = view.cosmetics.filter(c => !c.unlocked).sort((a, b) => a.level - b.level)[0];
  app.innerHTML = `<div class="bud-app">
    <header class="app-header"><a class="brand" href="#" aria-label="Bud home"><span class="brand-mark" aria-hidden="true">b.</span>bud<span class="brand-context">${view.development ? "Canvas test harness / synthetic usage" : "for GitHub Copilot"}</span></a><button class="theme-switch btn btn-invisible btn-sm" data-action="theme" aria-label="Switch to ${theme === "light" ? "dark" : "light"} theme">${theme === "light" ? "Dark mode" : "Light mode"}</button></header>
    ${view.development ? '<div class="development-notice">Test canvas. Synthetic usage and an isolated profile, not your personal data.</div>' : ""}
    <div class="app-layout"><aside class="companion"><div class="companion-greeting"><span class="eyebrow">Your little learning companion</span><h1>A little growth<br>goes a long way.</h1><p>Good habits. Small discoveries.<br>A Bud that's growing with you.</p></div>${bot()}
      <div class="level-summary"><div class="level-line"><strong>Level ${p.level}</strong><span>${p.xp} XP</span></div><progress aria-label="Progress to next level" max="${p.nextLevel - p.levelStart}" value="${p.xp - p.levelStart}"></progress><p>${p.nextLevel - p.xp} XP to level ${p.level + 1}${next ? ` / ${escape(next.name)} next` : " / All current cosmetics unlocked"}</p></div>
      <div class="companion-stats"><div><strong>${p.streak}</strong><span>day streak</span></div><div><strong>${p.learned}</strong><span>discoveries</span></div><div><strong>${unlocked}</strong><span>milestones</span></div></div>
      <p class="local-note">Yours alone. Saved on this device.</p></aside>
      <main class="main-content"><nav class="tabs" aria-label="Bud sections">${[["today", "Today"], ["wardrobe", "Wardrobe"], ["collection", "Collection"]].map(([id, label]) => `<button data-tab="${id}" class="${tab === id ? "active" : ""}" aria-current="${tab === id ? "page" : "false"}">${label}</button>`).join("")}</nav>
      <div class="feedback" aria-live="polite">${error ? `<div class="flash flash-error" role="alert">${escape(error)}</div>` : notice ? `<div class="flash flash-success">${escape(notice)}</div>` : ""}</div>
      <div class="tab-content">${tab === "today" ? (view.daily ? daily(view.daily) : `<section class="learning-panel"><h2>Daily learning is taking a breather.</h2><p role="status">${escape(view.dailyError?.message ?? "No daily discovery is available.")}</p><p>Your profile and wardrobe are still here. No progress has been lost.</p></section>`) + usage() : tab === "wardrobe" ? wardrobe() : collection()}</div>
      <footer class="app-footer">Less pressure. More curiosity.<span>Daily rollover: ${escape(p.timezone)}</span></footer></main>
    </div></div>`;
}

async function act(action: string, input: unknown = {}, message = ""): Promise<void> {
  if (busy) return;
  mutation++;
  busy = true; error = ""; notice = ""; render();
  try { view = await request(action, input); notice = message; }
  catch (cause) { error = cause instanceof Error ? cause.message : "Something went wrong."; }
  finally { busy = false; render(); }
}

app.addEventListener("change", event => {
  if (event.target instanceof HTMLInputElement && event.target.name === "answer") {
    answer = Number(event.target.value);
    const focused = event.target.value;
    render();
    app.querySelector<HTMLInputElement>(`input[name="answer"][value="${focused}"]`)?.focus();
  }
});

app.addEventListener("click", event => {
  const button = event.target instanceof Element ? event.target.closest<HTMLElement>("button, .brand") : null;
  if (!button) return;
  if (button.matches(".brand")) { event.preventDefault(); tab = "today"; render(); return; }
  if (button.dataset.tab) { tab = button.dataset.tab; error = ""; notice = ""; render(); return; }
  if (button.dataset.equip) { void act("equip_item", { itemId: button.dataset.equip }, "A fresh look. Very you."); return; }
  if (button.dataset.reflect) { void act("record_reflection", { kind: button.dataset.reflect }, "Good habit recorded as self-reported. Keep it gentle."); return; }
  if (button.dataset.action === "theme") { theme = theme === "light" ? "dark" : "light"; render(); return; }
  if (button.dataset.action === "retry") { void act("get_profile"); return; }
  if (button.dataset.action === "sync") { void act("sync_usage", { consent: true }, "Local counters refreshed. Nothing was uploaded."); return; }
  if (button.dataset.action === "answer" && view?.daily) {
    void act("submit_answer", { questionId: view.daily.id, day: view.daily.day, answerIndex: answer }, "Your daily learning is saved.");
  }
});

void act("get_profile");
setInterval(() => {
  if (busy || document.hidden) return;
  const startedAt = mutation;
  void (async () => {
    try {
      const next = await request("get_profile");
      if (busy || startedAt !== mutation) return;
      if (JSON.stringify(next) !== JSON.stringify(view)) {
        const active = document.activeElement;
        if (active instanceof HTMLInputElement && active.name === "answer" && next.daily?.id === view?.daily?.id && next.daily && !next.daily.answered) return;
        view = next; render();
      }
    } catch (cause) { error = cause instanceof Error ? cause.message : "Bud could not refresh."; render(); }
  })();
}, 5000);
