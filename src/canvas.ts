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
          if (name === "sync_history" || name === "clear_history") return { history: view.history };
          if (name === "review_prompt" || name === "review_session" || name === "clear_review") return { review: view.review };
          if (name === "send_challenge") return { delivery: view.sessionInteraction };
          if (["get_learning", "start_lesson", "submit_lesson", "start_challenge", "submit_challenge", "set_experience"].includes(name)) return { learning: view.learning, profile: view.profile };
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
    description: "A private learning companion: continuous Copilot learning, practice challenges, local usage coaching, and a bot that grows with you.",
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
      }, ["consent"]),
      action("sync_history", "Only on explicit request: import a batch of up to 100 local sessions' counters, never transcript text. Use history.nextOffset for older batches. Coverage and returned counters enter this conversation.", {
        consent: { type: "boolean", const: true }, offset: { type: "integer", minimum: 0 }
      }, ["consent"]),
      action("clear_history", "On request, forget Bud's saved usage counters. Copilot's own logs are not modified."),
      action("review_prompt", "Only after separate text-review consent: apply a local keyword checklist to a selected prompt. Not an AI quality grade. Text is never saved by Bud; returned feedback enters this conversation.", {
        consent: { type: "boolean", const: true }, text: { type: "string", maxLength: 6000 }
      }, ["consent", "text"]),
      action("review_session", "Only after explicit separate consent to read session text: apply a local checklist to this session's user prompts (up to 8 MB). No assistant/tool text is reviewed; no raw text is saved. Usage consent alone is insufficient.", {
        consent: { type: "boolean", const: true }
      }, ["consent"]),
      action("clear_review", "Dismiss Bud's in-memory local text-review feedback."),
      action("get_learning", "Read continuous learning paths and practice challenges. No daily limit; this does not read local usage or session text."),
      action("set_experience", "Set beginner or experienced recommendations. All content remains accessible.", {
        experience: { type: "string", enum: ["beginner", "experienced"] }
      }, ["experience"]),
      action("start_lesson", "Open a source-linked learning-bank lesson. Get IDs from get_learning.", {
        questionId: { type: "string" }
      }, ["questionId"]),
      action("submit_lesson", "Answer an opened lesson. First learning and later mastery have bounded, idempotent XP.", {
        questionId: { type: "string" }, answerIndex: { type: ["integer", "null"] }
      }, ["questionId"]),
      action("start_challenge", "Open a practice or real-work challenge with its hints and completion rubric.", {
        challengeId: { type: "string" }
      }, ["challengeId"]),
      action("submit_challenge", "Submit a quick-practice answer, or record a real-work checklist only after the user confirms each check. Checklist completions are self-reported, not measured or agent-verified.", {
        challengeId: { type: "string" }, answerIndex: { type: "integer" },
        checks: { type: "array", items: { type: "string" } }
      }, ["challengeId"]),
      action("send_challenge", "Only after the user explicitly approves the exact brief and starting model work: send a real-work challenge to this Copilot session. No usage/text is automatically included. Never invoke recursively from a challenge.", {
        challengeId: { type: "string" }, consent: { type: "boolean", const: true }, prompt: { type: "string", maxLength: 6000 }
      }, ["challengeId", "consent", "prompt"])
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
