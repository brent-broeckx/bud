import { BudError, type UsageState } from "./types.js";
import { sumCounter } from "./profile.js";

export interface UsageSummary {
  sessionId: string;
  syncedAt: string | null;
  callCount: number;
  input: { value: number | null; covered: number };
  output: { value: number | null; covered: number };
  cacheRead: { value: number | null; covered: number };
  cacheWrite: { value: number | null; covered: number };
  context: { current: number; limit: number; at: string; basis: string } | null;
  samples: { at: string; current: number; limit: number }[];
  diagnostics: string[];
  tips: { title: string; explanation: string; challengeId: string | null }[];
  questions: { question: string; answer: string }[];
}

export function summarizeUsage(usage: UsageState): UsageSummary {
  const contexts = usage.contexts.toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const latest = contexts.at(-1);
  const tips: UsageSummary["tips"] = [{
    title: "Tokens are not a quality score",
    explanation: "Larger tasks can need more context and output. Judge the result and verification, not the smallest token count.",
    challengeId: null
  }];
  if (latest) tips.push({
    title: latest.current / latest.limit >= 0.7 ? "Practise a session handoff" : "Choose context intentionally",
    explanation: latest.current / latest.limit >= 0.7
      ? "The latest reported sample uses at least 70% of its reported window. This is a coaching cue, not a compaction threshold or a reason you must restart. A handoff can help when switching tasks."
      : "This sample is a snapshot, not a peak. Relevant files and explicit acceptance criteria matter more than keeping the window empty.",
    challengeId: null
  });
  if (usage.calls.some(call => call.cacheRead !== null)) tips.push({
    title: "Understand cached context",
    explanation: "Cache-read tokens are provider-reported reuse. They do not prove a cache-hit rate, money saved, or that a prompt was effective.",
    challengeId: null
  });
  return {
    sessionId: usage.sessionId ?? "", syncedAt: usage.syncedAt, callCount: usage.calls.length,
    input: sumCounter(usage.calls, "input"), output: sumCounter(usage.calls, "output"),
    cacheRead: sumCounter(usage.calls, "cacheRead"), cacheWrite: sumCounter(usage.calls, "cacheWrite"),
    context: latest ? { current: latest.current, limit: latest.limit, at: latest.at, basis: latest.basis } : null,
    samples: contexts.slice(-60).map(({ at, current, limit }) => ({ at, current, limit })),
    diagnostics: usage.diagnostics, tips,
    questions: [
      ...(latest ? [{
        question: `Your latest context sample reports ${latest.current.toLocaleString("en-US")} of ${latest.limit.toLocaleString("en-US")} tokens. Does that tell you the session's peak usage?`,
        answer: "No. It is one reported snapshot. A handoff is useful when your task changes or context becomes difficult to manage, not just because a sample is large."
      }] : []),
      ...(usage.calls.some(call => call.cacheRead !== null) ? [{
        question: "Your import includes cache-read tokens. Can you use that number alone to calculate money saved?",
        answer: "No. Provider billing rules and a verified denominator are needed. Reuse is not a measured savings claim."
      }] : []),
      ...(usage.calls.length ? [{
        question: `This import contains ${usage.calls.length} reported calls. What would demonstrate that the task is complete?`,
        answer: "Passing acceptance checks and inspecting the result. Call counts and token totals cannot prove that a task succeeded."
      }] : [])
    ]
  };
}

export interface ReviewView {
  scope: "prompt" | "session";
  basis: string;
  reviewedPrompts: number;
  feedback: { title: string; detail: string; observed: boolean }[];
  exercise: string;
}

export function reviewPrompts(prompts: string[], scope: ReviewView["scope"]): ReviewView {
  if (!prompts.length || prompts.every(text => !text.trim())) throw new BudError("review_empty", "No readable user prompts were found to review.");
  const text = prompts.join("\n");
  const rules = [
    { title: "Make the outcome testable", expression: /\b(test|expect|acceptance|verify|must|should|result)\b/i, detail: "State what a successful result looks like and how to verify it." },
    { title: "Name the relevant context", expression: /\b(file|folder|function|class|repository|component|module)\b|[\\/]|\.\w{1,5}\b/i, detail: "Point to relevant files, functions, or examples instead of assuming Copilot knows which ones matter." },
    { title: "Set boundaries", expression: /\b(without|only|avoid|preserve|do not|don't|constraint|scope)\b/i, detail: "Describe what should stay unchanged and what is out of scope." },
    { title: "Explain the task", expression: /\b(fix|add|build|implement|explain|review|refactor|create|investigate)\b/i, detail: "Use a concrete action and explain the problem or desired behavior." }
  ];
  return {
    scope, basis: "Local keyword checklist, not an AI quality grade. A matching word does not establish a good prompt; an absent word does not establish a bad one.",
    reviewedPrompts: prompts.length,
    feedback: rules.map(rule => ({ title: rule.title, detail: rule.detail, observed: rule.expression.test(text) })),
    exercise: "Rewrite one request with: Goal, Relevant context, Constraints, Acceptance checks. Compare it with the original, then try it in Copilot."
  };
}
