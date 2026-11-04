import { createCanvas, CanvasError, type CanvasOptions, type CanvasJsonSchema } from "@github/copilot-sdk/extension";
import { BudError } from "./core/types.js";
import type { BudService } from "./service.js";
import { serveCanvas, type Assets } from "./server.js";

type Action = NonNullable<CanvasOptions["actions"]>[number];

export function createBudCanvas(service: BudService, assets: Assets) {
  const panels = new Map<string, ReturnType<typeof serveCanvas>>();
  function action(name: string, description: string, properties: Record<string, CanvasJsonSchema> = {}, required: string[] = []): Action {
    return {
      name, description,
      inputSchema: { type: "object", properties, required, additionalProperties: false },
      handler: async context => {
        try {
          const view = await service.dispatch(name, context.input ?? {});
          if (name === "get_daily_question") return { daily: view.daily, error: view.dailyError };
          if (name === "list_achievements") return { achievements: view.achievements };
          if (name === "equip_item") return { equipped: view.profile.equipped, level: view.profile.level };
          if (name === "sync_usage") return { usage: view.usage };
          if (name === "submit_answer") return { daily: view.daily, error: view.dailyError, profile: view.profile };
          return { profile: view.profile, cosmetics: view.cosmetics };
        } catch (error) {
          if (error instanceof BudError) throw new CanvasError(error.code, error.message);
          throw error;
        }
      }
    };
  }
  const canvas = createCanvas({
    id: "bud",
    displayName: "Bud",
    description: "A private learning companion: daily Copilot discoveries, good-habit milestones, and a bot that grows with you.",
    actions: [
      action("get_profile", "Read Bud's local XP, level, streak and cosmetic inventory. Results enter this conversation only when requested."),
      action("get_daily_question", "Get today's source-linked Copilot learning question or fact. Answers are hidden until submission."),
      action("submit_answer", "Answer today's discovery. Learning earns XP regardless of correctness; replay does not earn more.", {
        questionId: { type: "string" }, day: { type: "string", description: "Use the day returned with today's question." },
        answerIndex: { type: ["integer", "null"], description: "Zero-based option index; null or omitted for a did-you-know fact." }
      }, ["questionId", "day"]),
      action("list_achievements", "List one-time good-habit achievements, including honest unavailable-evidence states."),
      action("equip_item", "Equip an owned cosmetic in its matching slot. Locked cosmetics cannot be equipped.", {
        itemId: { type: "string", description: "An item ID from get_profile." }
      }, ["itemId"]),
      action("record_reflection", "Record a user-confirmed good habit as self-reported, never as measured efficiency. Only call after user confirmation.", {
        kind: { type: "string", enum: ["fresh-session", "lean-instructions", "mcp-cleanup"] }
      }, ["kind"]),
      action("sync_usage", "Only on the user's explicit request: read current-session local usage counters. No transcript text is retained. Returned counters enter this conversation.", {
        consent: { type: "boolean", const: true }
      }, ["consent"])
    ],
    open: async context => {
      let panel = panels.get(context.instanceId);
      if (!panel) {
        panel = serveCanvas(service, assets);
        panels.set(context.instanceId, panel);
      }
      try { return { url: (await panel).url, title: "Bud / your Copilot companion" }; }
      catch (error) { panels.delete(context.instanceId); throw error; }
    },
    onClose: async context => {
      const panel = panels.get(context.instanceId);
      panels.delete(context.instanceId);
      if (panel) await (await panel).close();
    }
  });
  return {
    canvas,
    close: async () => {
      const closing = [...panels.values()];
      panels.clear();
      await Promise.all(closing.map(async panel => (await panel).close()));
    }
  };
}
