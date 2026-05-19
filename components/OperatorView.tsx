"use client";

import { useEffect, useState } from "react";
import type { Language } from "@/lib/types";

export const OPERATOR_LANGUAGE: Language = "en";

const LANG_LABELS: Record<Language, string> = {
  ro: "Romanian",
  en: "English",
  hu: "Hungarian",
  de: "German",
};

/**
 * Hook: fetches a translation of `text` into `targetLang` when `enabled`.
 *
 * Returns { translation, loading, error }. Refetches when text/targetLang
 * change. Aborts in flight on cleanup so rapid changes don't leak stale
 * responses into the UI.
 */
export function useTranslation(
  text: string,
  targetLang: Language,
  enabled: boolean,
) {
  const [translation, setTranslation] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !text.trim()) {
      setTranslation(null);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const r = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, target_lang: targetLang }),
          signal: controller.signal,
        });
        if (!r.ok) {
          const data = await r.json().catch(() => null);
          const msg =
            (data &&
              (typeof data.error === "string"
                ? data.error
                : data.error?.title)) ||
            `API ${r.status}`;
          throw new Error(msg);
        }
        const data = await r.json();
        setTranslation(data.translation as string);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Translation failed");
        setTranslation(null);
      } finally {
        setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [text, targetLang, enabled]);

  return { translation, loading, error };
}

interface OperatorViewProps {
  // Text to translate (in customer's language)
  text: string;
  // Customer's language (we translate FROM this)
  sourceLanguage: Language | null | undefined;
  // What to show above the panel
  label?: string;
  // Compact mode (smaller padding, no header) for tight spots
  compact?: boolean;
}

/**
 * Auto-translates customer-facing content into the operator language
 * (English by default). Renders nothing when source language equals operator
 * language, or when text is empty, or when source language is unknown.
 *
 * This is the panel that appears under the input textarea after the
 * pipeline classifies the email. The operator sees the customer's message
 * in English without clicking anything.
 */
export default function OperatorView({
  text,
  sourceLanguage,
  label = "Operator view (English)",
  compact = false,
}: OperatorViewProps) {
  const needsTranslation =
    !!sourceLanguage && sourceLanguage !== OPERATOR_LANGUAGE && text.trim().length > 0;

  const { translation, loading, error } = useTranslation(
    text,
    OPERATOR_LANGUAGE,
    needsTranslation,
  );

  if (!needsTranslation) return null;

  const sourceLabel = sourceLanguage ? LANG_LABELS[sourceLanguage] : "unknown";

  return (
    <div className="border border-accent-mint/30 rounded bg-accent-mint/5 p-2.5">
      {!compact && (
        <div className="flex items-center justify-between mb-1.5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-accent-mint">
            {label}
          </span>
          <span className="font-mono text-[10px] text-text-faint">
            translated from {sourceLabel}
          </span>
        </div>
      )}
      {loading && (
        <div className="flex items-center gap-2 px-1 py-2">
          <span className="w-2 h-2 rounded-full bg-accent-mint animate-pulse" />
          <span className="font-mono text-[11px] text-text-faint">
            translating...
          </span>
        </div>
      )}
      {error && (
        <div className="text-[11px] font-mono text-accent-coral px-1 py-2">
          {error}
        </div>
      )}
      {translation && (
        <pre className="font-sans text-sm text-text-soft whitespace-pre-wrap leading-relaxed">
          {translation}
        </pre>
      )}
    </div>
  );
}
