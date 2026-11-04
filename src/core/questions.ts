import { BudError, type Category, type DailyEntry, type ProfileState, type Question } from "./types.js";

const categories: readonly Category[] = ["context", "caching", "tokenization", "agents", "mcp", "sdk", "habits"];

export function validateQuestions(raw: unknown): Question[] {
  if (!Array.isArray(raw) || !raw.length) throw new BudError("question_bank", "The knowledge bank is empty.");
  const seen = new Set<string>();
  for (const q of raw) {
    if (!q || typeof q !== "object" || typeof q.id !== "string" || seen.has(q.id) ||
      !categories.includes(q.category) || !["easy", "medium", "hard"].includes(q.difficulty) ||
      !["quiz", "did-you-know"].includes(q.type) || typeof q.question !== "string" || !q.question.trim() ||
      typeof q.explanation !== "string" || !q.explanation.trim() || !Array.isArray(q.options) ||
      q.options.some((option: unknown) => typeof option !== "string" || !option.trim()) ||
      new Set(q.options).size !== q.options.length ||
      typeof q.sourceUrl !== "string" || !/^https:\/\//.test(q.sourceUrl) ||
      typeof q.verifiedOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(q.verifiedOn) ||
      Number.isNaN(Date.parse(q.verifiedOn)) || new Date(q.verifiedOn).toISOString().slice(0, 10) !== q.verifiedOn || typeof q.mayGoStale !== "boolean" ||
      (q.type === "quiz" && (q.options.length < 2 || !Number.isInteger(q.answerIndex) || q.answerIndex < 0 || q.answerIndex >= q.options.length)) ||
      (q.type === "did-you-know" && (q.options.length !== 0 || q.answerIndex !== null))) {
      throw new BudError("question_bank", "A knowledge-bank item is invalid or duplicated.");
    }
    seen.add(q.id);
  }
  return raw as Question[];
}

export function dayFor(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find(part => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function dayDistance(a: string, b: string): number {
  return (Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000;
}

export function eligibleQuestions(bank: readonly Question[], day: string): Question[] {
  return bank.filter(q => (!q.mayGoStale || dayDistance(q.verifiedOn, day) <= 90) && q.verifiedOn <= day);
}

function hash(value: string): number {
  let result = 2166136261;
  for (const ch of value) result = Math.imul(result ^ ch.charCodeAt(0), 16777619) >>> 0;
  return result;
}

export function dailyEntry(state: ProfileState, bank: readonly Question[], now: Date): DailyEntry {
  const day = dayFor(now, state.timezone);
  const latest = state.daily.at(-1);
  if (latest && latest.day > day) throw new BudError("clock_rollback", "Your clock moved backwards. Restore the current date before claiming daily learning.");
  const existing = state.daily.find(entry => entry.day === day);
  if (existing) return existing;
  const eligible = eligibleQuestions(bank, day);
  const recentEntries = eligible.length > 1 ? state.daily.slice(-(eligible.length - 1)) : [];
  const used = new Set(recentEntries.map(entry => entry.questionId));
  const available = eligible.filter(q => !used.has(q.id));
  if (!available.length) throw new BudError("content_stale", "No fresh learning items are available. Update Bud's verified knowledge bank.");
  const recent = state.daily.slice(-2).map(entry => bank.find(q => q.id === entry.questionId));
  const preferredDifficulty = (["easy", "medium", "hard"] as const)[state.daily.length % 3];
  const ranked = available.map(q => ({
    q,
    rank: (recent.some(r => r?.category === q.category) ? 2 : 0) + (q.difficulty === preferredDifficulty ? 0 : 1)
  }));
  ranked.sort((a, b) => a.rank - b.rank || hash(day + a.q.id) - hash(day + b.q.id) || a.q.id.localeCompare(b.q.id));
  const selected = ranked[0];
  if (!selected) throw new BudError("question_bank", "No daily question could be selected.");
  const entry: DailyEntry = { day, questionId: selected.q.id, answered: false, selectedIndex: null, correct: null };
  state.daily.push(entry);
  return entry;
}

export function streak(state: ProfileState, now: Date): number {
  const days = [...new Set([...state.daily.filter(entry => entry.answered).map(entry => entry.day), ...(state.learningDays ?? [])])].sort();
  const last = days.at(-1);
  if (!last || ![0, 1].includes(dayDistance(last, dayFor(now, state.timezone)))) return 0;
  let count = 1;
  for (let i = days.length - 2; i >= 0; i--) {
    const current = days[i], next = days[i + 1];
    if (!current || !next || dayDistance(current, next) !== 1) break;
    count++;
  }
  return count;
}
