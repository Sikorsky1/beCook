import "server-only";
import OpenAI from "openai";
import { menuSystemPrompt } from "./prompt";
import { menuSelectionSchema } from "./validation";

// Menu settings are separate from the legacy import/shopping configuration.
export const menuModel = process.env.MENU_OPENAI_MODEL?.trim() || "gpt-5.6-sol";
export const menuFallbackModel = process.env.MENU_OPENAI_FALLBACK_MODEL?.trim() || "gpt-5.6-terra";
export const menuReasoningEffort = "none" as const;
export const menuTimeoutMs = 20_000;
export type MenuAttempt = { model: string; durationMs: number; status: number | null; outcome: "success" | "error" };

export async function createMenuCompletion(openai: OpenAI, userPrompt: string, attempts: MenuAttempt[], signal?: AbortSignal) {
  const models = [...new Set([menuModel, menuFallbackModel])];
  for (const [index, model] of models.entries()) {
    const start = performance.now();
    try {
      const completion = await openai.chat.completions.create({
        model,
        ...(/^gpt-5/.test(model) ? {reasoning_effort: menuReasoningEffort} : {}),
        max_completion_tokens: 1200, store: false,
        response_format: {type: "json_schema", json_schema: {name: "menu_selection", strict: true, schema: menuSelectionSchema}},
        messages: [{role: "system", content: menuSystemPrompt}, {role: "user", content: userPrompt}],
      }, {timeout: menuTimeoutMs, maxRetries: 0, signal});
      attempts.push({model, durationMs: Math.round(performance.now() - start), status: 200, outcome: "success"});
      return {completion, modelUsed: model};
    } catch (error) {
      attempts.push({model, durationMs: Math.round(performance.now() - start), status: error instanceof OpenAI.APIError ? error.status ?? null : null, outcome: "error"});
      // No retries for rate limits, invalid input, refusal or validation.
      const transient = error instanceof OpenAI.APIConnectionError || (error instanceof OpenAI.APIError && (error.code === "model_not_found" || error.status === 404 || (error.status ?? 0) >= 500));
      if (signal?.aborted || !transient || index === models.length - 1) throw error;
    }
  }
  throw new Error("no_model");
}
