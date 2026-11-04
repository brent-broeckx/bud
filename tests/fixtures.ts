import type { ProfileState, Question } from "../src/core/types.js";
export function newFixture(): ProfileState {
  return {
    version: 1, createdAt: "2026-11-04T10:00:00Z", timezone: "UTC", daily: [], awards: [],
    equipped: { color: "fern", head: "sprout", outfit: "everyday", title: "curious" },
    reflections: [], usage: { calls: [], contexts: [], syncedAt: null, sessionId: null, diagnostics: [] }
  };
}
export const bankFixture: Question[] = [
  { id: "a", category: "context", difficulty: "easy", type: "quiz", question: "Test?", options: ["A", "B"], answerIndex: 0, explanation: "A test fixture.", sourceUrl: "https://docs.github.com/test", verifiedOn: "2026-11-01", mayGoStale: false },
  { id: "b", category: "mcp", difficulty: "medium", type: "quiz", question: "Test two?", options: ["A", "B"], answerIndex: 1, explanation: "A test fixture.", sourceUrl: "https://docs.github.com/test", verifiedOn: "2026-11-01", mayGoStale: false },
  { id: "c", category: "habits", difficulty: "hard", type: "did-you-know", question: "Test three.", options: [], answerIndex: null, explanation: "A test fixture.", sourceUrl: "https://docs.github.com/test", verifiedOn: "2026-11-01", mayGoStale: false }
];
