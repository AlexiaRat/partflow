/**
 * POST /api/translate
 *
 * Body: { text: string, target_lang: "ro" | "en" | "hu" | "de" }
 * Response: { translation: string }
 *
 * Uses Haiku because translation is straightforward and cheap. The system
 * prompt forbids commentary; output is only the translated text, preserving
 * line breaks and any list structure.
 */

import { NextRequest, NextResponse } from "next/server";
import { generateText, HAIKU_MODEL } from "@/lib/llm";
import { classifyError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LANG_NAMES: Record<string, string> = {
  ro: "Romanian",
  en: "English",
  hu: "Hungarian",
  de: "German",
};

const SYSTEM_PROMPT = `You are a translator. Translate the given text into the target language naturally and accurately. Preserve line breaks, paragraph spacing, lists, and any structural formatting exactly as in the source. Do NOT add commentary, introductions, explanations, or any extra text. Return ONLY the translated text, nothing else. If the source is already in the target language, return it unchanged.`;

export async function POST(req: NextRequest) {
  let payload: { text?: string; target_lang?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const text = (payload.text ?? "").trim();
  const targetLang = payload.target_lang;

  if (!text) {
    return NextResponse.json({ error: "Empty text" }, { status: 400 });
  }
  if (!targetLang || !(targetLang in LANG_NAMES)) {
    return NextResponse.json(
      { error: `target_lang must be one of: ${Object.keys(LANG_NAMES).join(", ")}` },
      { status: 400 },
    );
  }

  // Cap input size to keep cost predictable. 8 KB is plenty for any email body.
  if (text.length > 8000) {
    return NextResponse.json(
      { error: "Text too long (max 8000 chars)" },
      { status: 400 },
    );
  }

  try {
    const translation = await generateText({
      model: HAIKU_MODEL,
      system: SYSTEM_PROMPT,
      prompt: `Translate the following text into ${LANG_NAMES[targetLang]}.\n\n${text}`,
      maxTokens: 2000,
      temperature: 0.2,
    });
    return NextResponse.json({ translation });
  } catch (err) {
    return NextResponse.json(
      { error: classifyError(err) },
      { status: 500 },
    );
  }
}
