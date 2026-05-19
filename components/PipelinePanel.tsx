"use client";

import type {
  AgentName,
  AgentState,
  ClassifierOutput,
  CompletenessDecision,
  EmailIntent,
  PricingBreakdown,
  CatalogResult,
  RoutingDecision,
} from "@/lib/types";

const AGENT_LABELS: Record<AgentName, string> = {
  classifier: "Classifier",
  completeness: "Completeness Decider",
  clarification: "Clarification Drafter",
  router: "Router",
  catalog: "Catalog Lookup",
  pricing: "Pricing",
  reply_writer: "Reply Writer",
};

const AGENT_DESCRIPTIONS: Record<AgentName, string> = {
  classifier: "Sonnet · vision · multi-intent extraction",
  completeness: "Rule-based · per ticket",
  clarification: "Haiku · per incomplete ticket",
  router: "Rule-based · department assignment",
  catalog: "Deterministic · catalog search",
  pricing: "Deterministic · business rules",
  reply_writer: "Haiku · localized · tone-normalized",
};

interface Props {
  agents: AgentState[];
  flags: { autoReply: boolean; injection: boolean; intentBlocked: EmailIntent | null };
  classifier: ClassifierOutput | null;
  decisions: CompletenessDecision[];
  routing: RoutingDecision[];
  catalogResults: CatalogResult[];
  pricing: PricingBreakdown[];
}

export default function PipelinePanel({
  agents,
  flags,
  classifier,
  decisions,
  routing,
  catalogResults,
  pricing,
}: Props) {
  return (
    <section className="rounded-lg border border-ink-rail bg-ink-soft/50 backdrop-blur">
      <header className="border-b border-ink-rail px-4 py-3 flex items-center justify-between">
        <div>
          <h2 className="font-mono text-xs uppercase tracking-widest text-accent-mint">
            02 · Pipeline
          </h2>
          <p className="font-sans text-sm text-text mt-0.5">Agent Execution</p>
        </div>
        <FlagsBar flags={flags} />
      </header>

      <div className="p-4 space-y-2">
        {agents.map((agent) => (
          <AgentCard
            key={agent.name}
            agent={agent}
            classifier={agent.name === "classifier" ? classifier : null}
            decisions={agent.name === "completeness" ? decisions : []}
            routing={agent.name === "router" ? routing : []}
            catalogResults={agent.name === "catalog" ? catalogResults : []}
            pricing={agent.name === "pricing" ? pricing : []}
          />
        ))}
      </div>
    </section>
  );
}

function FlagsBar({ flags }: { flags: { autoReply: boolean; injection: boolean; intentBlocked: EmailIntent | null } }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {flags.autoReply && (
        <span className="px-2 py-0.5 rounded border border-accent-amber/40 bg-accent-amber/10 text-accent-amber font-mono text-[10px] uppercase tracking-widest">
          auto-reply
        </span>
      )}
      {flags.injection && (
        <span className="px-2 py-0.5 rounded border border-accent-coral/40 bg-accent-coral/10 text-accent-coral font-mono text-[10px] uppercase tracking-widest">
          injection
        </span>
      )}
      {flags.intentBlocked && (
        <span className="px-2 py-0.5 rounded border border-accent-violet/40 bg-accent-violet/10 text-accent-violet font-mono text-[10px] uppercase tracking-widest">
          intent: {flags.intentBlocked} · escalated
        </span>
      )}
    </div>
  );
}

function AgentCard({
  agent,
  classifier,
  decisions,
  routing,
  catalogResults,
  pricing,
}: {
  agent: AgentState;
  classifier: ClassifierOutput | null;
  decisions: CompletenessDecision[];
  routing: RoutingDecision[];
  catalogResults: CatalogResult[];
  pricing: PricingBreakdown[];
}) {
  const statusClass =
    agent.status === "running"
      ? "status-running"
      : agent.status === "done"
        ? "status-done"
        : agent.status === "error"
          ? "status-error"
          : agent.status === "attention"
            ? "status-attention"
            : agent.status === "skipped"
              ? ""
              : "status-pending";

  const borderColor =
    agent.status === "running"
      ? "border-accent-mint/50"
      : agent.status === "done"
        ? "border-ink-rail"
        : agent.status === "attention"
          ? "border-accent-amber/60"
          : agent.status === "error"
            ? "border-accent-coral/60"
            : "border-ink-rail";

  return (
    <article
      className={`rounded border ${borderColor} bg-ink-warm/40 transition-all ${
        agent.status === "running" ? "shadow-[0_0_20px_rgba(94,234,212,0.08)]" : ""
      }`}
    >
      <div className="px-3 py-2.5 flex items-start gap-3">
        <span className={`${statusClass} mt-1.5 flex-shrink-0`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-sans text-sm font-medium text-text">
              {AGENT_LABELS[agent.name]}
            </h3>
            <span className="font-mono text-[10px] uppercase tracking-widest text-text-faint flex-shrink-0">
              {agent.status === "skipped" ? "skipped" : agent.status}
            </span>
          </div>
          <p className="font-mono text-[11px] text-text-faint mt-0.5">
            {AGENT_DESCRIPTIONS[agent.name]}
          </p>
          {agent.detail && (
            <p className="font-sans text-xs text-text-soft mt-1.5">{agent.detail}</p>
          )}
          {agent.name === "classifier" && classifier && (
            <ClassifierDetail output={classifier} />
          )}
          {agent.name === "completeness" && decisions.length > 0 && (
            <CompletenessDetail decisions={decisions} />
          )}
          {agent.name === "router" && routing.length > 0 && (
            <RouterDetail routing={routing} />
          )}
          {agent.name === "catalog" && catalogResults.length > 0 && (
            <CatalogDetail results={catalogResults} />
          )}
          {agent.name === "pricing" && pricing.length > 0 && (
            <PricingDetail pricing={pricing} />
          )}
        </div>
      </div>
    </article>
  );
}

function ClassifierDetail({ output }: { output: ClassifierOutput }) {
  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex flex-wrap gap-1">
        <Pill label="intent" value={output.intent} />
        <Pill label="lang" value={output.language} />
        <Pill label="tickets" value={String(output.tickets.length)} />
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[11px]">
        <span className="text-text-faint">customer:</span>
        <span className="text-text-soft truncate">{output.customer.name}</span>
        <span className="text-text-faint">type:</span>
        <span className="text-text-soft">{output.customer.company_type ?? "—"}</span>
      </div>
      {output.attachments.length > 0 && (
        <div className="space-y-0.5">
          {output.attachments.map((a, i) => (
            <div key={i} className="font-mono text-[10px] text-text-faint flex items-center gap-2">
              <span
                className={
                  a.classification === "PART_LABEL" || a.classification === "VIN_DOCUMENT"
                    ? "text-accent-mint"
                    : a.classification === "OTHER"
                      ? "text-accent-amber"
                      : "text-text-faint"
                }
              >
                {a.classification}
              </span>
              <span className="truncate flex-1">{a.filename}</span>
              <ConfidenceBadge value={a.confidence} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CompletenessDetail({ decisions }: { decisions: CompletenessDecision[] }) {
  return (
    <div className="mt-2 space-y-0.5">
      {decisions.map((d) => (
        <div key={d.ticket_id} className="flex items-center gap-2 font-mono text-[11px]">
          <span className="text-text-faint">{d.ticket_id}</span>
          <span
            className={
              d.status === "COMPLETE" ? "text-accent-mint" : "text-accent-amber"
            }
          >
            {d.status}
          </span>
        </div>
      ))}
    </div>
  );
}

function RouterDetail({ routing }: { routing: RoutingDecision[] }) {
  return (
    <div className="mt-2 space-y-0.5">
      {routing.map((r) => (
        <div key={r.ticket_id} className="flex items-center gap-2 font-mono text-[11px]">
          <span className="text-text-faint">{r.ticket_id}</span>
          <span className="text-accent-violet">→ {r.department}</span>
          <ConfidenceBadge value={r.confidence} />
        </div>
      ))}
    </div>
  );
}

function CatalogDetail({ results }: { results: CatalogResult[] }) {
  return (
    <div className="mt-2 space-y-1">
      {results.map((r) => (
        <div key={r.ticket_id} className="font-mono text-[11px]">
          <div className="flex items-center gap-2">
            <span className="text-text-faint">{r.ticket_id}</span>
            {r.primary ? (
              <>
                <span className="text-text-soft truncate flex-1">{r.primary.part.sku}</span>
                <ConfidenceBadge value={r.primary.match_score} />
              </>
            ) : (
              <span className="text-accent-coral">no match</span>
            )}
          </div>
          {r.needs_human_review && r.review_reason && (
            <div className="text-accent-amber text-[10px] mt-0.5 pl-4">
              ⚠ {r.review_reason}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function PricingDetail({ pricing }: { pricing: PricingBreakdown[] }) {
  return (
    <div className="mt-2 space-y-0.5">
      {pricing.map((p) => (
        <div key={p.ticket_id} className="flex items-center gap-2 font-mono text-[11px]">
          <span className="text-text-faint">{p.ticket_id}</span>
          <span className="text-text-soft truncate flex-1">{p.sku}</span>
          <span className="text-accent-mint">{p.total_eur} EUR</span>
        </div>
      ))}
    </div>
  );
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-ink border border-ink-rail text-text-soft">
      <span className="text-text-faint">{label}:</span> {value}
    </span>
  );
}

function ConfidenceBadge({ value }: { value: number }) {
  const color =
    value >= 0.85
      ? "text-accent-mint"
      : value >= 0.6
        ? "text-accent-amber"
        : "text-accent-coral";
  return (
    <span className={`font-mono text-[10px] ${color}`}>
      {(value * 100).toFixed(0)}%
    </span>
  );
}
