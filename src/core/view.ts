import type { Cosmetic, DailyView, ProfileState } from "./types.js";
import type { ReviewView, UsageSummary } from "./coaching.js";
import type { LearningView } from "./learning.js";

export interface AchievementView {
  id: string;
  name: string;
  description: string;
  xp: number;
  unlocked: boolean;
  evidence: string;
  unavailable: boolean;
}

export interface AppView {
  development: boolean;
  profile: {
    xp: number;
    level: number;
    levelStart: number;
    nextLevel: number;
    streak: number;
    learned: number;
    timezone: string;
    equipped: ProfileState["equipped"];
    reflections: ProfileState["reflections"];
  };
  daily: DailyView | null;
  dailyError: { code: string; message: string } | null;
  today: string;
  cosmetics: (Cosmetic & { unlocked: boolean; equipped: boolean })[];
  achievements: AchievementView[];
  review: ReviewView | null;
  learning: LearningView;
  sessionInteraction: { available: boolean; lastMessageId: string | null };
  history: {
    sessions: UsageSummary[];
    totals: UsageSummary;
    diagnostics: string[];
    nextOffset: number | null;
    totalDirectories: number;
  };
  usage: {
    syncedAt: string | null;
    sessionAvailable: boolean;
    callCount: number;
    input: { value: number | null; covered: number };
    output: { value: number | null; covered: number };
    cacheRead: { value: number | null; covered: number };
    cacheWrite: { value: number | null; covered: number };
    context: { current: number; limit: number; at: string; basis: string } | null;
    diagnostics: string[];
    samples: UsageSummary["samples"];
    tips: UsageSummary["tips"];
    questions: UsageSummary["questions"];
  };
}
