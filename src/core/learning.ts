import { dayFor, eligibleQuestions } from "./questions.js";
import { BudError, type Category, type Question } from "./types.js";

export type LearningPathId = "prompting" | "context" | "agents" | "tools";
export type Experience = "beginner" | "experienced";
export type ItemStatus = "new" | "completed" | "revisit" | "mastered";

export interface ItemRecord {
  attempts: number;
  completedOn: string;
  everCorrect: boolean;
  missedOn: string | null;
  recoveredOn: string | null;
}

export interface Attempt {
  key: string;
  day: string;
  at: string;
  selectedIndex: number | null;
  correct: boolean | null;
}

export interface ActiveAttempt {
  id: string;
  answered: boolean;
  selectedIndex: number | null;
  correct: boolean | null;
}

export interface LearningState {
  version: 1;
  experience: Experience | null;
  items: Record<string, ItemRecord>;
  history: Attempt[];
  activeLesson: ActiveAttempt | null;
  activeChallenge: ActiveAttempt | null;
}

export interface LessonSummary extends Pick<Question, "id" | "category" | "difficulty" | "type" | "question" | "sourceUrl" | "verifiedOn"> {
  path: LearningPathId;
  status: ItemStatus;
}

export interface ActiveLessonView extends Omit<Question, "answerIndex" | "explanation"> {
  path: LearningPathId;
  status: ItemStatus;
  answered: boolean;
  selectedIndex: number | null;
  correct: boolean | null;
  answerIndex?: number | null;
  explanation?: string;
}

export interface ChallengeSummary {
  id: string;
  kind: "practice" | "real";
  path: LearningPathId;
  skill: string;
  difficulty: Experience;
  title: string;
  summary: string;
  xp: number;
  status: ItemStatus;
  evidence: string;
  suggested: boolean;
}

export interface ActivePracticeView extends Omit<ChallengeSummary, "kind" | "suggested"> {
  kind: "practice";
  scenario: string;
  options: string[];
  hint: string;
  answered: boolean;
  selectedIndex: number | null;
  correct: boolean | null;
  answerIndex?: number;
  explanation?: string;
}

export interface ActiveRealView extends Omit<ChallengeSummary, "kind" | "suggested"> {
  kind: "real";
  launchPrompt: string;
  checklist: { id: string; label: string }[];
  hint: string;
  completed: boolean;
  feedback?: string;
}

export interface PathView {
  id: LearningPathId;
  title: string;
  description: string;
  lessons: LessonSummary[];
  lessonsCompleted: number;
  challengesCompleted: number;
  challengesTotal: number;
  skillLevel: 0 | 1 | 2 | 3;
  skillName: string;
}

export interface RevisitItem {
  id: string;
  kind: "lesson" | "practice";
  path: LearningPathId;
  title: string;
  missedOn: string;
  due: boolean;
}

export interface UnlockView {
  id: string;
  name: string;
  path: LearningPathId;
  earned: boolean;
  requirement: string;
}

export interface LearningView {
  experience: Experience | null;
  today: string;
  paths: PathView[];
  activeLesson: ActiveLessonView | null;
  challenges: ChallengeSummary[];
  activeChallenge: ActivePracticeView | ActiveRealView | null;
  revisit: RevisitItem[];
  progress: {
    lessonsCompleted: number;
    lessonsAvailable: number;
    practiceCompleted: number;
    practiceTotal: number;
    realCompleted: number;
    realTotal: number;
    mastered: number;
    due: number;
  };
  unlocks: UnlockView[];
  recommended: { lessonId: string | null; challengeId: string | null };
  recent: Attempt[];
}

export interface LearningAward {
  id: string;
  xp: number;
  evidence: string;
}

interface PathDef { id: LearningPathId; title: string; description: string; categories: readonly Category[]; unlock: { id: string; name: string } }
interface ChallengeBase { id: string; path: LearningPathId; skill: string; difficulty: Experience; title: string; summary: string; hint: string; xp: number }
interface PracticeDef extends ChallengeBase { kind: "practice"; scenario: string; options: string[]; answerIndex: number; explanation: string }
interface RealDef extends ChallengeBase { kind: "real"; launchPrompt: string; checklist: { id: string; label: string }[]; feedback: string }
type ChallengeDef = PracticeDef | RealDef;

const LESSON_XP = 10;
const MASTERY_XP = 10;
const HISTORY_LIMIT = 200;
const SKILL_NAMES = ["Not started", "Sprouting", "Growing", "Rooted"] as const;
const PRACTICE_EVIDENCE = "First attempt at an authored practice exercise; correctness not required";
const REAL_EVIDENCE = "Self-reported: you confirmed the checklist. Bud did not run, watch or review the session";

export const LEARNING_PATHS: readonly PathDef[] = [
  { id: "prompting", title: "Prompting & planning", description: "Ask for specific, checkable work and agree on a plan before large changes.", categories: ["habits"], unlock: { id: "prompt-smith", name: "Prompt smith" } },
  { id: "context", title: "Context", description: "Give the model what it needs, leave out what it doesn't, and hand work over cleanly.", categories: ["context", "caching", "tokenization"], unlock: { id: "context-keeper", name: "Context keeper" } },
  { id: "agents", title: "Agents & verification", description: "Delegate deliberately and prove changes with tests instead of trusting summaries.", categories: ["agents"], unlock: { id: "agent-wrangler", name: "Agent wrangler" } },
  { id: "tools", title: "Tools & MCP", description: "Pick the right tool for live data and keep the toolkit lean.", categories: ["mcp", "sdk"], unlock: { id: "tool-tinkerer", name: "Tool tinkerer" } }
];

export const CHALLENGES: readonly ChallengeDef[] = [
  {
    kind: "practice", id: "practice-prompt-rewrite", path: "prompting", skill: "Specific asks", difficulty: "beginner", xp: 15,
    title: "Rewrite a vague prompt", summary: "Pick the prompt most likely to produce a focused, verifiable fix.",
    scenario: "A login test is flaky. Which prompt is most likely to get a focused change you can check?",
    options: [
      "Fix the tests.",
      "Login is broken, please look at everything and improve it.",
      "In tests/login.test.ts, 'rejects expired token' times out about 1 in 5 runs. Find the cause, fix it without weakening the assertion, then run that file 10 times and report the results.",
      "Rewrite the login module using best practices."
    ],
    answerIndex: 2,
    hint: "Look for the prompt that names a location, a symptom, a constraint and a way to check the result.",
    explanation: "A good request names where the problem is, what you observe, what must not change, and how success is checked. The other prompts invite guessing or broad rewrites that are hard to review."
  },
  {
    kind: "practice", id: "practice-plan-first", path: "prompting", skill: "Planning", difficulty: "experienced", xp: 15,
    title: "Plan before a multi-file change", summary: "Choose the safest first step for a migration that touches many files.",
    scenario: "You need to move every API handler from callbacks to async/await across about 30 files. What is the best first request?",
    options: [
      "Start editing all files right away and tell me when you are done.",
      "Propose a plan first: the order of steps, which files each step touches, the risks, and how each step will be verified. Wait for my review before editing.",
      "Do everything in one large change so it is consistent.",
      "Write the code first; we can work out the plan afterwards."
    ],
    answerIndex: 1,
    hint: "Which option gives you a checkpoint before any file changes?",
    explanation: "A reviewed plan lets you catch wrong assumptions while they are cheap to fix, split the work into verifiable steps, and keep each diff small enough to review."
  },
  {
    kind: "practice", id: "practice-relevant-context", path: "context", skill: "Choosing context", difficulty: "beginner", xp: 15,
    title: "Choose relevant context", summary: "Decide what to share for a narrow formatting bug.",
    scenario: "Invoice PDFs show dates as 2026-13-01. What context is most useful to give Copilot?",
    options: [
      "Attach the whole repository so nothing is missed.",
      "The date formatting function, one failing input with the actual and expected output, and the error or wrong result you see.",
      "Yesterday's entire chat transcript about an unrelated feature.",
      "A link to the company wiki home page."
    ],
    answerIndex: 1,
    hint: "Think about what someone fixing this bug would need, and what would only distract them.",
    explanation: "Focused context (the relevant code plus a concrete failing example) leaves room in the context window and points the model at the actual problem. Unrelated material costs context and can mislead."
  },
  {
    kind: "practice", id: "practice-handoff", path: "context", skill: "Session handoff", difficulty: "experienced", xp: 15,
    title: "Write a useful handoff", summary: "Choose a handoff note for continuing work in a fresh session.",
    scenario: "A long refactoring session is close to its context limit and you plan to continue in a fresh session. Which handoff is best?",
    options: [
      "\"Continue where we left off.\"",
      "Paste the entire previous transcript into the new session.",
      "A short note with the goal, decisions made and why, files changed, current test status, the next concrete step, and open questions.",
      "Only the list of changed files."
    ],
    answerIndex: 2,
    hint: "A new session knows nothing. What is the smallest note that still lets it continue correctly?",
    explanation: "A fresh session has none of the earlier conversation. A compact, structured note carries the decisions and state that matter without spending context on the full history."
  },
  {
    kind: "practice", id: "practice-regression", path: "agents", skill: "Regression tests", difficulty: "beginner", xp: 15,
    title: "Prove a fix", summary: "Decide what to ask for before accepting an agent's bug fix.",
    scenario: "An agent says it fixed a bug where a discount was applied twice. What should you ask for before accepting it?",
    options: [
      "Nothing; the summary says it is fixed.",
      "A test that fails on the old code and passes on the new code, plus a run of the related test suite.",
      "Ask the agent to \"make sure it works\".",
      "A longer summary of the change."
    ],
    answerIndex: 1,
    hint: "Which option gives you evidence instead of a claim?",
    explanation: "A regression test that fails before the fix and passes after shows the bug is really addressed and keeps it from coming back. Running the related suite checks nothing nearby broke."
  },
  {
    kind: "practice", id: "practice-delegate", path: "agents", skill: "Delegation", difficulty: "experienced", xp: 15,
    title: "When to delegate", summary: "Recognise a task that suits a separate agent.",
    scenario: "When is handing a task to a separate agent or subagent most likely to go well?",
    options: [
      "When the task is self-contained, has a clear stopping point, and you can give it all the context it needs.",
      "When you are not yet sure what you want.",
      "For every one-line change, to save time.",
      "When the task depends on decisions you haven't made yet."
    ],
    answerIndex: 0,
    hint: "A separate agent starts without your conversation. What does it need to succeed alone?",
    explanation: "Delegated agents work from the brief you give them. Clear scope, a stopping point and complete context make the result predictable; open decisions and vague goals lead to rework."
  },
  {
    kind: "practice", id: "practice-tool-choice", path: "tools", skill: "Tool fit", difficulty: "beginner", xp: 15,
    title: "Pick a tool for live data", summary: "Choose how to answer a question about current repository data.",
    scenario: "You want to know which open issues in your GitHub repository mention \"timeout\". What is the most reliable approach?",
    options: [
      "Ask the model to recall the issues from memory.",
      "Have Copilot use a GitHub tool or the gh CLI to search the repository's current issues.",
      "Paste every issue into the chat by hand.",
      "Enable every MCP server you have, just in case."
    ],
    answerIndex: 1,
    hint: "Can a model's training data know about issues opened this week?",
    explanation: "Questions about current data need a tool that reads the live source. A model's memory can be outdated or invented, and manual copying wastes context."
  },
  {
    kind: "practice", id: "practice-lean-tools", path: "tools", skill: "Lean toolkit", difficulty: "experienced", xp: 15,
    title: "Keep the toolkit lean", summary: "Understand the cost of tools you don't use.",
    scenario: "You have many MCP servers enabled but use only one for this project. What is the most accurate concern?",
    options: [
      "There is no effect; unused tools are free.",
      "Tool definitions can take up context and give the model more choices to pick wrongly, so disable servers you don't need for this work.",
      "More tools always make the model faster.",
      "Every enabled server is required for security."
    ],
    answerIndex: 1,
    hint: "Where does the model learn which tools exist?",
    explanation: "The model is told about available tools, and those descriptions use context. Fewer, relevant tools leave more room for your task and reduce wrong tool choices."
  },
  {
    kind: "real", id: "real-handoff", path: "context", skill: "Session handoff", difficulty: "beginner", xp: 40,
    title: "Write a real handoff note", summary: "Ask Copilot for a handoff note in a session you are actually working in.",
    launchPrompt: "Before we wrap up, write a handoff note for a fresh session: the goal, decisions made and why, files changed, current test status, the next concrete step, and open questions. Keep it under 200 words. Do not edit any files.",
    checklist: [
      { id: "goal", label: "The note states the goal of the work" },
      { id: "decisions", label: "It lists decisions with the reasons behind them" },
      { id: "tests", label: "It states the current test status" },
      { id: "next-step", label: "It names one concrete next step" },
      { id: "read", label: "I read it and could continue the work from it alone" }
    ],
    hint: "Run this near the end of a real working session, then read the note as if you had never seen the conversation.",
    feedback: "Handoffs turn a long session into a few hundred words a fresh session can use. Keep the note with the work so you can start the next session with it."
  },
  {
    kind: "real", id: "real-testable-brief", path: "prompting", skill: "Specific asks", difficulty: "beginner", xp: 40,
    title: "Turn a vague ask into a testable brief", summary: "Agree on acceptance criteria before any code is written.",
    launchPrompt: "Help me turn this request into a testable brief before writing any code: <describe your task here>. Ask me clarifying questions first, then write: the goal, what is out of scope, acceptance criteria as checkable statements, and how each criterion will be verified. Do not edit any files.",
    checklist: [
      { id: "questions", label: "I answered Copilot's clarifying questions" },
      { id: "scope", label: "The brief says what is out of scope" },
      { id: "criteria", label: "Each acceptance criterion can be checked as true or false" },
      { id: "verification", label: "Each criterion has a way to verify it" }
    ],
    hint: "Replace the placeholder with a task you really have. Small tasks work well.",
    feedback: "A brief with checkable criteria gives both you and Copilot a clear finish line and makes review faster."
  },
  {
    kind: "real", id: "real-plan-review", path: "agents", skill: "Planning", difficulty: "experienced", xp: 40,
    title: "Review a plan before execution", summary: "Have Copilot stop after planning so you can challenge it.",
    launchPrompt: "Propose a step-by-step plan for <describe your task here>. For each step list the files you would touch, the risks, and how the step will be verified. Stop after the plan and wait for my review; do not edit any files yet.",
    checklist: [
      { id: "read-plan", label: "I read the whole plan" },
      { id: "challenged", label: "I questioned or changed at least one step or assumption" },
      { id: "verification", label: "Every step says how it will be verified" },
      { id: "approved", label: "I approved or revised the plan before any files were edited" }
    ],
    hint: "Look for steps that are too large to review, or assumptions about code you haven't confirmed.",
    feedback: "Reviewing a plan is the cheapest point to catch a wrong approach. A step you can't verify is a step you can't trust."
  },
  {
    kind: "real", id: "real-regression-test", path: "agents", skill: "Regression tests", difficulty: "experienced", xp: 40,
    title: "Lock a fix with a regression test", summary: "See a test fail before the fix and pass after it.",
    launchPrompt: "For this bug: <describe the bug here>. First write a test that reproduces it and show me it failing on the current code. Then fix the bug and show the same test passing, along with the related test suite.",
    checklist: [
      { id: "failed-first", label: "I saw the new test fail before the fix" },
      { id: "passed-after", label: "I saw the same test pass after the fix" },
      { id: "suite", label: "The related test suite ran and passed" },
      { id: "reviewed", label: "I checked that the test asserts the behaviour, not implementation details" }
    ],
    hint: "Copilot will edit files for this one, in your session and with your approval. Bud does not run it.",
    feedback: "A test that failed before the fix is evidence the bug was real and is now covered. Without the failing run, a passing test may prove nothing."
  },
  {
    kind: "real", id: "real-tool-audit", path: "tools", skill: "Lean toolkit", difficulty: "beginner", xp: 40,
    title: "Audit tools for a task", summary: "Check which tools a task really needs.",
    launchPrompt: "List the tools and MCP servers available in this session. For this task: <describe your task here>, tell me which ones are likely needed and which are not, and why. Do not change any configuration.",
    checklist: [
      { id: "reviewed", label: "I reviewed the list of available tools" },
      { id: "unneeded", label: "I identified at least one tool or server not needed for this task" },
      { id: "decided", label: "I decided myself whether to disable anything" }
    ],
    hint: "Bud doesn't change or inspect your configuration; the decision stays with you.",
    feedback: "Knowing what each enabled tool is for makes it easier to keep context lean and spot when the model picks the wrong one."
  }
];

function pathFor(category: Category): LearningPathId {
  const path = LEARNING_PATHS.find(p => p.categories.includes(category));
  if (!path) throw new BudError("learning_path", "A knowledge-bank category has no learning path.");
  return path.id;
}

function statusOf(record: ItemRecord | undefined): ItemStatus {
  if (!record) return "new";
  if (record.recoveredOn) return "mastered";
  if (record.missedOn) return "revisit";
  return "completed";
}

function lessonRank(q: Pick<Question, "difficulty">, experience: Experience | null): number {
  const order = experience === "experienced" ? ["hard", "medium", "easy"] : ["easy", "medium", "hard"];
  return order.indexOf(q.difficulty);
}

function inputObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new BudError("learning_input", "Learning input must be an object.");
  return input as Record<string, unknown>;
}

function stringField(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value) throw new BudError("learning_input", `${key} must be a non-empty string.`);
  return value;
}

function eligibleLesson(bank: readonly Question[], day: string, questionId: string): Question {
  const q = bank.find(item => item.id === questionId);
  if (!q) throw new BudError("lesson_missing", "That lesson doesn't exist in this knowledge-bank version.");
  if (!eligibleQuestions(bank, day).includes(q)) throw new BudError("content_stale", "That lesson is not currently verified. Choose another one.");
  return q;
}

function challengeDef(challengeId: string): ChallengeDef {
  const challenge = CHALLENGES.find(c => c.id === challengeId);
  if (!challenge) throw new BudError("challenge_missing", "That challenge doesn't exist.");
  return challenge;
}

function today(state: LearningState, now: Date, timezone: string): string {
  const day = dayFor(now, timezone);
  const last = state.history.at(-1);
  if (last && last.day > day) throw new BudError("clock_rollback", "Your clock moved backwards. Restore the current date before continuing.");
  return day;
}

function record(state: LearningState, key: string, day: string, now: Date, selectedIndex: number | null, correct: boolean | null): "first" | "recovered" | null {
  state.history.push({ key, day, at: now.toISOString(), selectedIndex, correct });
  if (state.history.length > HISTORY_LIMIT) state.history.splice(0, state.history.length - HISTORY_LIMIT);
  const existing = state.items[key];
  if (!existing) {
    state.items[key] = { attempts: 1, completedOn: day, everCorrect: correct === true, missedOn: correct === false ? day : null, recoveredOn: null };
    return "first";
  }
  existing.attempts++;
  if (correct === false && !existing.everCorrect && existing.missedOn === null) existing.missedOn = day;
  if (correct === true) {
    const recovers = existing.missedOn !== null && existing.recoveredOn === null && day > existing.missedOn;
    existing.everCorrect = true;
    if (recovers) {
      existing.recoveredOn = day;
      return "recovered";
    }
  }
  return null;
}

function answerIndexFor(input: Record<string, unknown>, options: number): number {
  const value = input.answerIndex;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value >= options) throw new BudError("answer", "Choose one of the available answers.");
  return value;
}

export function newLearningState(): LearningState {
  return { version: 1, experience: null, items: {}, history: [], activeLesson: null, activeChallenge: null };
}

export function learningView(state: LearningState, bank: Question[], now: Date, timezone = "UTC"): LearningView {
  const day = dayFor(now, timezone);
  const eligible = eligibleQuestions(bank, day);
  const experience = state.experience;
  const lessons: LessonSummary[] = eligible
    .map(q => ({ id: q.id, category: q.category, difficulty: q.difficulty, type: q.type, question: q.question, sourceUrl: q.sourceUrl, verifiedOn: q.verifiedOn, path: pathFor(q.category), status: statusOf(state.items[`lesson:${q.id}`]) }))
    .sort((a, b) => lessonRank(a, experience) - lessonRank(b, experience) || a.id.localeCompare(b.id));
  const challenges: ChallengeSummary[] = CHALLENGES.map(c => ({
    id: c.id, kind: c.kind, path: c.path, skill: c.skill, difficulty: c.difficulty, title: c.title, summary: c.summary, xp: c.xp,
    status: statusOf(state.items[`${c.kind}:${c.id}`]), evidence: c.kind === "real" ? REAL_EVIDENCE : PRACTICE_EVIDENCE,
    suggested: experience === null ? c.difficulty === "beginner" : c.difficulty === experience
  }));

  const revisit: RevisitItem[] = [];
  for (const lesson of lessons) {
    const rec = state.items[`lesson:${lesson.id}`];
    if (rec?.missedOn && !rec.recoveredOn) revisit.push({ id: lesson.id, kind: "lesson", path: lesson.path, title: lesson.question, missedOn: rec.missedOn, due: day > rec.missedOn });
  }
  for (const c of CHALLENGES) {
    const rec = state.items[`practice:${c.id}`];
    if (c.kind === "practice" && rec?.missedOn && !rec.recoveredOn) revisit.push({ id: c.id, kind: "practice", path: c.path, title: c.title, missedOn: rec.missedOn, due: day > rec.missedOn });
  }

  const paths: PathView[] = LEARNING_PATHS.map(p => {
    const pathLessons = lessons.filter(l => l.path === p.id);
    const pathChallenges = challenges.filter(c => c.path === p.id);
    const lessonsCompleted = pathLessons.filter(l => l.status !== "new").length;
    const challengesCompleted = pathChallenges.filter(c => c.status !== "new").length;
    const total = lessonsCompleted + challengesCompleted;
    const realDone = pathChallenges.some(c => c.kind === "real" && c.status !== "new");
    const skillLevel = realDone && total >= 6 ? 3 : total >= 3 ? 2 : total >= 1 ? 1 : 0;
    return { id: p.id, title: p.title, description: p.description, lessons: pathLessons, lessonsCompleted, challengesCompleted, challengesTotal: pathChallenges.length, skillLevel, skillName: SKILL_NAMES[skillLevel] };
  });

  const unlocks: UnlockView[] = LEARNING_PATHS.map(p => {
    const path = paths.find(view => view.id === p.id);
    const realDone = challenges.some(c => c.path === p.id && c.kind === "real" && c.status !== "new");
    return {
      id: p.unlock.id, name: p.unlock.name, path: p.id,
      earned: realDone && !!path && path.lessonsCompleted + path.challengesCompleted >= 3,
      requirement: `Complete 3 ${p.title} items, including one real-work challenge`
    };
  });

  let activeLesson: ActiveLessonView | null = null;
  const lessonQ = state.activeLesson && eligible.find(q => q.id === state.activeLesson?.id);
  if (state.activeLesson && lessonQ) {
    const { answerIndex, explanation, ...publicQuestion } = lessonQ;
    const a = state.activeLesson;
    activeLesson = {
      ...publicQuestion, options: [...publicQuestion.options], path: pathFor(lessonQ.category), status: statusOf(state.items[`lesson:${lessonQ.id}`]),
      answered: a.answered, selectedIndex: a.selectedIndex, correct: a.correct,
      ...(a.answered ? { answerIndex, explanation } : {})
    };
  }

  let activeChallenge: ActivePracticeView | ActiveRealView | null = null;
  const activeDef = state.activeChallenge && CHALLENGES.find(c => c.id === state.activeChallenge?.id);
  if (state.activeChallenge && activeDef) {
    const a = state.activeChallenge;
    const summary = challenges.find(c => c.id === activeDef.id);
    const base = { id: activeDef.id, path: activeDef.path, skill: activeDef.skill, difficulty: activeDef.difficulty, title: activeDef.title, summary: activeDef.summary, xp: activeDef.xp, status: summary?.status ?? "new", evidence: summary?.evidence ?? "", hint: activeDef.hint };
    activeChallenge = activeDef.kind === "practice"
      ? { ...base, kind: "practice", scenario: activeDef.scenario, options: [...activeDef.options], answered: a.answered, selectedIndex: a.selectedIndex, correct: a.correct, ...(a.answered ? { answerIndex: activeDef.answerIndex, explanation: activeDef.explanation } : {}) }
      : { ...base, kind: "real", launchPrompt: activeDef.launchPrompt, checklist: activeDef.checklist.map(item => ({ ...item })), completed: base.status !== "new", ...(base.status !== "new" ? { feedback: activeDef.feedback } : {}) };
  }

  const firstNewLesson = lessons.find(l => l.status === "new");
  const dueLesson = revisit.find(r => r.kind === "lesson" && r.due);
  const duePractice = revisit.find(r => r.kind === "practice" && r.due);
  const nextChallenge = challenges.find(c => c.kind === "practice" && c.suggested && c.status === "new")
    ?? challenges.find(c => c.kind === "practice" && c.status === "new")
    ?? challenges.find(c => c.status === "new");

  return {
    experience, today: day, paths, activeLesson, challenges, activeChallenge, revisit,
    progress: {
      lessonsCompleted: lessons.filter(l => l.status !== "new").length,
      lessonsAvailable: lessons.length,
      practiceCompleted: challenges.filter(c => c.kind === "practice" && c.status !== "new").length,
      practiceTotal: challenges.filter(c => c.kind === "practice").length,
      realCompleted: challenges.filter(c => c.kind === "real" && c.status !== "new").length,
      realTotal: challenges.filter(c => c.kind === "real").length,
      mastered: Object.values(state.items).filter(item => item.recoveredOn).length,
      due: revisit.filter(r => r.due).length
    },
    unlocks,
    recommended: { lessonId: dueLesson?.id ?? firstNewLesson?.id ?? null, challengeId: duePractice?.id ?? nextChallenge?.id ?? null },
    recent: state.history.slice(-10).map(entry => ({ ...entry }))
  };
}

export function applyLearningAction(state: LearningState, bank: Question[], now: Date, action: string, rawInput: Record<string, unknown>, timezone = "UTC"): { award?: LearningAward; message: string } {
  const input = inputObject(rawInput);
  switch (action) {
    case "set_experience": {
      const experience = input.experience;
      if (experience !== "beginner" && experience !== "experienced") throw new BudError("learning_input", "Experience must be beginner or experienced.");
      state.experience = experience;
      return { message: experience === "beginner" ? "Bud will suggest beginner material first." : "Bud will suggest experienced material first." };
    }
    case "start_lesson": {
      const q = eligibleLesson(bank, dayFor(now, timezone), stringField(input, "questionId"));
      state.activeLesson = { id: q.id, answered: false, selectedIndex: null, correct: null };
      return { message: "Lesson started." };
    }
    case "submit_lesson": {
      const day = today(state, now, timezone);
      const questionId = stringField(input, "questionId");
      const active = state.activeLesson;
      if (!active || active.id !== questionId) throw new BudError("lesson_changed", "Start this lesson before answering it.");
      const q = eligibleLesson(bank, day, questionId);
      let selectedIndex: number | null = null;
      if (q.type === "quiz") selectedIndex = answerIndexFor(input, q.options.length);
      else if (input.answerIndex !== null && input.answerIndex !== undefined) throw new BudError("answer", "A discovery does not take a quiz answer.");
      if (active.answered) return { message: "Already answered. Start the lesson again to retry." };
      const correct = q.type === "quiz" ? selectedIndex === q.answerIndex : null;
      Object.assign(active, { answered: true, selectedIndex, correct });
      const outcome = record(state, `lesson:${q.id}`, day, now, selectedIndex, correct);
      const feedback = correct === null ? "Noted." : correct ? "Correct." : "Not quite. Come back on another day to revisit it.";
      if (outcome === "first") return { award: { id: `learning:lesson:${q.id}`, xp: LESSON_XP, evidence: `First completion of lesson ${q.id}; correctness not required` }, message: feedback };
      if (outcome === "recovered") return { award: { id: `learning:mastery:lesson:${q.id}`, xp: MASTERY_XP, evidence: `Answered ${q.id} correctly on a later day after missing it` }, message: "Correct. You recovered a missed answer." };
      return { message: feedback };
    }
    case "start_challenge": {
      const challenge = challengeDef(stringField(input, "challengeId"));
      state.activeChallenge = { id: challenge.id, answered: false, selectedIndex: null, correct: null };
      return { message: challenge.kind === "real" ? "Challenge started. Copy the prompt into your own Copilot session when you're ready." : "Practice started." };
    }
    case "submit_challenge": {
      const day = today(state, now, timezone);
      const challenge = challengeDef(stringField(input, "challengeId"));
      const active = state.activeChallenge;
      if (!active || active.id !== challenge.id) throw new BudError("challenge_changed", "Start this challenge before submitting it.");
      if (challenge.kind === "practice") {
        if (input.checks !== undefined) throw new BudError("learning_input", "Practice exercises take an answer, not a checklist.");
        const selectedIndex = answerIndexFor(input, challenge.options.length);
        if (active.answered) return { message: "Already answered. Start the exercise again to retry." };
        const correct = selectedIndex === challenge.answerIndex;
        Object.assign(active, { answered: true, selectedIndex, correct });
        const outcome = record(state, `practice:${challenge.id}`, day, now, selectedIndex, correct);
        const feedback = correct ? "Correct." : "Not quite. Read the explanation and revisit it on another day.";
        if (outcome === "first") return { award: { id: `learning:practice:${challenge.id}`, xp: challenge.xp, evidence: PRACTICE_EVIDENCE }, message: feedback };
        if (outcome === "recovered") return { award: { id: `learning:mastery:practice:${challenge.id}`, xp: MASTERY_XP, evidence: `Answered practice ${challenge.id} correctly on a later day after missing it` }, message: "Correct. You recovered a missed answer." };
        return { message: feedback };
      }
      if (input.answerIndex !== undefined) throw new BudError("learning_input", "Real-work challenges take a checklist, not an answer.");
      const checks = input.checks;
      if (!Array.isArray(checks) || checks.some(check => typeof check !== "string") || new Set(checks).size !== checks.length) {
        throw new BudError("checklist", "Checks must be a list of distinct checklist item IDs.");
      }
      const ids = challenge.checklist.map(item => item.id);
      if (checks.some(check => !ids.includes(check))) throw new BudError("checklist", "That checklist item doesn't belong to this challenge.");
      if (checks.length !== ids.length) throw new BudError("checklist", "Confirm every checklist item once you've actually done it.");
      active.answered = true;
      if (state.items[`real:${challenge.id}`]) return { message: "Already recorded. Nice to see you practising it again." };
      record(state, `real:${challenge.id}`, day, now, null, null);
      return { award: { id: `learning:real:${challenge.id}`, xp: challenge.xp, evidence: REAL_EVIDENCE }, message: "Recorded as self-reported. Bud did not verify the session." };
    }
    default:
      throw new BudError("learning_action", "Unknown learning action.");
  }
}
