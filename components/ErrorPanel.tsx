"use client";

import { useState } from "react";
import type { FriendlyError } from "@/lib/types";

interface Props {
  error: FriendlyError;
}

export default function ErrorPanel({ error }: Props) {
  const [showRaw, setShowRaw] = useState(false);
  return (
    <section className="rounded-lg border border-accent-coral/50 bg-accent-coral/5 backdrop-blur p-4 animate-fade-up">
      <div className="flex items-start gap-3">
        <span className="text-accent-coral text-xl leading-none mt-0.5 flex-shrink-0">
          ⚠
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="font-mono text-[10px] uppercase tracking-widest text-accent-coral mb-1">
            Pipeline error
          </h3>
          <h4 className="font-sans text-sm font-medium text-text mb-2">
            {error.title}
          </h4>
          <p className="font-sans text-sm text-text-soft mb-3 leading-relaxed">
            {error.message}
          </p>
          <div className="rounded border border-ink-rail bg-ink/40 p-2.5">
            <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-1">
              Tip
            </div>
            <p className="font-sans text-xs text-text-soft leading-relaxed">
              <LinkifiedText text={error.tip} />
            </p>
          </div>
          {error.raw && (
            <div className="mt-2">
              <button
                onClick={() => setShowRaw((v) => !v)}
                className="font-mono text-[10px] uppercase tracking-widest text-text-faint hover:text-text"
              >
                {showRaw ? "hide raw error" : "show raw error"}
              </button>
              {showRaw && (
                <pre className="mt-2 rounded border border-ink-rail bg-ink/60 p-2.5 text-[11px] font-mono text-text-faint overflow-x-auto whitespace-pre-wrap break-words">
                  {error.raw}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function LinkifiedText({ text }: { text: string }) {
  // Split on URLs and turn each one into a real <a>
  const parts = text.split(/(https?:\/\/[^\s)]+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-mint underline decoration-accent-mint/40 hover:decoration-accent-mint"
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
