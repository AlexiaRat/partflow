/**
 * Error classification.
 *
 * Convert raw errors from any layer into structured user-facing messages
 * with a title, a plain-language description, and an actionable tip. When
 * the underlying error includes useful detail (Zod issues, model output
 * truncation), surface it so the operator can act on it.
 */

export interface FriendlyError {
  title: string;
  message: string;
  tip: string;
  // Raw error excerpt for operators who want to debug further.
  raw?: string;
}

export function classifyError(error: unknown): FriendlyError {
  const rawFull = errorToString(error);
  const raw = rawFull.toLowerCase();

  // ----- Anthropic / Claude API -----
  if (raw.includes("invalid x-api-key") || raw.includes("authentication_error")) {
    return {
      title: "The Anthropic API key is not valid",
      message:
        "The pipeline could not connect to Claude because the configured Anthropic API key was rejected.",
      tip: "Open your .env.local file, paste a fresh key from https://console.anthropic.com, save, and restart the server.",
    };
  }
  if (raw.includes("anthropic_api_key is not set")) {
    return {
      title: "No Anthropic API key configured",
      message:
        "The pipeline needs an Anthropic API key for classification and reply generation, but none was found.",
      tip: "Create a key at https://console.anthropic.com, add it as ANTHROPIC_API_KEY in your environment, then restart the server.",
    };
  }
  if (raw.includes("rate_limit") && raw.includes("anthropic")) {
    return {
      title: "Too many requests to Claude",
      message: "Anthropic's API is currently rate-limiting your account.",
      tip: "Wait about a minute and try again. If this is persistent, check your plan limits in the Anthropic console.",
    };
  }
  if (raw.includes("insufficient_quota") || raw.includes("billing") || raw.includes("credit balance")) {
    return {
      title: "Anthropic credit ran out",
      message: "Your Anthropic account does not have enough credit to run this pipeline.",
      tip: "Top up at https://console.anthropic.com under Settings → Billing. Enabling auto-reload prevents this from happening again.",
    };
  }
  if (raw.includes("not_found") && raw.includes("model")) {
    return {
      title: "Model not found",
      message: "The Anthropic API reports the requested model does not exist on your account.",
      tip: "The default model strings are 'claude-sonnet-4-5' and 'claude-haiku-4-5'. If your account has access to different model IDs, update lib/llm.ts.",
      raw: rawFull.slice(0, 400),
    };
  }

  // ----- Zod validation surface -----
  // Distinguish between "model truncated" (fixable by bumping max_tokens) and
  // "model returned wrong shape" (fixable by improving the prompt).
  if (raw.includes("truncated at max_tokens")) {
    return {
      title: "Classifier output truncated",
      message:
        "Claude's response was cut off before the JSON ended. Most often this happens on multi-intent emails with several attachments.",
      tip: "Increase classifier maxTokens in lib/agents/classifier.ts (currently 6000), or shorten the email body / remove some attachments.",
      raw: rawFull.slice(0, 400),
    };
  }
  if (raw.includes("zodvalidation")) {
    return {
      title: "Classifier output did not match the expected shape",
      message:
        "Claude returned valid JSON but with fields missing or in the wrong type. The validation issues are shown below.",
      tip: "Often a transient issue. Try again. If it keeps failing on the same input, paste the email body alone (without attachments) to narrow down the cause.",
      raw: rawFull.slice(0, 600),
    };
  }
  if (raw.includes("no json object found") || raw.includes("invalid json")) {
    return {
      title: "Claude did not return JSON",
      message:
        "The model produced prose or markdown instead of a JSON object, even after the retry hint.",
      tip: "This is usually transient. Try again. The retry mechanism in lib/llm.ts handles most of these.",
      raw: rawFull.slice(0, 400),
    };
  }
  if (raw.includes("generatestructured failed")) {
    return {
      title: "The classifier could not understand this input",
      message:
        "Claude returned a response that did not match the expected structure, even after a retry.",
      tip: "Try again. If it keeps failing on a specific input, paste the email body alone (without attachments) to narrow down the cause.",
      raw: rawFull.slice(0, 600),
    };
  }

  // ----- Catalog / data layer -----
  if (raw.includes("catalog") && raw.includes("not found")) {
    return {
      title: "Catalog file is missing",
      message: "The pipeline could not load lib/data/catalog.json.",
      tip: "Make sure the file exists and contains valid JSON. If you cloned the repo, run `npm install` again.",
    };
  }

  // ----- Network -----
  if (
    raw.includes("fetch failed") ||
    raw.includes("network") ||
    raw.includes("etimedout") ||
    raw.includes("econnrefused")
  ) {
    return {
      title: "Network issue",
      message: "The pipeline could not reach the Anthropic API.",
      tip: "Check your internet connection and try again. If other sites work but this fails, an upstream API is probably down.",
    };
  }

  if (raw.includes("timeout") || raw.includes("aborted")) {
    return {
      title: "The pipeline took too long",
      message: "One of the agent steps exceeded its time budget.",
      tip: "Try again. If a specific email keeps timing out, simplify it (very long bodies or many large attachments slow down classification).",
    };
  }

  return {
    title: "Something unexpected happened",
    message: "The pipeline encountered an error it could not classify.",
    tip: "Wait a moment and try again. The raw error is shown below.",
    raw: rawFull.slice(0, 400),
  };
}

function errorToString(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
