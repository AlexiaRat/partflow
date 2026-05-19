"use client";

import { useCallback, useRef, useState } from "react";
import EmailInput from "./EmailInput";
import PipelinePanel from "./PipelinePanel";
import OutputPanel from "./OutputPanel";
import TicketSidebar from "./TicketSidebar";
import ErrorPanel from "./ErrorPanel";
import AgentTracePanel from "./AgentTracePanel";
import type {
  AgentName,
  AgentState,
  AgentTrace,
  ClassifierOutput,
  CompletenessDecision,
  EmailIntent,
  FriendlyError,
  IncomingEmail,
  PipelineEvent,
  PricingBreakdown,
  QuoteReply,
  CatalogResult,
  RoutingDecision,
} from "@/lib/types";
import { EXAMPLE_EMAILS } from "@/components/examples";

interface ClarificationDraftLite {
  ticket_id: string;
  subject: string;
  body: string;
}

const AGENT_ORDER: AgentName[] = [
  "classifier",
  "completeness",
  "clarification",
  "router",
  "catalog",
  "pricing",
  "reply_writer",
];

const INITIAL_AGENTS: Record<AgentName, AgentState> = {
  classifier: { name: "classifier", status: "pending" },
  completeness: { name: "completeness", status: "pending" },
  clarification: { name: "clarification", status: "pending" },
  router: { name: "router", status: "pending" },
  catalog: { name: "catalog", status: "pending" },
  pricing: { name: "pricing", status: "pending" },
  reply_writer: { name: "reply_writer", status: "pending" },
};

export default function Dashboard() {
  const [running, setRunning] = useState(false);
  const [agents, setAgents] = useState<Record<AgentName, AgentState>>(INITIAL_AGENTS);
  const [classifier, setClassifier] = useState<ClassifierOutput | null>(null);
  const [decisions, setDecisions] = useState<CompletenessDecision[]>([]);
  const [routing, setRouting] = useState<RoutingDecision[]>([]);
  const [catalogResults, setCatalogResults] = useState<CatalogResult[]>([]);
  const [pricing, setPricing] = useState<PricingBreakdown[]>([]);
  const [clarifications, setClarifications] = useState<ClarificationDraftLite[]>([]);
  const [reply, setReply] = useState<QuoteReply | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [humanReviewItems, setHumanReviewItems] = useState<Array<{ ticket_id: string; reason: string }>>([]);
  const [flags, setFlags] = useState<{ autoReply: boolean; injection: boolean; intentBlocked: EmailIntent | null }>({
    autoReply: false,
    injection: false,
    intentBlocked: null,
  });
  const [threadId, setThreadId] = useState<string | null>(null);
  const [continuingThreadId, setContinuingThreadId] = useState<string | null>(null);
  const [traces, setTraces] = useState<AgentTrace[]>([]);

  // Last email submitted (so we can re-submit with operator overrides for
  // human-in-the-loop resolutions).
  const [lastEmail, setLastEmail] = useState<IncomingEmail | null>(null);
  // The body of the last actually-submitted email, surfaced to EmailInput so
  // it can render an English operator view once classifier detects language.
  const [lastSubmittedBody, setLastSubmittedBody] = useState<string | null>(null);
  // Overrides the operator is staging but hasn't applied yet (ticket_id -> SKU)
  const [pendingOverrides, setPendingOverrides] = useState<Record<string, string>>({});
  // Overrides actually applied in the current run
  const [appliedOverrides, setAppliedOverrides] = useState<Record<string, string>>({});

  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setAgents(INITIAL_AGENTS);
    setClassifier(null);
    setDecisions([]);
    setRouting([]);
    setCatalogResults([]);
    setPricing([]);
    setClarifications([]);
    setReply(null);
    setError(null);
    setHumanReviewItems([]);
    setFlags({ autoReply: false, injection: false, intentBlocked: null });
    setTraces([]);
  }, []);

  const startFresh = useCallback(() => {
    setContinuingThreadId(null);
    setThreadId(null);
    setLastEmail(null);
    setLastSubmittedBody(null);
    setPendingOverrides({});
    setAppliedOverrides({});
    reset();
  }, [reset]);

  const continueThread = useCallback(() => {
    if (threadId) setContinuingThreadId(threadId);
  }, [threadId]);

  const runPipeline = useCallback(
    async (email: IncomingEmail, isRerun = false) => {
      abortRef.current?.abort();
      reset();
      setLastSubmittedBody(email.body);
      setRunning(true);

      // On a re-run, the appliedOverrides we're sending in this submit are
      // the ones that will appear in the result.
      if (isRerun) {
        setAppliedOverrides(email.ticket_overrides ?? {});
        setPendingOverrides({});
      } else {
        setAppliedOverrides({});
        setPendingOverrides({});
      }

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch("/api/process-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(email),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          setError({
            title: "The server could not handle this request",
            message: `The API responded with status ${response.status}.`,
            tip: "Refresh the page and try again. If it keeps failing, check the dev server console.",
          });
          return;
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let sep = buffer.indexOf("\n\n");
          while (sep !== -1) {
            const frame = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            handleFrame(frame);
            sep = buffer.indexOf("\n\n");
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError({
          title: "Connection to the agent was interrupted",
          message: "The browser lost contact with the server while processing.",
          tip: "Check your internet connection and try again. If the dev server stopped, restart with `npm run dev`.",
        });
      } finally {
        setRunning(false);
        abortRef.current = null;
      }
    },
    [reset],
  );

  const submit = useCallback(
    async (email: IncomingEmail) => {
      if (running) return;
      setLastEmail(email);
      await runPipeline(email, false);
    },
    [running, runPipeline],
  );

  const pickOverride = useCallback((ticketId: string, sku: string) => {
    setPendingOverrides((prev) => {
      // If clicking the same one again, toggle it off
      if (prev[ticketId] === sku) {
        const next = { ...prev };
        delete next[ticketId];
        return next;
      }
      return { ...prev, [ticketId]: sku };
    });
  }, []);

  const applyOverrides = useCallback(async () => {
    if (!lastEmail || running) return;
    if (Object.keys(pendingOverrides).length === 0) return;
    const mergedOverrides = { ...appliedOverrides, ...pendingOverrides };
    const reEmail: IncomingEmail = {
      ...lastEmail,
      ticket_overrides: mergedOverrides,
    };
    await runPipeline(reEmail, true);
  }, [lastEmail, running, pendingOverrides, appliedOverrides, runPipeline]);

  const handleFrame = (frame: string) => {
    const line = frame.startsWith("data: ") ? frame.slice(6) : frame;
    if (!line.trim()) return;
    let event: PipelineEvent;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }

    switch (event.type) {
      case "started":
        setThreadId(event.thread_id);
        break;
      case "agent_status":
        setAgents((prev) => ({
          ...prev,
          [event.name]: {
            name: event.name,
            status: event.status,
            detail: event.detail,
            started_at: event.status === "running" ? new Date().toISOString() : prev[event.name].started_at,
            completed_at: ["done", "skipped", "error", "attention"].includes(event.status)
              ? new Date().toISOString()
              : prev[event.name].completed_at,
          },
        }));
        break;
      case "agent_trace":
        setTraces((prev) => [...prev, event.trace]);
        break;
      case "classifier_done":
        setClassifier(event.output);
        break;
      case "completeness_done":
        setDecisions(event.decisions);
        break;
      case "clarification_drafted":
        setClarifications((prev) => [
          ...prev,
          { ticket_id: event.ticket_id, subject: event.subject, body: event.body },
        ]);
        break;
      case "router_done":
        setRouting(event.decisions);
        break;
      case "catalog_done":
        setCatalogResults(event.results);
        break;
      case "pricing_done":
        setPricing(event.breakdowns);
        break;
      case "reply_done":
        setReply(event.reply);
        break;
      case "human_review_required":
        setHumanReviewItems((prev) => [...prev, { ticket_id: event.ticket_id, reason: event.reason }]);
        break;
      case "auto_reply_detected":
        setFlags((prev) => ({ ...prev, autoReply: true }));
        break;
      case "prompt_injection_detected":
        setFlags((prev) => ({ ...prev, injection: true }));
        break;
      case "intent_blocked":
        setFlags((prev) => ({ ...prev, intentBlocked: event.intent }));
        break;
      case "error":
        setError(event.friendly);
        break;
    }
  };

  return (
    <div className="grid grid-cols-12 gap-6">
      {/* Left column - Input + Tickets */}
      <div className="col-span-12 lg:col-span-3 space-y-4">
        <EmailInput
          onSubmit={submit}
          running={running}
          examples={EXAMPLE_EMAILS}
          continuingThreadId={continuingThreadId}
          onClearThread={startFresh}
          lastIncomingBody={lastSubmittedBody}
          lastIncomingLanguage={classifier?.language ?? null}
        />
        {classifier && (
          <TicketSidebar
            classifier={classifier}
            decisions={decisions}
            humanReviewItems={humanReviewItems}
            threadId={threadId}
          />
        )}
        {threadId && !continuingThreadId && !running && (
          <button
            onClick={continueThread}
            className="w-full px-3 py-2 rounded border border-accent-mint/40 hover:border-accent-mint text-accent-mint text-xs font-mono uppercase tracking-wider transition"
          >
            continue this thread
          </button>
        )}
      </div>

      {/* Center column - Pipeline */}
      <div className="col-span-12 lg:col-span-5 space-y-4">
        <PipelinePanel
          agents={AGENT_ORDER.map((n) => agents[n])}
          flags={flags}
          classifier={classifier}
          decisions={decisions}
          routing={routing}
          catalogResults={catalogResults}
          pricing={pricing}
        />
        <AgentTracePanel traces={traces} />
      </div>

      {/* Right column - Output */}
      <div className="col-span-12 lg:col-span-4 space-y-4">
        {error && <ErrorPanel error={error} />}
        <OutputPanel
          reply={reply}
          clarifications={clarifications}
          humanReviewItems={humanReviewItems}
          classifier={classifier}
          decisions={decisions}
          catalogResults={catalogResults}
          pendingOverrides={pendingOverrides}
          appliedOverrides={appliedOverrides}
          onPick={pickOverride}
          onApply={applyOverrides}
          running={running}
          flags={flags}
        />
      </div>
    </div>
  );
}
