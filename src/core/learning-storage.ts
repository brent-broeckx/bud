import { BudError } from "./types.js";

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
const day = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00Z`)) && new Date(`${value}T12:00Z`).toISOString().slice(0, 10) === value;
const nullableDay = (value: unknown) => value === null || day(value);
const answer = (value: unknown) => value === null || typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const correct = (value: unknown) => value === null || typeof value === "boolean";
const active = (value: unknown) => value === null || object(value) && typeof value.id === "string" && typeof value.answered === "boolean" && answer(value.selectedIndex) && correct(value.correct);

export function validateLearningStorage(value: unknown): void {
  if (!object(value) || value.version !== 1 || (value.experience !== null && value.experience !== "beginner" && value.experience !== "experienced") ||
    !object(value.items) || !Array.isArray(value.history) || value.history.length > 200 ||
    !active(value.activeLesson) || !active(value.activeChallenge) ||
    Object.values(value.items).some(item => !object(item) || !Number.isSafeInteger(item.attempts) || Number(item.attempts) < 1 ||
      !day(item.completedOn) || typeof item.everCorrect !== "boolean" || !nullableDay(item.missedOn) || !nullableDay(item.recoveredOn)) ||
    value.history.some(item => !object(item) || typeof item.key !== "string" || !day(item.day) ||
      typeof item.at !== "string" || Number.isNaN(Date.parse(item.at)) || !answer(item.selectedIndex) || !correct(item.correct))) {
    throw new BudError("learning_storage", "Bud's saved learning progress is invalid or from an unsupported version. It has not been overwritten.");
  }
}
