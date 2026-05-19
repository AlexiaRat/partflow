/**
 * Orchestrator.
 *
 * Pipeline:
 *
 *   classify (with thread context if available)
 *      |
 *      +-- is_auto_reply? -> emit auto_reply_detected, stop
 *      |
 *      +-- intent is complaint/order_confirmation/other? -> emit
 *          intent_blocked, stop (these need human handling, not a quote)
 *      |
 *      +-- for each ticket:
 *           decide completeness
 *              |
 *              +-- COMPLETE -> route -> catalog -> pricing -> add to fulfilled
 *              +-- incomplete -> draft clarification -> add to clarification list
 *           catalog needs_human_review -> add to escalated list, no pricing
 *      |
 *      +-- only if pricingBreakdowns OR (escalated has items): write final reply
 *           if only clarifications remain, skip the reply writer entirely so
 *           we don't generate a redundant or contradictory second message.
 *
 * Every agent emits an agent_trace event with structured reasoning so the
 * UI can render a per-agent and per-ticket lineage view.
 */

import { classifyEmail } from "./classifier";
import { decideCompleteness } from "./completeness";
import {
  draftClarification,
  buildClarificationTrace,
  type ClarificationDraft,
} from "./clarification";
import { routeTickets } from "./router";
import { searchCatalogBatch } from "./catalog";
import { priceTicketsBatch } from "./pricing";
import { writeReply } from "./reply-writer";
import { classifyError } from "../errors";
import {
  appendIncoming,
  appendOutgoing,
  createThread,
  getThread,
  updateOpenTickets,
} from "../conversation-store";
import type {
  IncomingEmail,
  PipelineEvent,
  PricingBreakdown,
  RoutingDecision,
  Ticket,
  AgentTrace,
  TraceStep,
} from "../types";

export async function* runPipeline(
  email: IncomingEmail,
): AsyncGenerator<PipelineEvent, void, undefined> {
  try {
    // ----- Thread management -----
    const existingThread = email.thread_id ? getThread(email.thread_id) : undefined;

    // ----- 1. Classify -----
    yield { type: "agent_status", name: "classifier", status: "running" };
    const { output: classifierOutput, trace: classifierTrace } = await classifyEmail(
      email,
      existingThread,
    );
    yield {
      type: "agent_status",
      name: "classifier",
      status: "done",
      detail: `${classifierOutput.tickets.length} ticket(s) extracted`,
    };
    yield { type: "agent_trace", trace: classifierTrace };
    yield { type: "classifier_done", output: classifierOutput };

    let threadRecord = existingThread;
    if (!threadRecord) {
      threadRecord = createThread(classifierOutput.customer, classifierOutput.language);
    }
    appendIncoming(threadRecord.thread_id, email.subject, email.body);
    yield { type: "started", thread_id: threadRecord.thread_id };

    // ----- Auto-reply short-circuit -----
    // If the email looks like an out-of-office reply AND extracted zero parts,
    // we skip the pipeline entirely to avoid replying to a robot. But if the
    // OOO message also contains a real request (e.g. "I'm out until Friday,
    // but before I leave please process my order for X"), the classifier
    // will have extracted real tickets — in that case we keep going and just
    // flag the message for operator awareness.
    if (classifierOutput.is_auto_reply) {
      if (classifierOutput.tickets.length === 0) {
        yield { type: "auto_reply_detected" };
        for (const name of ["completeness", "clarification", "router", "catalog", "pricing", "reply_writer"] as const) {
          yield { type: "agent_status", name, status: "skipped", detail: "auto-reply" };
        }
        yield { type: "finished" };
        return;
      }
      // Has tickets — auto-reply flag is advisory only. Surface in red flags
      // so the operator knows the customer might not see our reply soon.
      const existing = classifierOutput.red_flags ?? [];
      classifierOutput.red_flags = [
        ...existing,
        {
          id: "auto_reply_with_content",
          severity: "low",
          title: "Out-of-office reply containing a real request",
          detail:
            "The email looks like an automatic out-of-office response but also contains a parts request. The pipeline is processing the request normally, but the customer may not see your reply until they return. Consider holding the response or following up via phone.",
        },
      ];
    }

    // ----- Intent gate -----
    if (
      classifierOutput.intent !== "quote_request" &&
      classifierOutput.intent !== "inquiry"
    ) {
      yield {
        type: "intent_blocked",
        intent: classifierOutput.intent,
        reason: `Email classified as ${classifierOutput.intent}. Routed to human operator queue instead of generating an automated quote.`,
      };
      for (const name of ["completeness", "clarification", "router", "catalog", "pricing", "reply_writer"] as const) {
        yield { type: "agent_status", name, status: "skipped", detail: `intent=${classifierOutput.intent}` };
      }
      yield { type: "finished" };
      return;
    }

    if (classifierOutput.prompt_injection_detected) {
      yield { type: "prompt_injection_detected", sanitized: true };
    }

    // ----- No-tickets gate -----
    // Some emails pass the intent gate (classified as inquiry/quote_request)
    // but contain no actual product request. Example: a sales pitch from
    // another company that says "vrem să vă oferim servicii SEO". The
    // classifier picks "inquiry" because of the word "ofertă" but extracts
    // zero tickets. Without this gate, completeness would emit zero
    // clarifications (no tickets to clarify) and the pipeline silently
    // produces nothing. Surface this as a human-review item instead.
    if (classifierOutput.tickets.length === 0) {
      yield {
        type: "intent_blocked",
        intent: classifierOutput.intent,
        reason: `Email classified as ${classifierOutput.intent} but contains no specific part request. Likely a sales pitch, newsletter, or off-topic message. Routed to human operator queue.`,
      };
      for (const name of ["completeness", "clarification", "router", "catalog", "pricing", "reply_writer"] as const) {
        yield { type: "agent_status", name, status: "skipped", detail: "no tickets extracted" };
      }
      yield { type: "finished" };
      return;
    }

    // ----- 2. Completeness -----
    yield { type: "agent_status", name: "completeness", status: "running" };
    const { decisions, trace: completenessTrace } = decideCompleteness(classifierOutput);
    const completeCount = decisions.filter((d) => d.status === "COMPLETE").length;
    yield {
      type: "agent_status",
      name: "completeness",
      status: "done",
      detail: `${completeCount}/${decisions.length} complete`,
    };
    yield { type: "agent_trace", trace: completenessTrace };
    yield { type: "completeness_done", decisions };

    const completeTickets: Ticket[] = [];
    const clarificationDrafts: ClarificationDraft[] = [];
    const clarificationTicketIds: string[] = [];

    // ----- 3. Clarification drafts for incomplete tickets -----
    const incompleteDecisions = decisions.filter((d) => d.status !== "COMPLETE");
    if (incompleteDecisions.length > 0) {
      yield { type: "agent_status", name: "clarification", status: "running" };
      const clarStartedAt = Date.now();
      const clarSteps: TraceStep[] = [];
      for (const decision of incompleteDecisions) {
        const ticket = classifierOutput.tickets.find((t) => t.id === decision.ticket_id);
        if (!ticket) continue;
        const { draft, steps } = await draftClarification({
          ticket,
          decision,
          customer: classifierOutput.customer,
          language: classifierOutput.language,
        });
        clarSteps.push(...steps);
        clarificationDrafts.push(draft);
        clarificationTicketIds.push(ticket.id);
        // Persist clarification to thread so a follow-up reply has context
        appendOutgoing(threadRecord.thread_id, draft.subject, draft.body);
        yield {
          type: "clarification_drafted",
          ticket_id: ticket.id,
          subject: draft.subject,
          body: draft.body,
        };
      }
      yield {
        type: "agent_status",
        name: "clarification",
        status: "done",
        detail: `${clarificationDrafts.length} draft(s)`,
      };
      yield {
        type: "agent_trace",
        trace: buildClarificationTrace(
          clarSteps,
          clarificationDrafts.length,
          Date.now() - clarStartedAt,
        ),
      };
    } else {
      yield {
        type: "agent_status",
        name: "clarification",
        status: "skipped",
        detail: "all tickets complete",
      };
      yield {
        type: "agent_trace",
        trace: {
          name: "clarification",
          inputs_summary: "no incomplete tickets",
          steps: [],
          outputs_summary: "skipped",
          duration_ms: 0,
          skipped: true,
          skip_reason: "all tickets complete",
        },
      };
    }

    for (const decision of decisions) {
      if (decision.status === "COMPLETE") {
        const t = classifierOutput.tickets.find((tk) => tk.id === decision.ticket_id);
        if (t) completeTickets.push(t);
      }
    }

    // ----- 4. Router -----
    let routingDecisions: RoutingDecision[] = [];
    if (completeTickets.length === 0) {
      const skip: AgentTrace = {
        name: "router",
        inputs_summary: "no complete tickets",
        steps: [],
        outputs_summary: "skipped",
        duration_ms: 0,
        skipped: true,
        skip_reason: "no complete tickets",
      };
      yield { type: "agent_status", name: "router", status: "skipped", detail: "no complete tickets" };
      yield { type: "agent_trace", trace: skip };
    } else {
      yield { type: "agent_status", name: "router", status: "running" };
      const r = routeTickets(completeTickets);
      routingDecisions = r.decisions;
      yield {
        type: "agent_status",
        name: "router",
        status: "done",
        detail: `${routingDecisions.length} routed`,
      };
      yield { type: "agent_trace", trace: r.trace };
      yield { type: "router_done", decisions: routingDecisions };
    }

    // ----- 5. Catalog -----
    const catalogResultsMap = new Map<string, ReturnType<typeof searchCatalogBatch>["results"][number]>();
    const escalatedTicketIds: string[] = [];
    if (completeTickets.length === 0) {
      const skip: AgentTrace = {
        name: "catalog",
        inputs_summary: "no routed tickets",
        steps: [],
        outputs_summary: "skipped",
        duration_ms: 0,
        skipped: true,
        skip_reason: "no routed tickets",
      };
      yield { type: "agent_status", name: "catalog", status: "skipped", detail: "no routed tickets" };
      yield { type: "agent_trace", trace: skip };
    } else {
      yield { type: "agent_status", name: "catalog", status: "running" };
      const { results, trace } = searchCatalogBatch(
        completeTickets,
        routingDecisions,
        email.ticket_overrides,
      );
      for (const r of results) {
        catalogResultsMap.set(r.ticket_id, r);
        if (r.needs_human_review) {
          escalatedTicketIds.push(r.ticket_id);
          yield {
            type: "human_review_required",
            reason: r.review_reason ?? "Catalog search needs human review",
            ticket_id: r.ticket_id,
          };
        }
      }
      yield {
        type: "agent_status",
        name: "catalog",
        status: escalatedTicketIds.length > 0 ? "attention" : "done",
        detail:
          escalatedTicketIds.length > 0
            ? `${escalatedTicketIds.length} need(s) review`
            : `${results.length} resolved`,
      };
      yield { type: "agent_trace", trace };
      yield { type: "catalog_done", results };
    }

    // ----- 6. Pricing -----
    const pricingBreakdowns: PricingBreakdown[] = [];
    const fulfillableTickets = completeTickets.filter(
      (t) => !escalatedTicketIds.includes(t.id),
    );

    if (fulfillableTickets.length === 0) {
      const skip: AgentTrace = {
        name: "pricing",
        inputs_summary: "nothing to price",
        steps: [],
        outputs_summary: "skipped",
        duration_ms: 0,
        skipped: true,
        skip_reason: "nothing to price",
      };
      yield { type: "agent_status", name: "pricing", status: "skipped", detail: "nothing to price" };
      yield { type: "agent_trace", trace: skip };
    } else {
      yield { type: "agent_status", name: "pricing", status: "running" };
      const { breakdowns, trace } = priceTicketsBatch({
        tickets: fulfillableTickets,
        catalogResults: catalogResultsMap,
        customer: classifierOutput.customer,
      });
      pricingBreakdowns.push(...breakdowns);
      yield {
        type: "agent_status",
        name: "pricing",
        status: "done",
        detail: `${breakdowns.length} priced`,
      };
      yield { type: "agent_trace", trace };
      yield { type: "pricing_done", breakdowns };
    }

    // ----- 7. Reply writer (only if there's something to say in a main reply) -----
    // Skip when there are zero priced tickets AND zero escalations. In that
    // case, all customer-facing communication is the per-ticket clarification
    // drafts we already emitted, and a redundant main reply would be confusing.
    const needsMainReply = pricingBreakdowns.length > 0 || escalatedTicketIds.length > 0;
    if (!needsMainReply) {
      const skip: AgentTrace = {
        name: "reply_writer",
        inputs_summary: "only clarification(s) outstanding",
        steps: [],
        outputs_summary: "skipped (clarification drafts cover the customer reply)",
        duration_ms: 0,
        skipped: true,
        skip_reason: "only clarification(s) outstanding",
      };
      yield {
        type: "agent_status",
        name: "reply_writer",
        status: "skipped",
        detail: "clarifications cover the reply",
      };
      yield { type: "agent_trace", trace: skip };
    } else {
      yield { type: "agent_status", name: "reply_writer", status: "running" };
      const { reply, trace } = await writeReply({
        thread_id: threadRecord.thread_id,
        customer: classifierOutput.customer,
        language: classifierOutput.language,
        tickets: classifierOutput.tickets,
        fulfilledBreakdowns: pricingBreakdowns,
        catalogResults: catalogResultsMap,
        escalatedTickets: escalatedTicketIds,
        clarificationTickets: clarificationTicketIds,
        customerOriginalBody: email.body,
      });
      yield { type: "agent_status", name: "reply_writer", status: "done" };
      yield { type: "agent_trace", trace };
      yield { type: "reply_done", reply };

      appendOutgoing(threadRecord.thread_id, reply.subject, reply.body);
    }

    // Update open tickets on the thread record
    const openTickets = classifierOutput.tickets.filter(
      (t) =>
        clarificationTicketIds.includes(t.id) ||
        escalatedTicketIds.includes(t.id),
    );
    updateOpenTickets(threadRecord.thread_id, openTickets);

    yield { type: "finished" };
  } catch (error) {
    yield { type: "error", friendly: classifyError(error) };
  }
}
