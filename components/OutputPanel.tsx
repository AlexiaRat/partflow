"use client";

import { useState } from "react";
import type {
  CatalogResult,
  ClassifierOutput,
  CompletenessDecision,
  Language,
  QuoteReply,
  RedFlag,
} from "@/lib/types";
import OperatorView, { useTranslation, OPERATOR_LANGUAGE } from "./OperatorView";

interface ClarificationDraftLite {
  ticket_id: string;
  subject: string;
  body: string;
}

interface Props {
  reply: QuoteReply | null;
  clarifications: ClarificationDraftLite[];
  humanReviewItems: Array<{ ticket_id: string; reason: string }>;
  classifier: ClassifierOutput | null;
  decisions: CompletenessDecision[];
  catalogResults: CatalogResult[];
  pendingOverrides: Record<string, string>;
  appliedOverrides: Record<string, string>;
  onPick: (ticketId: string, sku: string) => void;
  onApply: () => void;
  running: boolean;
  flags?: { autoReply: boolean; injection: boolean; intentBlocked: string | null };
}

export default function OutputPanel({
  reply,
  clarifications,
  humanReviewItems,
  classifier,
  catalogResults,
  pendingOverrides,
  appliedOverrides,
  onPick,
  onApply,
  running,
  flags,
}: Props) {
  const [tab, setTab] = useState<"reply" | "clarifications" | "review">("reply");

  const hasReply = Boolean(reply);
  const hasClarifications = clarifications.length > 0;
  const hasReview = humanReviewItems.length > 0;
  const empty = !hasReply && !hasClarifications && !hasReview && !running && !classifier;
  const autoReplySkipped = !!flags?.autoReply && !running;
  const intentBlocked = flags?.intentBlocked && !running;

  return (
    <section className="rounded-lg border border-ink-rail bg-ink-soft/50 backdrop-blur">
      <header className="border-b border-ink-rail px-4 py-3">
        <h2 className="font-mono text-xs uppercase tracking-widest text-accent-mint">
          03 · Output
        </h2>
        <p className="font-sans text-sm text-text mt-0.5">Generated Responses</p>
      </header>

      {empty ? (
        <EmptyState />
      ) : autoReplySkipped || intentBlocked ? (
        <SkippedPipelineNotice
          reason={
            autoReplySkipped
              ? "auto_reply"
              : "intent_blocked"
          }
          intent={flags?.intentBlocked}
        />
      ) : (
        <>
          <nav className="border-b border-ink-rail px-4 py-2 flex gap-1">
            <TabButton
              active={tab === "reply"}
              onClick={() => setTab("reply")}
              count={hasReply ? 1 : 0}
              indicator={hasReply ? "mint" : "faint"}
            >
              Reply Email
            </TabButton>
            <TabButton
              active={tab === "clarifications"}
              onClick={() => setTab("clarifications")}
              count={clarifications.length}
              indicator={hasClarifications ? "amber" : "faint"}
            >
              Clarifications
            </TabButton>
            <TabButton
              active={tab === "review"}
              onClick={() => setTab("review")}
              count={humanReviewItems.length}
              indicator={hasReview ? "coral" : "faint"}
            >
              Human Review
            </TabButton>
          </nav>

          <div className="p-4">
            {tab === "reply" && (
              <ReplyView
                reply={reply}
                running={running}
                hasAnyTicket={!!classifier?.tickets.length}
                redFlags={classifier?.red_flags ?? []}
              />
            )}
            {tab === "clarifications" && (
              <ClarificationsView clarifications={clarifications} classifier={classifier} running={running} />
            )}
            {tab === "review" && (
              <ReviewView
                items={humanReviewItems}
                classifier={classifier}
                catalogResults={catalogResults}
                pendingOverrides={pendingOverrides}
                appliedOverrides={appliedOverrides}
                onPick={onPick}
                onApply={onApply}
                running={running}
              />
            )}
          </div>
        </>
      )}
    </section>
  );
}

function TabButton({
  children,
  active,
  onClick,
  count,
  indicator,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  count: number;
  indicator: "mint" | "amber" | "coral" | "faint";
}) {
  const indicatorColor = {
    mint: "bg-accent-mint",
    amber: "bg-accent-amber",
    coral: "bg-accent-coral",
    faint: "bg-ink-rail",
  }[indicator];

  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded font-mono text-[11px] uppercase tracking-wider transition flex items-center gap-2 ${
        active
          ? "bg-ink-warm text-text border border-ink-rail"
          : "text-text-faint hover:text-text-soft border border-transparent"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${indicatorColor}`} />
      {children}
      {count > 0 && (
        <span className="font-mono text-[10px] text-text-faint">({count})</span>
      )}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="p-12 flex flex-col items-center justify-center text-center">
      <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-3">
        Standing by
      </div>
      <p className="font-sans text-sm text-text-soft max-w-xs">
        Submit an email on the left, or pick one of the examples. The generated reply, any clarification drafts, and human-review escalations will appear here.
      </p>
    </div>
  );
}

function SecurityNoticeBanner({ redFlags }: { redFlags: RedFlag[] }) {
  const highCount = redFlags.filter((f) => f.severity === "high").length;
  const mediumCount = redFlags.filter((f) => f.severity === "medium").length;
  const lowCount = redFlags.filter((f) => f.severity === "low").length;

  // Top-level color reflects the worst severity present.
  const worst = highCount > 0 ? "high" : mediumCount > 0 ? "medium" : "low";
  const border =
    worst === "high"
      ? "border-accent-coral/50 bg-accent-coral/5"
      : worst === "medium"
        ? "border-accent-amber/50 bg-accent-amber/5"
        : "border-accent-amber/30 bg-accent-amber/5";
  const titleColor =
    worst === "high"
      ? "text-accent-coral"
      : worst === "medium"
        ? "text-accent-amber"
        : "text-accent-amber";

  const summary: string[] = [];
  if (highCount > 0) summary.push(`${highCount} critical`);
  if (mediumCount > 0) summary.push(`${mediumCount} medium`);
  if (lowCount > 0) summary.push(`${lowCount} low`);

  return (
    <div className={`border rounded p-3 space-y-2.5 ${border}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`font-mono text-[10px] uppercase tracking-widest ${titleColor}`}>
            ⚠ Security notice · {summary.join(" · ")}
          </span>
        </div>
      </div>
      <p className="font-sans text-xs text-text-soft">
        The pipeline finished and a reply is prepared below, but the incoming email shows signs of being malicious or suspicious. Review before sending. Pricing and instructions inside the message body were ignored.
      </p>
      <ul className="space-y-2 mt-1">
        {redFlags.map((f) => {
          const dot =
            f.severity === "high"
              ? "bg-accent-coral"
              : f.severity === "medium"
                ? "bg-accent-amber"
                : "bg-accent-amber/60";
          return (
            <li key={f.id} className="flex gap-2 items-start">
              <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
              <div>
                <div className="font-sans text-xs text-text">
                  {f.title}
                  <span className="font-mono text-[10px] text-text-faint ml-2">[{f.severity}]</span>
                </div>
                <div className="font-sans text-[11px] text-text-faint leading-relaxed">
                  {f.detail}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SkippedPipelineNotice({
  reason,
  intent,
}: {
  reason: "auto_reply" | "intent_blocked";
  intent?: string | null;
}) {
  if (reason === "auto_reply") {
    return (
      <div className="p-8">
        <div className="border border-accent-amber/40 bg-accent-amber/5 rounded p-4 space-y-2">
          <div className="font-mono text-[10px] uppercase tracking-widest text-accent-amber">
            Auto-reply detected · pipeline skipped
          </div>
          <p className="font-sans text-sm text-text-soft">
            This email looks like an out-of-office or bounce notification, not a real quote request. The pipeline stopped on purpose. We do not send a reply to auto-responders because it would create an email loop where their auto-reply triggers our reply triggers their auto-reply, forever.
          </p>
          <p className="font-sans text-xs text-text-faint">
            In production, this email would be archived or routed to a queue an operator reviews periodically.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="p-8">
      <div className="border border-accent-amber/40 bg-accent-amber/5 rounded p-4 space-y-2">
        <div className="font-mono text-[10px] uppercase tracking-widest text-accent-amber">
          Intent gate · pipeline skipped
        </div>
        <p className="font-sans text-sm text-text-soft">
          The classifier identified this email's intent as{" "}
          <span className="font-mono text-text">{intent ?? "non-quote"}</span>. The pipeline only generates quotes for quote_request emails. Complaints, order confirmations, and general inquiries are routed differently.
        </p>
        <p className="font-sans text-xs text-text-faint">
          In production, this email would be forwarded to the right team or queue for manual handling.
        </p>
      </div>
    </div>
  );
}

function ReplyView({
  reply,
  running,
  hasAnyTicket,
  redFlags,
}: {
  reply: QuoteReply | null;
  running: boolean;
  hasAnyTicket: boolean;
  redFlags: RedFlag[];
}) {
  if (!reply) {
    return (
      <div className="space-y-3">
        {redFlags.length > 0 && <SecurityNoticeBanner redFlags={redFlags} />}
        <div className="py-8 text-center">
          <p className="font-mono text-xs text-text-faint">
            {running
              ? "Generating reply..."
              : hasAnyTicket
                ? "No reply produced. See the Clarifications or Human Review tabs."
                : "Reply will appear once the pipeline completes."}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {redFlags.length > 0 && <SecurityNoticeBanner redFlags={redFlags} />}
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-text-faint">
          Customer language: {reply.language}{reply.language !== OPERATOR_LANGUAGE ? " · operator view in English" : ""}
        </span>
        <CopyButton text={`Subject: ${reply.subject}\n\n${reply.body}`} />
      </div>
      {reply.language !== OPERATOR_LANGUAGE ? (
        <BilingualReply reply={reply} />
      ) : (
        <div className="space-y-2">
          <FieldRow label="Subject" value={reply.subject} />
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-1.5">
              Body
            </div>
            <pre className="font-sans text-sm text-text-soft whitespace-pre-wrap leading-relaxed p-3 rounded bg-ink/40 border border-ink-rail">
              {reply.body}
            </pre>
          </div>
        </div>
      )}
      {reply.fulfilled_tickets.length > 0 && (
        <div className="flex items-center gap-2 font-mono text-[11px]">
          <span className="text-text-faint">fulfilled:</span>
          <span className="text-accent-mint">
            {reply.fulfilled_tickets.join(", ")}
          </span>
        </div>
      )}
    </div>
  );
}

function BilingualReply({ reply }: { reply: QuoteReply }) {
  const [showOriginal, setShowOriginal] = useState(false);
  const subjectTr = useTranslation(reply.subject, OPERATOR_LANGUAGE, true);
  const bodyTr = useTranslation(reply.body, OPERATOR_LANGUAGE, true);

  return (
    <div className="space-y-3">
      {/* English operator view (primary) */}
      <div className="border border-accent-mint/30 rounded bg-accent-mint/5 p-3 space-y-2">
        <div className="font-mono text-[10px] uppercase tracking-widest text-accent-mint">
          Operator view · English
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-1">
            Subject
          </div>
          {subjectTr.loading ? (
            <span className="font-mono text-xs text-text-faint">translating...</span>
          ) : subjectTr.error ? (
            <span className="font-mono text-xs text-accent-coral">{subjectTr.error}</span>
          ) : (
            <div className="text-sm text-text">{subjectTr.translation ?? reply.subject}</div>
          )}
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-1">
            Body
          </div>
          {bodyTr.loading ? (
            <div className="flex items-center gap-2 px-1 py-3">
              <span className="w-2 h-2 rounded-full bg-accent-mint animate-pulse" />
              <span className="font-mono text-[11px] text-text-faint">translating reply to English...</span>
            </div>
          ) : bodyTr.error ? (
            <span className="font-mono text-xs text-accent-coral">{bodyTr.error}</span>
          ) : (
            <pre className="font-sans text-sm text-text-soft whitespace-pre-wrap leading-relaxed">
              {bodyTr.translation ?? reply.body}
            </pre>
          )}
        </div>
      </div>

      {/* Customer-facing (collapsible) */}
      <div className="border border-ink-rail rounded bg-ink/30">
        <button
          onClick={() => setShowOriginal((v) => !v)}
          className="w-full px-3 py-2 flex items-center justify-between hover:bg-ink/40 transition text-left"
        >
          <span className="font-mono text-[10px] uppercase tracking-widest text-text-faint">
            What gets sent to customer · {reply.language}
          </span>
          <span className="font-mono text-[10px] text-text-faint">
            {showOriginal ? "−" : "+"}
          </span>
        </button>
        {showOriginal && (
          <div className="px-3 pb-3 pt-1 border-t border-ink-rail space-y-2">
            <FieldRow label="Subject" value={reply.subject} />
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-1">
                Body
              </div>
              <pre className="font-sans text-sm text-text-soft whitespace-pre-wrap leading-relaxed p-2.5 rounded bg-ink/40 border border-ink-rail">
                {reply.body}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ClarificationsView({
  clarifications,
  classifier,
  running,
}: {
  clarifications: ClarificationDraftLite[];
  classifier: ClassifierOutput | null;
  running: boolean;
}) {
  if (clarifications.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="font-mono text-xs text-text-faint">
          {running
            ? "Drafting clarifications if needed..."
            : "No clarifications needed for this email."}
        </p>
      </div>
    );
  }
  const customerLang = classifier?.language ?? null;
  return (
    <div className="space-y-4">
      {clarifications.map((c) => (
        <ClarificationCard key={c.ticket_id} draft={c} customerLang={customerLang} />
      ))}
    </div>
  );
}

function ClarificationCard({
  draft,
  customerLang,
}: {
  draft: ClarificationDraftLite;
  customerLang: Language | null;
}) {
  const [showOriginal, setShowOriginal] = useState(false);
  const needsTranslation = customerLang !== null && customerLang !== OPERATOR_LANGUAGE;
  const subjectTr = useTranslation(draft.subject, OPERATOR_LANGUAGE, needsTranslation);
  const bodyTr = useTranslation(draft.body, OPERATOR_LANGUAGE, needsTranslation);

  return (
    <article className="border border-ink-rail rounded p-3 bg-ink/30 space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-accent-amber">
          ticket {draft.ticket_id} · needs clarification{needsTranslation ? " · operator view in English" : ""}
        </span>
        <CopyButton text={`Subject: ${draft.subject}\n\n${draft.body}`} />
      </div>

      {needsTranslation ? (
        <>
          <div className="border border-accent-mint/30 rounded bg-accent-mint/5 p-2.5 space-y-1.5">
            <div className="font-mono text-[10px] uppercase tracking-widest text-accent-mint">
              Operator view · English
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-0.5">
                Subject
              </div>
              {subjectTr.loading ? (
                <span className="font-mono text-xs text-text-faint">translating...</span>
              ) : (
                <div className="text-sm text-text">{subjectTr.translation ?? draft.subject}</div>
              )}
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-0.5">
                Body
              </div>
              {bodyTr.loading ? (
                <span className="font-mono text-[11px] text-text-faint">translating clarification to English...</span>
              ) : (
                <pre className="font-sans text-sm text-text-soft whitespace-pre-wrap leading-relaxed">
                  {bodyTr.translation ?? draft.body}
                </pre>
              )}
            </div>
          </div>
          <div className="border border-ink-rail rounded bg-ink/30">
            <button
              onClick={() => setShowOriginal((v) => !v)}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-ink/40 transition text-left"
            >
              <span className="font-mono text-[10px] uppercase tracking-widest text-text-faint">
                What gets sent · {customerLang}
              </span>
              <span className="font-mono text-[10px] text-text-faint">
                {showOriginal ? "−" : "+"}
              </span>
            </button>
            {showOriginal && (
              <div className="px-3 pb-2 pt-1 border-t border-ink-rail space-y-1.5">
                <FieldRow label="Subject" value={draft.subject} />
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-0.5">
                    Body
                  </div>
                  <pre className="font-sans text-sm text-text-soft whitespace-pre-wrap leading-relaxed p-2 rounded bg-ink/40 border border-ink-rail">
                    {draft.body}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <FieldRow label="Subject" value={draft.subject} />
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-1">
              Body
            </div>
            <pre className="font-sans text-sm text-text-soft whitespace-pre-wrap leading-relaxed p-2.5 rounded bg-ink/40 border border-ink-rail">
              {draft.body}
            </pre>
          </div>
        </>
      )}
    </article>
  );
}

function ReviewView({
  items,
  classifier,
  catalogResults,
  pendingOverrides,
  appliedOverrides,
  onPick,
  onApply,
  running,
}: {
  items: Array<{ ticket_id: string; reason: string }>;
  classifier: ClassifierOutput | null;
  catalogResults: CatalogResult[];
  pendingOverrides: Record<string, string>;
  appliedOverrides: Record<string, string>;
  onPick: (ticketId: string, sku: string) => void;
  onApply: () => void;
  running: boolean;
}) {
  if (items.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="font-mono text-xs text-text-faint">
          No human review needed. The pipeline handled this email autonomously.
        </p>
      </div>
    );
  }

  const pendingCount = Object.keys(pendingOverrides).length;

  return (
    <div className="space-y-3">
      <div className="rounded border border-accent-coral/40 bg-accent-coral/5 p-3 flex items-start gap-3">
        <span className="text-accent-coral text-lg leading-none mt-0.5">⚠</span>
        <div className="flex-1">
          <div className="font-mono text-[10px] uppercase tracking-widest text-accent-coral">
            Attention required
          </div>
          <p className="font-sans text-sm text-text-soft mt-1">
            {items.length} ticket{items.length > 1 ? "s" : ""} need an operator's
            judgment before a quote can be sent. Pick the right part below, then apply.
          </p>
        </div>
      </div>

      {items.map((item) => {
        const ticket = classifier?.tickets.find((t) => t.id === item.ticket_id);
        const catRes = catalogResults.find((r) => r.ticket_id === item.ticket_id);
        const pendingSku = pendingOverrides[item.ticket_id];
        const appliedSku = appliedOverrides[item.ticket_id];
        return (
          <article key={item.ticket_id} className="border border-ink-rail rounded p-3 bg-ink/30">
            <div className="flex items-center justify-between mb-1.5">
              <div className="font-mono text-[10px] uppercase tracking-widest text-accent-coral">
                ticket {item.ticket_id}
              </div>
              {appliedSku && (
                <div className="font-mono text-[10px] uppercase tracking-widest text-accent-mint">
                  resolved → {appliedSku}
                </div>
              )}
            </div>
            {ticket && (
              <p className="font-sans text-xs text-text-soft mb-2">
                Customer asked: &quot;{(ticket.request.description ?? "").slice(0, 120)}
                {(ticket.request.description ?? "").length > 120 ? "..." : ""}&quot;
              </p>
            )}
            <p className="font-sans text-sm text-text-soft mb-3">{item.reason}</p>

            {catRes && catRes.matches.length > 0 && (
              <div className="space-y-1.5">
                <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint">
                  Catalog candidates ({catRes.matches.length})
                </div>
                {catRes.matches.map((m) => {
                  const isPending = pendingSku === m.part.sku;
                  const isApplied = appliedSku === m.part.sku;
                  return (
                    <button
                      key={m.part.sku}
                      onClick={() => onPick(item.ticket_id, m.part.sku)}
                      disabled={running || !!appliedSku}
                      className={`w-full text-left p-2 rounded border transition ${
                        isApplied
                          ? "border-accent-mint bg-accent-mint/10"
                          : isPending
                            ? "border-accent-mint/70 bg-accent-mint/5"
                            : "border-ink-rail bg-ink/40 hover:border-accent-mint/40"
                      } disabled:opacity-60 disabled:cursor-not-allowed`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-sans text-sm text-text truncate">
                          {m.part.name}
                        </span>
                        <span className="font-mono text-[11px] text-text-faint shrink-0">
                          score {m.match_score.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <span className="font-mono text-[11px] text-text-faint truncate">
                          {m.part.sku}
                        </span>
                        <span className="font-mono text-[11px] text-text-faint shrink-0">
                          {m.part.price_eur} EUR · stock {m.part.stock}
                        </span>
                      </div>
                      <div className="font-mono text-[10px] text-text-faint mt-1 truncate">
                        {m.match_reasons.join(" · ")}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </article>
        );
      })}

      {pendingCount > 0 && (
        <button
          onClick={onApply}
          disabled={running}
          className="w-full px-4 py-2.5 rounded bg-accent-mint/90 hover:bg-accent-mint text-ink font-mono text-sm font-semibold uppercase tracking-wider transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {running ? "Re-running..." : `Apply ${pendingCount} pick${pendingCount > 1 ? "s" : ""} and re-run pipeline`}
        </button>
      )}
    </div>
  );
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="font-sans">
      <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint">
        {label}
      </div>
      <div className="text-sm text-text mt-0.5">{value}</div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="font-mono text-[10px] uppercase tracking-widest text-text-faint hover:text-accent-mint transition"
    >
      {copied ? "copied ✓" : "copy"}
    </button>
  );
}
