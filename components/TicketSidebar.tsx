"use client";

import type {
  ClassifierOutput,
  CompletenessDecision,
  Ticket,
} from "@/lib/types";

interface Props {
  classifier: ClassifierOutput;
  decisions: CompletenessDecision[];
  humanReviewItems: Array<{ ticket_id: string; reason: string }>;
  threadId: string | null;
}

export default function TicketSidebar({
  classifier,
  decisions,
  humanReviewItems,
  threadId,
}: Props) {
  return (
    <section className="rounded-lg border border-ink-rail bg-ink-soft/50 backdrop-blur">
      <header className="border-b border-ink-rail px-4 py-3">
        <h2 className="font-mono text-xs uppercase tracking-widest text-accent-violet">
          tickets
        </h2>
        <p className="font-sans text-sm text-text mt-0.5">
          {classifier.tickets.length} extracted from this email
        </p>
        {threadId && (
          <p className="font-mono text-[10px] text-text-faint mt-1 truncate">
            thread: {threadId}
          </p>
        )}
      </header>

      <div className="p-3 space-y-2">
        {classifier.tickets.map((ticket) => {
          const decision = decisions.find((d) => d.ticket_id === ticket.id);
          const inReview = humanReviewItems.some((h) => h.ticket_id === ticket.id);
          return (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              completenessStatus={decision?.status}
              inReview={inReview}
            />
          );
        })}
      </div>
    </section>
  );
}

function TicketCard({
  ticket,
  completenessStatus,
  inReview,
}: {
  ticket: Ticket;
  completenessStatus?: string;
  inReview: boolean;
}) {
  // Border color reflects the most pressing status
  const borderColor = inReview
    ? "border-accent-coral/50"
    : completenessStatus === "COMPLETE"
      ? "border-accent-mint/40"
      : completenessStatus
        ? "border-accent-amber/40"
        : "border-ink-rail";

  return (
    <article className={`rounded border ${borderColor} bg-ink-warm/40 p-3 space-y-2`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-text-faint">
          {ticket.id}
        </span>
        <StatusPill completenessStatus={completenessStatus} inReview={inReview} />
      </div>

      <div>
        <p className="font-sans text-xs text-text-soft leading-snug line-clamp-2">
          {ticket.request.description}
        </p>
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 font-mono text-[10px] pt-1 border-t border-ink-rail/50">
        <span className="text-text-faint">vehicle</span>
        <span className="text-text-soft truncate">
          {[ticket.vehicle.brand, ticket.vehicle.model, ticket.vehicle.year]
            .filter(Boolean)
            .join(" ") || "—"}
        </span>
        {ticket.vehicle.engine && (
          <>
            <span className="text-text-faint">engine</span>
            <span className="text-text-soft truncate">{ticket.vehicle.engine}</span>
          </>
        )}
        {ticket.vehicle.vin && (
          <>
            <span className="text-text-faint">vin</span>
            <span className="text-text-soft truncate">{ticket.vehicle.vin}</span>
          </>
        )}
        <span className="text-text-faint">qty</span>
        <span className="text-text-soft">{ticket.request.quantity}</span>
        <span className="text-text-faint">conf</span>
        <span className={confidenceColor(ticket.request.confidence)}>
          {(ticket.request.confidence * 100).toFixed(0)}%
        </span>
      </div>
    </article>
  );
}

function StatusPill({
  completenessStatus,
  inReview,
}: {
  completenessStatus?: string;
  inReview: boolean;
}) {
  if (inReview) {
    return (
      <span className="font-mono text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded border border-accent-coral/50 bg-accent-coral/10 text-accent-coral">
        review
      </span>
    );
  }
  if (!completenessStatus) {
    return (
      <span className="font-mono text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded border border-ink-rail text-text-faint">
        pending
      </span>
    );
  }
  if (completenessStatus === "COMPLETE") {
    return (
      <span className="font-mono text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded border border-accent-mint/40 bg-accent-mint/10 text-accent-mint">
        complete
      </span>
    );
  }
  const labels: Record<string, string> = {
    NEEDS_VEHICLE: "need vehicle",
    NEEDS_VIN: "need vin",
    NEEDS_PART_DETAIL: "need detail",
    NEEDS_PHOTO: "need photo",
  };
  return (
    <span className="font-mono text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded border border-accent-amber/40 bg-accent-amber/10 text-accent-amber">
      {labels[completenessStatus] ?? completenessStatus.toLowerCase()}
    </span>
  );
}

function confidenceColor(value: number): string {
  if (value >= 0.85) return "text-accent-mint";
  if (value >= 0.6) return "text-accent-amber";
  return "text-accent-coral";
}
