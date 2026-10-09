import "server-only";
import OpenAI from "openai";
import { menuSystemPrompt, substitutionSystemPrompt } from "./prompt";
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

export const substitutionTimeoutMs = 15_000;
export const substitutionSchema = {
  type: "object", additionalProperties: false, required: ["dish"],
  properties: {dish: {type: "string", minLength: 8, maxLength: 110}},
};

// Dish substitution: exactly one bounded attempt with the menu model; no fallback, no retry.
export async function createSubstitutionCompletion(openai: OpenAI, userPrompt: string, attempts: MenuAttempt[], signal?: AbortSignal) {
  const start = performance.now();
  try {
    const completion = await openai.chat.completions.create({
      model: menuModel,
      ...(/^gpt-5/.test(menuModel) ? {reasoning_effort: menuReasoningEffort} : {}),
      max_completion_tokens: 120, store: false,
      response_format: {type: "json_schema", json_schema: {name: "dish_substitution", strict: true, schema: substitutionSchema}},
      messages: [{role: "system", content: substitutionSystemPrompt}, {role: "user", content: userPrompt}],
    }, {timeout: substitutionTimeoutMs, maxRetries: 0, signal});
    attempts.push({model: menuModel, durationMs: Math.round(performance.now() - start), status: 200, outcome: "success"});
    return completion;
  } catch (error) {
    attempts.push({model: menuModel, durationMs: Math.round(performance.now() - start), status: error instanceof OpenAI.APIError ? error.status ?? null : null, outcome: "error"});
    throw error;
  }
}
