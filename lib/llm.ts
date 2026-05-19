/**
 * Anthropic client + structured output helper.
 *
 * Model strategy (chosen for cost-efficiency):
 *   - Sonnet 4.5: classifier only (needs vision + reasoning over attachments).
 *   - Haiku 4.5: everything else (clarification draft, reply writing).
 *
 * Structured output uses Zod to validate the model's JSON response. If
 * validation fails, we retry once with the specific Zod issues as feedback
 * so the model can self-correct. If that retry also fails, we throw an
 * error whose message includes the actual Zod issue paths so the friendly
 * error UI can show what went wrong instead of a generic message.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

export const SONNET_MODEL = "claude-sonnet-4-5";
export const HAIKU_MODEL = "claude-haiku-4-5";

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set");
    }
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

export type MessageContent =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };

/**
 * Generate a structured response validated against a Zod schema.
 *
 * The model is told to return only a JSON object. We parse, validate against
 * the schema, and on failure retry once with the exact Zod issue text. If
 * both attempts fail, the error includes the issue paths so the UI can show
 * what was wrong.
 */
export async function generateStructured<T>(params: {
  model: string;
  schema: z.ZodType<T>;
  system: string;
  content: string | MessageContent[];
  maxTokens?: number;
  temperature?: number;
}): Promise<T> {
  const { model, schema, system, content, maxTokens = 4000, temperature = 0 } = params;

  const userContent: MessageContent[] =
    typeof content === "string" ? [{ type: "text", text: content }] : content;

  const fullSystem =
    system +
    `\n\nReturn ONLY a single JSON object. No prose before or after. No markdown code fences. The JSON must validate against the expected schema.`;

  const attempt = async (extra?: string): Promise<T> => {
    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: (extra ? [...userContent, { type: "text", text: extra }] : userContent) as Anthropic.MessageParam["content"],
      },
    ];

    const response = await getClient().messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system: fullSystem,
      messages,
    });

    if (response.stop_reason === "max_tokens") {
      throw new Error(
        `Model output truncated at max_tokens=${maxTokens}. Increase the limit or shorten the input.`,
      );
    }

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Model returned no text content");
    }

    const raw = textBlock.text.trim();
    const jsonText = extractJson(raw);
    if (!jsonText) {
      throw new Error(`No JSON object found in model output. First 200 chars: ${raw.slice(0, 200)}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      throw new Error(
        `Model returned invalid JSON: ${(e as Error).message}. First 200 chars: ${jsonText.slice(0, 200)}`,
      );
    }

    const result = schema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
        .join("; ");
      throw new Error(`ZodValidation: ${issues}`);
    }
    return result.data;
  };

  try {
    return await attempt();
  } catch (firstError) {
    const message = firstError instanceof Error ? firstError.message : String(firstError);
    try {
      return await attempt(
        `Your previous response failed validation with this error:\n${message}\n\nFix the specific fields mentioned above. Return a valid JSON object that matches the expected schema exactly.`,
      );
    } catch (secondError) {
      const finalMsg = secondError instanceof Error ? secondError.message : String(secondError);
      throw new Error(`generateStructured failed after retries. Last error: ${finalMsg}`);
    }
  }
}

/**
 * Generate plain text. Used by clarification drafter and reply writer.
 */
export async function generateText(params: {
  model: string;
  system: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  const { model, system, prompt, maxTokens = 1500, temperature = 0.3 } = params;

  const response = await getClient().messages.create({
    model,
    max_tokens: maxTokens,
    temperature,
    system,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Model returned no text content");
  }
  return textBlock.text.trim();
}

/**
 * Extract a JSON object from arbitrary model output. Handles:
 *   1. Pure JSON: "{...}"
 *   2. Fenced JSON: "```json\n{...}\n```"
 *   3. JSON with surrounding prose: "Here is the result: {...}"
 *
 * Walks from the first `{` to its matching `}`, ignoring braces inside strings.
 */
function extractJson(text: string): string | null {
  const trimmed = text.trim();

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  const start = trimmed.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return trimmed.slice(start, i + 1);
      }
    }
  }
  return trimmed.slice(start);
}
