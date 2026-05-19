"use client";

import { useState } from "react";
import type { AgentName, AgentTrace, TraceStep } from "@/lib/types";

interface Props {
  traces: AgentTrace[];
}

const AGENT_ICON: Record<AgentName, string> = {
  classifier: "01",
  completeness: "02",
  clarification: "03",
  router: "04",
  catalog: "05",
  pricing: "06",
  reply_writer: "07",
};

const AGENT_LABEL: Record<AgentName, string> = {
  classifier: "Classifier",
  completeness: "Completeness",
  clarification: "Clarification",
  router: "Router",
  catalog: "Catalog",
  pricing: "Pricing",
  reply_writer: "Reply Writer",
};

export default function AgentTracePanel({ traces }: Props) {
  const [openAgents, setOpenAgents] = useState<Set<string>>(new Set());
  const [filterTicket, setFilterTicket] = useState<string | null>(null);

  // Collect ticket IDs across all traces for the filter chips
  const ticketIds = new Set<string>();
  for (const t of traces) {
    for (const s of t.steps) {
      if (s.ticket_id) ticketIds.add(s.ticket_id);
    }
  }
  const ticketIdList = Array.from(ticketIds).sort();

  const toggle = (name: string) => {
    const next = new Set(openAgents);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setOpenAgents(next);
  };

  return (
    <section className="rounded-lg border border-ink-rail bg-ink-soft/50 backdrop-blur">
      <header className="border-b border-ink-rail px-4 py-3 flex items-center justify-between">
        <div>
          <h2 className="font-mono text-xs uppercase tracking-widest text-accent-mint">
            Agent Trace
          </h2>
          <p className="font-sans text-sm text-text mt-0.5">
            How each agent decided
          </p>
        </div>
        {ticketIdList.length > 0 && (
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="text-text-faint">filter</span>
            <button
              onClick={() => setFilterTicket(null)}
              className={`px-2 py-1 rounded border ${
                filterTicket === null
                  ? "border-accent-mint text-accent-mint"
                  : "border-ink-rail text-text-faint hover:text-text"
              }`}
            >
              all
            </button>
            {ticketIdList.map((tid) => (
              <button
                key={tid}
                onClick={() => setFilterTicket(filterTicket === tid ? null : tid)}
                className={`px-2 py-1 rounded border ${
                  filterTicket === tid
                    ? "border-accent-mint text-accent-mint"
                    : "border-ink-rail text-text-faint hover:text-text"
                }`}
              >
                {tid}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="p-3 space-y-2">
        {traces.length === 0 ? (
          <p className="text-text-faint text-sm font-mono px-2 py-4">
            Run a pipeline to see per-agent reasoning here.
          </p>
        ) : (
          traces.map((trace, idx) => (
            <AgentTraceRow
              key={`${trace.name}-${idx}`}
              trace={trace}
              isOpen={openAgents.has(`${trace.name}-${idx}`)}
              onToggle={() => toggle(`${trace.name}-${idx}`)}
              filterTicket={filterTicket}
            />
          ))
        )}
      </div>
    </section>
  );
}

function AgentTraceRow({
  trace,
  isOpen,
  onToggle,
  filterTicket,
}: {
  trace: AgentTrace;
  isOpen: boolean;
  onToggle: () => void;
  filterTicket: string | null;
}) {
  const filteredSteps =
    filterTicket === null
      ? trace.steps
      : trace.steps.filter((s) => !s.ticket_id || s.ticket_id === filterTicket);

  const stepCount =
    filterTicket === null ? trace.steps.length : filteredSteps.length;

  return (
    <div className="rounded border border-ink-rail bg-ink/40">
      <button
        onClick={onToggle}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-ink/60 transition text-left"
      >
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-text-faint">
            {AGENT_ICON[trace.name]}
          </span>
          <span className="font-sans text-sm text-text">
            {AGENT_LABEL[trace.name]}
          </span>
          {trace.skipped ? (
            <span className="font-mono text-xs text-text-faint">
              skipped · {trace.skip_reason}
            </span>
          ) : (
            <span className="font-mono text-xs text-text-faint">
              {stepCount} step{stepCount === 1 ? "" : "s"}
              {typeof trace.duration_ms === "number"
                ? ` · ${trace.duration_ms} ms`
                : ""}
            </span>
          )}
        </div>
        <span className="font-mono text-xs text-text-faint">
          {isOpen ? "−" : "+"}
        </span>
      </button>

      {isOpen && (
        <div className="px-3 pb-3 pt-1 border-t border-ink-rail space-y-3">
          <div className="text-xs font-mono text-text-faint">
            <div>
              <span className="text-accent-mint">in</span> {trace.inputs_summary}
            </div>
            <div>
              <span className="text-accent-mint">out</span> {trace.outputs_summary}
            </div>
          </div>
          {filteredSteps.length === 0 ? (
            <p className="text-xs text-text-faint italic px-1 py-2">
              No steps match the current filter.
            </p>
          ) : (
            <ol className="space-y-2">
              {filteredSteps.map((step, i) => (
                <TraceStepRow key={i} step={step} index={i + 1} />
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

function TraceStepRow({ step, index }: { step: TraceStep; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const hasData = step.data && Object.keys(step.data).length > 0;

  return (
    <li className="border-l-2 border-ink-rail pl-3 py-1">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[10px] text-text-faint">
              {String(index).padStart(2, "0")}
            </span>
            <span className="font-mono text-xs text-text uppercase tracking-wide">
              {step.label}
            </span>
            {step.ticket_id && (
              <span className="font-mono text-[10px] text-accent-mint">
                {step.ticket_id}
              </span>
            )}
          </div>
          <p className="text-sm text-text-faint mt-1">{step.detail}</p>
        </div>
        {hasData && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="font-mono text-[10px] text-text-faint hover:text-text shrink-0"
          >
            {expanded ? "hide data" : "show data"}
          </button>
        )}
      </div>
      {hasData && expanded && (
        <pre className="mt-2 text-[11px] font-mono bg-ink/60 border border-ink-rail rounded p-2 overflow-x-auto text-text-faint">
          {JSON.stringify(step.data, null, 2)}
        </pre>
      )}
    </li>
  );
}
