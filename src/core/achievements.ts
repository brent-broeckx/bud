import type { AchievementView } from "./view.js";
import type { ProfileState, Question } from "./types.js";
import { awardOnce } from "./profile.js";
import { dayFor, eligibleQuestions } from "./questions.js";

type LearningItem = Pick<Question, "category" | "difficulty" | "type">;

interface Rule {
  id: string;
  name: string;
  description: string;
  xp: number;
  evidence: string;
  eligible: (state: ProfileState, answered: readonly LearningItem[], correct: readonly LearningItem[]) => boolean;
}

const RULES: readonly Rule[] = [
  { id: "first-steps", name: "First little step", description: "Make time for your first daily discovery.", xp: 10, evidence: "First acknowledged learning item", eligible: (_, answered) => answered.length > 0 },
  { id: "curious-explorer", name: "Curious explorer", description: "Discover something in all seven learning categories.", xp: 30, evidence: "Seven distinct categories", eligible: (_, answered) => new Set(answered.map(q => q.category)).size === 7 },
  { id: "deep-diver", name: "Deep diver", description: "Answer five different hard questions correctly on your first encounter.", xp: 40, evidence: "Five distinct first-encounter answers", eligible: (_, __, correct) => correct.filter(q => q.difficulty === "hard").length >= 5 },
  { id: "fact-finder", name: "Fact finder", description: "Acknowledge ten different nice-to-know discoveries.", xp: 20, evidence: "Ten explicitly acknowledged facts", eligible: (_, answered) => answered.filter(q => q.type === "did-you-know").length >= 10 },
  { id: "steady-learner", name: "Steady learner", description: "Learn on seven different days. They don't have to be consecutive.", xp: 50, evidence: "Seven learning days; no streak pressure", eligible: state => new Set(state.daily.filter(d => d.answered).map(d => d.day)).size >= 7 },
  { id: "reflector", name: "Thoughtful tinkerer", description: "Acknowledge a good habit on three different days.", xp: 15, evidence: "Self-reported, not measured efficiency", eligible: state => new Set(state.reflections.map(r => r.id.split(":").at(-1))).size >= 3 },
  { id: "context-aware", name: "Context explorer", description: "Answer five different context or caching questions correctly on your first encounter.", xp: 25, evidence: "Five distinct first-encounter answers", eligible: (_, __, correct) => correct.filter(q => q.category === "context" || q.category === "caching").length >= 5 }
];

function history(state: ProfileState, bank: readonly Question[]) {
  const first = new Map<string, { item: LearningItem; correct: boolean | null }>();
  for (const entry of state.daily) {
    const item = entry.item ?? bank.find(q => q.id === entry.questionId);
    if (entry.answered && item && !first.has(entry.questionId)) first.set(entry.questionId, { item, correct: entry.correct });
  }
  return first;
}

export function evaluateAchievements(state: ProfileState, bank: readonly Question[], now: Date): void {
  const first = history(state, bank);
  const answered = [...first.values()].map(entry => entry.item);
  const correct = [...first.values()].filter(entry => entry.correct === true).map(entry => entry.item);
  for (const rule of RULES) {
    if (rule.eligible(state, answered, correct)) {
      awardOnce(state, { id: `achievement:${rule.id}`, xp: rule.xp, at: now.toISOString(), evidence: rule.evidence });
    }
  }
}

export function achievementViews(state: ProfileState, bank: readonly Question[], now: Date): AchievementView[] {
  const first = history(state, bank);
  const eligible = eligibleQuestions(bank, dayFor(now, state.timezone));
  const unseen = eligible.filter(q => !first.has(q.id));
  const possibleAnswered = [...first.values()].map(entry => entry.item).concat(unseen);
  const possibleCorrect = [...first.values()].filter(entry => entry.correct === true).map(entry => entry.item).concat(unseen.filter(q => q.type === "quiz"));
  return [
    ...RULES.map(rule => {
      const unlocked = state.awards.some(a => a.id === `achievement:${rule.id}`);
      const possible = rule.id === "steady-learner" ? eligible.length > 0 : rule.id === "reflector" ? true : rule.eligible(state, possibleAnswered, possibleCorrect);
      return {
        id: rule.id, name: rule.name, description: rule.description, xp: rule.xp,
        evidence: !unlocked && !possible ? "Not enough eligible first encounters remain; new verified content is needed" : rule.evidence,
        unlocked, unavailable: !unlocked && !possible
      };
    }),
    { id: "cache-gardener", name: "Cache gardener", description: "Keep a high cache-hit streak.", xp: 0, unlocked: false, unavailable: true, evidence: "Cache denominator and complete coverage are not verified" },
    { id: "light-traveler", name: "Light traveler", description: "Finish a task below half the context window.", xp: 0, unlocked: false, unavailable: true, evidence: "Sparse samples cannot prove a whole-task threshold" },
    { id: "lean-tools", name: "A lighter toolkit", description: "Disable an MCP server that was genuinely unused.", xp: 0, unlocked: false, unavailable: true, evidence: "Configuration changes and a complete usage window are not measured" }
  ];
}
