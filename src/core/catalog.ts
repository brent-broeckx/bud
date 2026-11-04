import type { Cosmetic } from "./types.js";

export const COSMETICS: readonly Cosmetic[] = [
  { id: "fern", name: "Fern", slot: "color", level: 1, value: "#569d78" },
  { id: "mint", name: "Mint", slot: "color", level: 1, value: "#71a894" },
  { id: "sprout", name: "Sprout", slot: "head", level: 1, value: "sprout" },
  { id: "bare", name: "Original bot", slot: "head", level: 1, value: "bare" },
  { id: "everyday", name: "Everyday", slot: "outfit", level: 1, value: "everyday" },
  { id: "curious", name: "Curious companion", slot: "title", level: 1, value: "Curious companion" },
  { id: "clay", name: "Terracotta", slot: "color", level: 2, value: "#b86f54" },
  { id: "beanie", name: "Cozy beanie", slot: "head", level: 2, value: "beanie" },
  { id: "overalls", name: "Workshop overalls", slot: "outfit", level: 3, value: "overalls" },
  { id: "moss", name: "Moss", slot: "color", level: 3, value: "#8a9754" },
  { id: "explorer", name: "Context explorer", slot: "title", level: 4, value: "Context explorer" },
  { id: "antenna", name: "Satellite antenna", slot: "head", level: 4, value: "antenna" },
  { id: "midnight", name: "Midnight", slot: "color", level: 5, value: "#697aaf" },
  { id: "cape", name: "Tiny hero cape", slot: "outfit", level: 5, value: "cape" },
  { id: "sage", name: "Local legend", slot: "title", level: 6, value: "Local legend" }
];

export function levelFor(xp: number): number {
  return Math.floor(Math.sqrt(xp / 50)) + 1;
}

export function levelStart(level: number): number {
  return 50 * (level - 1) ** 2;
}
