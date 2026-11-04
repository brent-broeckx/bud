import type { LearningState } from "./learning.js";

export type Category = "context" | "caching" | "tokenization" | "agents" | "mcp" | "sdk" | "habits";
export type Difficulty = "easy" | "medium" | "hard";

export interface Question {
  id: string;
  category: Category;
  difficulty: Difficulty;
  type: "quiz" | "did-you-know";
  question: string;
  options: string[];
  answerIndex: number | null;
  explanation: string;
  sourceUrl: string;
  verifiedOn: string;
  mayGoStale: boolean;
}

export interface DailyEntry {
  day: string;
  questionId: string;
  answered: boolean;
  selectedIndex: number | null;
  correct: boolean | null;
  item?: Pick<Question, "category" | "difficulty" | "type">;
}

export interface Award {
  id: string;
  xp: number;
  at: string;
  evidence: string;
}

export type Slot = "color" | "head" | "outfit" | "title";
export interface Cosmetic {
  id: string;
  name: string;
  slot: Slot;
  level: number;
  value: string;
  skill?: string;
}

export interface UsageCall {
  id: string;
  sessionId: string;
  at: string;
  eventType: string;
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  cacheDetailsReported: boolean | null;
}

export interface ContextSample {
  id: string;
  sessionId: string;
  at: string;
  current: number;
  limit: number;
  basis: "session.usage_info" | "tool-telemetry";
}

export interface UsageState {
  calls: UsageCall[];
  contexts: ContextSample[];
  syncedAt: string | null;
  sessionId: string | null;
  diagnostics: string[];
}

export interface ProfileState {
  version: 1;
  createdAt: string;
  timezone: string;
  daily: DailyEntry[];
  awards: Award[];
  equipped: Record<Slot, string>;
  reflections: { id: string; kind: "fresh-session" | "lean-instructions" | "mcp-cleanup"; at: string }[];
  usage: UsageState;
  usageHistory?: UsageState[];
  historyDiagnostics?: string[];
  historyNextOffset?: number | null;
  historyTotalDirectories?: number;
  learning?: LearningState;
  earnedTitles?: string[];
  learningDays?: string[];
}

export interface DailyView extends Omit<Question, "answerIndex" | "explanation"> {
  day: string;
  answered: boolean;
  selectedIndex: number | null;
  correct: boolean | null;
  answerIndex?: number | null;
  explanation?: string;
}

export class BudError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "BudError";
  }
}
