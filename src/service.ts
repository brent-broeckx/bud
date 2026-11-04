import { ProfileStore } from "./store.js";
import { COSMETICS, levelFor, levelStart } from "./core/catalog.js";
import { dailyEntry, dayFor, streak, validateQuestions } from "./core/questions.js";
import { awardOnce, dailyView, equipItem, newProfile, submitAnswer, sumCounter, xpFor } from "./core/profile.js";
import { achievementViews, evaluateAchievements } from "./core/achievements.js";
import { BudError, type ProfileState, type Question } from "./core/types.js";
import type { AppView } from "./core/view.js";
import { readCopilotUsage } from "./adapters/copilot.js";
import { readSessionPrompts, readUsageHistory } from "./adapters/history.js";
import { reviewPrompts, summarizeUsage, type ReviewView } from "./core/coaching.js";
import { applyLearningAction, learningView, newLearningState } from "./core/learning.js";

interface ServiceOptions {
  directory: string;
  copilotHome: string;
  sessionId?: string;
  questions: unknown;
  timezone?: string;
  clock?: () => Date;
  development?: boolean;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BudError("input", "The action input must be an object.");
  return value as Record<string, unknown>;
}
function keys(input: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new BudError("input", "The action contains unsupported fields.");
}

export class BudService {
  readonly store: ProfileStore;
  readonly bank: Question[];
  private readonly clock: () => Date;
  private importQueue: Promise<void> = Promise.resolve();
  private review: ReviewView | null = null;
  private sessionSender: ((prompt: string) => Promise<string>) | null = null;
  private sending = false;
  private lastMessageId: string | null = null;

  constructor(private readonly options: ServiceOptions) {
    this.bank = validateQuestions(options.questions);
    this.clock = options.clock ?? (() => new Date());
    this.store = new ProfileStore(options.directory, () => newProfile(this.clock(), options.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone));
  }

  async dispatch(action: string, raw: unknown = {}): Promise<AppView> {
    const input = object(raw);
    if (action === "send_challenge") {
      keys(input, ["challengeId", "consent", "prompt"]);
      if (input.consent !== true) throw new BudError("consent", "Sending a challenge to Copilot requires separate explicit consent. This starts model work in your session.");
      if (!this.sessionSender) throw new BudError("session_bridge", "This host has no connected session sender. Copy the challenge brief into Copilot instead.");
      if (this.sending) throw new BudError("session_busy", "A challenge is already being sent. Wait for it before trying again.");
      const active = this.store.transaction(state => this.view(state).learning.activeChallenge);
      if (active?.kind !== "real" || active.id !== input.challengeId) throw new BudError("challenge_changed", "Open this real-work challenge before sending it.");
      if (typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 6000) throw new BudError("challenge_prompt", "Use a challenge brief between 1 and 6000 characters.");
      if (/<[^>]+>/.test(input.prompt)) throw new BudError("challenge_prompt", "Replace the challenge's placeholder text before sending it.");
      this.sending = true;
      try {
        this.lastMessageId = await this.sessionSender(`Help me practise this Bud challenge: ${active.title}. Coach me step by step. Do not edit files or change configuration until I explicitly approve those changes. Do not claim completion or award Bud XP on my behalf.\n\n${input.prompt}`);
      } catch (error) {
        console.error("Bud challenge delivery failed:", error instanceof Error ? error.name : "unknown failure");
        throw new BudError("session_send", "Copilot did not confirm delivery. Check the conversation before retrying to avoid duplicate messages, or copy the brief manually.");
      } finally { this.sending = false; }
      return this.store.transaction(state => this.view(state));
    }
    if (action === "review_prompt" || action === "review_session") {
      keys(input, action === "review_prompt" ? ["consent", "text"] : ["consent"]);
      if (input.consent !== true) throw new BudError("consent", "Text review requires separate explicit consent. Usage consent does not authorize reading prompts.");
      if (action === "review_prompt") {
        if (typeof input.text !== "string" || !input.text.trim() || input.text.length > 6000) throw new BudError("review_text", "Paste a prompt between 1 and 6000 characters.");
        this.review = reviewPrompts([input.text], "prompt");
      } else {
        if (!this.options.sessionId) throw new BudError("session_unavailable", "This host did not provide a current Copilot session.");
        this.review = reviewPrompts(await readSessionPrompts(this.options.copilotHome, this.options.sessionId), "session");
      }
      return this.store.transaction(state => this.view(state));
    }
    if (action === "clear_review") {
      keys(input, []);
      this.review = null;
      return this.store.transaction(state => this.view(state));
    }
    if (action === "sync_history") {
      keys(input, ["consent", "offset"]);
      if (input.consent !== true) throw new BudError("consent", "Reading local history requires explicit consent.");
      const offset = input.offset ?? 0;
      if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0) throw new BudError("history_offset", "History offset must be a non-negative integer.");
      const history = await readUsageHistory(this.options.copilotHome, this.clock(), offset);
      return this.store.transaction(state => {
        const snapshots = new Map((offset === 0 ? [] : state.usageHistory ?? []).map(item => [item.sessionId, item]));
        for (const session of history.sessions) snapshots.set(session.sessionId, session);
        state.usageHistory = [...snapshots.values()];
        state.historyDiagnostics = [...(offset === 0 ? [] : state.historyDiagnostics ?? []), ...history.diagnostics];
        state.historyNextOffset = history.nextOffset;
        state.historyTotalDirectories = history.totalDirectories;
        return this.view(state);
      });
    }
    if (action === "sync_usage") {
      keys(input, ["consent"]);
      if (input.consent !== true) throw new BudError("consent", "Reading local usage requires explicit consent: set consent to true only when the user requests it.");
      if (!this.options.sessionId) throw new BudError("session_unavailable", "This host did not provide a current Copilot session.");
      let release!: () => void;
      const previous = this.importQueue;
      this.importQueue = new Promise<void>(resolve => { release = resolve; });
      await previous;
      try {
        const usage = await readCopilotUsage(this.options.copilotHome, this.options.sessionId, this.clock());
        return this.store.transaction(state => {
          const stored = [state.usage, ...(state.usageHistory ?? [])].filter(item => item.sessionId === usage.sessionId)
            .sort((a, b) => Date.parse(b.syncedAt ?? "") - Date.parse(a.syncedAt ?? "") || b.calls.length - a.calls.length)[0] ?? state.usage;
          if (stored.sessionId === usage.sessionId && stored.syncedAt && (
            Date.parse(stored.syncedAt) > Date.parse(usage.syncedAt!) ||
            (Date.parse(stored.syncedAt) === Date.parse(usage.syncedAt!) && stored.calls.length > usage.calls.length)
          )) {
            return this.view(state);
          }
          state.usage = usage;
          state.usageHistory = [...(state.usageHistory ?? []).filter(item => item.sessionId !== usage.sessionId), usage];
          return this.view(state);
        });
      } finally { release(); }
    }
    return this.store.transaction(state => {
      const now = this.clock();
      state.learning ??= newLearningState();
      if (["start_lesson", "submit_lesson", "start_challenge", "submit_challenge", "set_experience"].includes(action)) {
        const allowed = action === "set_experience" ? ["experience"] : action === "start_lesson" ? ["questionId"]
          : action === "submit_lesson" ? ["questionId", "answerIndex"] : action === "start_challenge" ? ["challengeId"] : ["challengeId", "answerIndex", "checks"];
        keys(input, allowed);
        const previousAttempt = state.learning.history.at(-1);
        const result = applyLearningAction(state.learning, this.bank, now, action, input, state.timezone);
        const attempt = state.learning.history.at(-1);
        if (attempt && attempt !== previousAttempt) state.learningDays = [...new Set([...(state.learningDays ?? []), attempt.day])];
        if (result.award) awardOnce(state, { ...result.award, at: now.toISOString() });
        evaluateAchievements(state, this.bank, now);
      }
      else if (action === "clear_history") {
        keys(input, []);
        state.usageHistory = [];
        state.historyDiagnostics = [];
        state.historyNextOffset = null;
        state.historyTotalDirectories = 0;
        state.usage = { calls: [], contexts: [], sessionId: null, syncedAt: null, diagnostics: [] };
      }
      else if (["get_profile", "get_daily_question", "list_achievements", "get_learning"].includes(action)) keys(input, []);
      else if (action === "submit_answer") {
        keys(input, ["questionId", "day", "answerIndex"]);
        submitAnswer(state, this.bank, now, input.questionId, input.day, input.answerIndex);
        evaluateAchievements(state, this.bank, now);
      } else if (action === "equip_item") {
        keys(input, ["itemId"]);
        equipItem(state, input.itemId);
      } else if (action === "record_reflection") {
        keys(input, ["kind"]);
        if (!["fresh-session", "lean-instructions", "mcp-cleanup"].includes(String(input.kind))) throw new BudError("reflection", "Choose a supported reflection.");
        const day = dailyEntry(state, this.bank, now).day;
        const id = `${String(input.kind)}:${day}`;
        if (!state.reflections.some(r => r.id === id)) {
          state.reflections.push({ id, kind: input.kind as ProfileState["reflections"][number]["kind"], at: now.toISOString() });
        }
        evaluateAchievements(state, this.bank, now);
      } else throw new BudError("action_unknown", "That Bud action is not supported.");
      return this.view(state);
    });
  }

  private view(state: ProfileState): AppView {
    const now = this.clock();
    const xp = xpFor(state), level = levelFor(xp);
    const learning = learningView(state.learning ??= newLearningState(), this.bank, now, state.timezone);
    const earnedTitles = [...new Set([...(state.earnedTitles ?? []), ...learning.unlocks.filter(unlock => unlock.earned).map(unlock => unlock.id)])];
    state.earnedTitles = earnedTitles;
    learning.unlocks = learning.unlocks.map(unlock => ({ ...unlock, earned: earnedTitles.includes(unlock.id) }));
    const usage = state.usage.sessionId === this.options.sessionId
      ? state.usage
      : state.usageHistory?.find(item => item.sessionId === this.options.sessionId) ?? state.usage;
    const calls = usage.sessionId === this.options.sessionId ? usage.calls : [];
    const contexts = usage.sessionId === this.options.sessionId ? usage.contexts : [];
    const context = contexts.toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at)).at(-1);
    const isCurrent = usage.sessionId === this.options.sessionId;
    const summary = summarizeUsage({ ...usage, calls, contexts });
    const history = state.usageHistory ?? [];
    const total = summarizeUsage({
      sessionId: null, syncedAt: history.map(item => item.syncedAt).filter((at): at is string => at !== null).sort().at(-1) ?? null,
      calls: history.flatMap(item => item.calls), contexts: [], diagnostics: []
    });
    let daily: AppView["daily"] = null, dailyError: AppView["dailyError"] = null;
    try { daily = dailyView(state, this.bank, now); }
    catch (error) {
      if (!(error instanceof BudError)) throw error;
      dailyError = { code: error.code, message: error.message };
    }
    return {
      development: this.options.development ?? false,
      today: dayFor(now, state.timezone),
      profile: {
        xp, level, levelStart: levelStart(level), nextLevel: levelStart(level + 1), streak: streak(state, now),
        learned: state.daily.filter(entry => entry.answered).length + Object.keys(state.learning.items).filter(key => key.startsWith("lesson:")).length, timezone: state.timezone,
        equipped: state.equipped, reflections: state.reflections
      },
      daily, dailyError,
      cosmetics: COSMETICS.map(item => ({ ...item, unlocked: item.skill ? earnedTitles.includes(item.id) : level >= item.level, equipped: state.equipped[item.slot] === item.id })),
      achievements: achievementViews(state, this.bank, now),
      review: this.review,
      learning,
      sessionInteraction: { available: this.sessionSender !== null, lastMessageId: this.lastMessageId },
      history: { sessions: history.map(summarizeUsage), totals: total, diagnostics: state.historyDiagnostics ?? [], nextOffset: state.historyNextOffset ?? null, totalDirectories: state.historyTotalDirectories ?? 0 },
      usage: {
        syncedAt: isCurrent ? usage.syncedAt : null, sessionAvailable: Boolean(this.options.sessionId), callCount: calls.length,
        input: sumCounter(calls, "input"), output: sumCounter(calls, "output"),
        cacheRead: sumCounter(calls, "cacheRead"), cacheWrite: sumCounter(calls, "cacheWrite"),
        context: context ? { current: context.current, limit: context.limit, at: context.at, basis: context.basis } : null,
        diagnostics: isCurrent ? usage.diagnostics : [],
        samples: summary.samples, tips: summary.tips, questions: summary.questions
      }
    };
  }

  close(): void { this.store.close(); }
  setSessionSender(sender: (prompt: string) => Promise<string>): void { this.sessionSender = sender; }
}
