"use client";

import { useState } from "react";
import type { IncomingAttachment, IncomingEmail, Language } from "@/lib/types";
import type { ExampleEmail } from "./examples";
import OperatorView from "./OperatorView";

interface Props {
  onSubmit: (email: IncomingEmail) => void;
  running: boolean;
  examples: ExampleEmail[];
  continuingThreadId?: string | null;
  onClearThread?: () => void;
  // Body of the most recently submitted email (so we can show its English
  // translation after the classifier runs).
  lastIncomingBody?: string | null;
  // Detected language of the most recently submitted email.
  lastIncomingLanguage?: Language | null;
}

export default function EmailInput({
  onSubmit,
  running,
  examples,
  continuingThreadId,
  onClearThread,
  lastIncomingBody,
  lastIncomingLanguage,
}: Props) {
  const [fromName, setFromName] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<IncomingAttachment[]>([]);
  const [showExamples, setShowExamples] = useState(true);

  const loadExample = (ex: ExampleEmail) => {
    setFromName(ex.email.from_name);
    setFromEmail(ex.email.from_email);
    setSubject(ex.email.subject);
    setBody(ex.email.body);
    setAttachments(ex.email.attachments ?? []);
    setShowExamples(false);
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    const newAttachments: IncomingAttachment[] = [];
    for (const file of Array.from(files)) {
      const base64 = await fileToBase64(file);
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      newAttachments.push({
        filename: file.name,
        kind: isPdf ? "pdf" : "image",
        mime_type: file.type || (isPdf ? "application/pdf" : "image/jpeg"),
        base64,
      });
    }
    setAttachments((prev) => [...prev, ...newAttachments]);
  };

  const removeAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  const submit = () => {
    if (!fromEmail || !subject || !body) return;
    onSubmit({
      thread_id: continuingThreadId ?? undefined,
      from_name: fromName || fromEmail.split("@")[0],
      from_email: fromEmail,
      subject,
      body,
      attachments,
      received_at: new Date().toISOString(),
    });
  };

  return (
    <section className="rounded-lg border border-ink-rail bg-ink-soft/50 backdrop-blur">
      <header className="border-b border-ink-rail px-4 py-3 flex items-center justify-between">
        <div>
          <h2 className="font-mono text-xs uppercase tracking-widest text-accent-mint">
            01 · Input
          </h2>
          <p className="font-sans text-sm text-text mt-0.5">Incoming Email</p>
        </div>
        <button
          onClick={() => setShowExamples((v) => !v)}
          className="font-mono text-xs text-text-faint hover:text-text transition"
        >
          {showExamples ? "hide examples" : "show examples"}
        </button>
      </header>

      {continuingThreadId && (
        <div className="px-4 py-2 border-b border-ink-rail bg-accent-mint/5 flex items-center justify-between">
          <span className="font-mono text-xs text-accent-mint">
            continuing thread {continuingThreadId.slice(0, 16)}...
          </span>
          {onClearThread && (
            <button
              onClick={onClearThread}
              className="font-mono text-[10px] text-text-faint hover:text-text"
            >
              start fresh
            </button>
          )}
        </div>
      )}

      {showExamples && (
        <div className="px-4 py-3 border-b border-ink-rail bg-ink/30">
          <p className="font-mono text-xs text-text-faint mb-2">Load an example:</p>
          <div className="space-y-1.5">
            {examples.map((ex) => (
              <button
                key={ex.id}
                onClick={() => loadExample(ex)}
                disabled={running}
                className="w-full text-left p-2 rounded border border-ink-rail hover:border-accent-mint/50 hover:bg-ink-warm transition disabled:opacity-50"
              >
                <div className="font-sans text-xs text-text">{ex.label}</div>
                <div className="font-sans text-[11px] text-text-faint mt-0.5">{ex.description}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <input
            type="text"
            placeholder="From name"
            value={fromName}
            onChange={(e) => setFromName(e.target.value)}
            disabled={running}
            className="px-3 py-2 rounded border border-ink-rail bg-ink text-text font-sans text-sm placeholder:text-text-faint focus:border-accent-mint focus:outline-none"
          />
          <input
            type="email"
            placeholder="From email"
            value={fromEmail}
            onChange={(e) => setFromEmail(e.target.value)}
            disabled={running}
            className="px-3 py-2 rounded border border-ink-rail bg-ink text-text font-sans text-sm placeholder:text-text-faint focus:border-accent-mint focus:outline-none"
          />
        </div>

        <input
          type="text"
          placeholder="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          disabled={running}
          className="w-full px-3 py-2 rounded border border-ink-rail bg-ink text-text font-sans text-sm placeholder:text-text-faint focus:border-accent-mint focus:outline-none"
        />

        <textarea
          placeholder="Email body..."
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={running}
          rows={9}
          className="w-full px-3 py-2 rounded border border-ink-rail bg-ink text-text font-sans text-sm placeholder:text-text-faint focus:border-accent-mint focus:outline-none resize-none leading-relaxed"
        />

        {lastIncomingBody && lastIncomingLanguage && (
          <OperatorView
            text={lastIncomingBody}
            sourceLanguage={lastIncomingLanguage}
            label="Incoming email (operator view)"
          />
        )}

        <div>
          <label className="flex items-center justify-center px-3 py-2 rounded border border-dashed border-ink-rail hover:border-accent-mint/50 bg-ink/30 cursor-pointer transition">
            <input
              type="file"
              multiple
              accept="image/*,application/pdf"
              onChange={(e) => handleFiles(e.target.files)}
              disabled={running}
              className="hidden"
            />
            <span className="font-mono text-xs text-text-faint">
              + add attachments (images, PDFs)
            </span>
          </label>
          {attachments.length > 0 && (
            <ul className="mt-2 space-y-1">
              {attachments.map((a, i) => (
                <li key={i} className="flex items-center justify-between px-2 py-1 rounded bg-ink/40 border border-ink-rail">
                  <span className="font-mono text-xs text-text-soft truncate flex-1">
                    {a.kind === "pdf" ? "📄" : "🖼"} {a.filename}
                  </span>
                  <button
                    onClick={() => removeAttachment(i)}
                    disabled={running}
                    className="text-text-faint hover:text-accent-coral text-xs ml-2"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button
          onClick={submit}
          disabled={running || !fromEmail || !subject || !body}
          className="w-full px-4 py-2.5 rounded bg-accent-mint/90 hover:bg-accent-mint text-ink font-mono text-sm font-semibold uppercase tracking-wider transition disabled:cursor-not-allowed disabled:opacity-30 disabled:bg-text-faint"
        >
          {running ? "Processing..." : "Process Email"}
        </button>
      </div>
    </section>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the "data:...;base64," prefix
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}
