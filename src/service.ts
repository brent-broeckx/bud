import { ProfileStore } from "./store.js";
import { COSMETICS, levelFor, levelStart } from "./core/catalog.js";
import { dailyEntry, dayFor, streak, validateQuestions } from "./core/questions.js";
import { dailyView, equipItem, newProfile, submitAnswer, sumCounter, xpFor } from "./core/profile.js";
import { achievementViews, evaluateAchievements } from "./core/achievements.js";
import { BudError, type ProfileState, type Question } from "./core/types.js";
import type { AppView } from "./core/view.js";
import { readCopilotUsage } from "./adapters/copilot.js";

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

  constructor(private readonly options: ServiceOptions) {
    this.bank = validateQuestions(options.questions);
    this.clock = options.clock ?? (() => new Date());
    this.store = new ProfileStore(options.directory, () => newProfile(this.clock(), options.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone));
  }

  async dispatch(action: string, raw: unknown = {}): Promise<AppView> {
    const input = object(raw);
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
          const stored = state.usage;
          if (stored.sessionId === usage.sessionId && stored.syncedAt && (
            Date.parse(stored.syncedAt) > Date.parse(usage.syncedAt!) ||
            (Date.parse(stored.syncedAt) === Date.parse(usage.syncedAt!) && stored.calls.length > usage.calls.length)
          )) {
            return this.view(state);
          }
          state.usage = usage;
          return this.view(state);
        });
      } finally { release(); }
    }
    return this.store.transaction(state => {
      const now = this.clock();
      if (["get_profile", "get_daily_question", "list_achievements"].includes(action)) keys(input, []);
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
    const usage = state.usage;
    const calls = usage.sessionId === this.options.sessionId ? usage.calls : [];
    const contexts = usage.sessionId === this.options.sessionId ? usage.contexts : [];
    const context = contexts.toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at)).at(-1);
    const isCurrent = usage.sessionId === this.options.sessionId;
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
        learned: state.daily.filter(entry => entry.answered).length, timezone: state.timezone,
        equipped: state.equipped, reflections: state.reflections
      },
      daily, dailyError,
      cosmetics: COSMETICS.map(item => ({ ...item, unlocked: level >= item.level, equipped: state.equipped[item.slot] === item.id })),
      achievements: achievementViews(state, this.bank, now),
      usage: {
        syncedAt: isCurrent ? usage.syncedAt : null, sessionAvailable: Boolean(this.options.sessionId), callCount: calls.length,
        input: sumCounter(calls, "input"), output: sumCounter(calls, "output"),
        cacheRead: sumCounter(calls, "cacheRead"), cacheWrite: sumCounter(calls, "cacheWrite"),
        context: context ? { current: context.current, limit: context.limit, at: context.at, basis: context.basis } : null,
        diagnostics: isCurrent ? usage.diagnostics : []
      }
    };
  }

  close(): void { this.store.close(); }
}
