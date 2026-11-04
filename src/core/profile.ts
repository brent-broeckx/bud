import { COSMETICS, levelFor } from "./catalog.js";
import { dailyEntry } from "./questions.js";
import { BudError, type Award, type DailyView, type ProfileState, type Question, type UsageCall } from "./types.js";

export function newProfile(now: Date, timezone: string): ProfileState {
  new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(now);
  return {
    version: 1, createdAt: now.toISOString(), timezone,
    daily: [], awards: [], reflections: [],
    equipped: { color: "fern", head: "sprout", outfit: "everyday", title: "curious" },
    usage: { calls: [], contexts: [], syncedAt: null, sessionId: null, diagnostics: [] }
  };
}

export function xpFor(state: ProfileState): number {
  return state.awards.reduce((total, award) => total + award.xp, 0);
}

export function awardOnce(state: ProfileState, award: Award): boolean {
  if (state.awards.some(existing => existing.id === award.id)) return false;
  if (!Number.isSafeInteger(award.xp) || award.xp < 0) throw new BudError("award", "XP must be a non-negative integer.");
  state.awards.push(award);
  return true;
}

export function dailyView(state: ProfileState, bank: readonly Question[], now: Date): DailyView {
  const entry = dailyEntry(state, bank, now);
  const q = bank.find(item => item.id === entry.questionId);
  if (!q) throw new BudError("question_missing", "Today's saved question is missing from this knowledge-bank version.");
  const { answerIndex, explanation, ...publicQuestion } = q;
  return {
    ...publicQuestion, day: entry.day, answered: entry.answered, selectedIndex: entry.selectedIndex, correct: entry.correct,
    ...(entry.answered ? { answerIndex, explanation } : {})
  };
}

export function submitAnswer(state: ProfileState, bank: readonly Question[], now: Date, questionId: unknown, day: unknown, answerIndex: unknown): void {
  const entry = dailyEntry(state, bank, now);
  if (questionId !== entry.questionId || day !== entry.day) throw new BudError("daily_changed", "This question is no longer today's discovery. Refresh before answering.");
  const q = bank.find(item => item.id === entry.questionId);
  if (!q) throw new BudError("question_missing", "Today's question is missing.");
  if (q.type === "quiz" && (typeof answerIndex !== "number" || !Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= q.options.length)) {
    throw new BudError("answer", "Choose one of the available answers.");
  }
  if (q.type === "did-you-know" && answerIndex !== null && answerIndex !== undefined) throw new BudError("answer", "A discovery does not take a quiz answer.");
  if (entry.answered) return;
  entry.answered = true;
  entry.selectedIndex = q.type === "quiz" ? answerIndex as number : null;
  entry.correct = q.type === "quiz" ? answerIndex === q.answerIndex : null;
  entry.item = { category: q.category, difficulty: q.difficulty, type: q.type };
  awardOnce(state, { id: `daily:${entry.day}`, xp: 20, at: now.toISOString(), evidence: `Learning acknowledged: ${q.id}` });
}

export function equipItem(state: ProfileState, itemId: unknown): void {
  const item = COSMETICS.find(item => item.id === itemId);
  if (!item) throw new BudError("cosmetic", "That cosmetic doesn't exist.");
  if (item.level > levelFor(xpFor(state))) throw new BudError("cosmetic_locked", `${item.name} unlocks at level ${item.level}.`);
  state.equipped[item.slot] = item.id;
}

export function sumCounter(calls: readonly UsageCall[], field: "input" | "output" | "cacheRead" | "cacheWrite"): { value: number | null; covered: number } {
  const known = calls.flatMap(call => call[field] === null ? [] : [call[field]]);
  const sum = known.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(sum)) throw new BudError("usage_overflow", "The imported token total is outside the safe integer range.");
  return { value: known.length ? sum : null, covered: known.length };
}
