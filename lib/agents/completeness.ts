/**
 * Completeness Decider.
 *
 * After classification, every ticket is evaluated: do we have enough info to
 * route + look up the catalog, or do we need to ask for more details first?
 *
 * The decision logic is deterministic (rules, not an LLM). Rules:
 *   - No vehicle identified at all              -> NEEDS_VEHICLE
 *   - Have brand+model but no year/engine, AND part
 *     is one whose variants differ by engine     -> NEEDS_VIN
 *   - Part description too vague                 -> NEEDS_PART_DETAIL
 *   - DAMAGED_PART photo but no readable label   -> NEEDS_PHOTO
 *   - Confidence on part identification < 0.6    -> NEEDS_PART_DETAIL
 *   - Otherwise                                  -> COMPLETE
 *
 * Emits a trace describing which rule fired for each ticket so the operator
 * can see exactly why a ticket got bounced.
 */

import type {
  CompletenessDecision,
  Ticket,
  ClassifierOutput,
  AgentTrace,
  TraceStep,
} from "../types";

const ENGINE_SPECIFIC_PARTS = new Set([
  "fuel pump",
  "water pump",
  "timing belt",
  "turbocharger",
  "egr valve",
  "alternator",
  "starter motor",
  "ignition coil",
  "glow plug",
  "spark plug",
  "lambda sensor",
  "maf sensor",
  "clutch kit",
  "dual mass flywheel",
]);

function isEngineSpecific(partType?: string): boolean {
  if (!partType) return false;
  const lower = partType.toLowerCase();
  for (const p of ENGINE_SPECIFIC_PARTS) {
    if (lower.includes(p)) return true;
  }
  return false;
}

export interface CompletenessResult {
  decisions: CompletenessDecision[];
  trace: AgentTrace;
}

export function decideCompleteness(output: ClassifierOutput): CompletenessResult {
  const startedAt = Date.now();
  const traceSteps: TraceStep[] = [];

  const decisions = output.tickets.map((ticket) => {
    const decision = evaluateTicket(ticket, output);
    traceSteps.push({
      label: `ticket ${ticket.id}: ${decision.status}`,
      ticket_id: ticket.id,
      detail: decision.reasoning,
      data: {
        rule_fired: decision.status,
        missing_fields: decision.missing_fields,
        vehicle: {
          brand: ticket.vehicle.brand,
          model: ticket.vehicle.model,
          year: ticket.vehicle.year,
          engine: ticket.vehicle.engine,
          vin: ticket.vehicle.vin,
        },
        part: {
          type: ticket.request.part_type,
          number: ticket.request.part_number,
          confidence: ticket.request.confidence,
        },
        engine_specific: isEngineSpecific(ticket.request.part_type),
      },
    });
    return decision;
  });

  const completeCount = decisions.filter((d) => d.status === "COMPLETE").length;
  const trace: AgentTrace = {
    name: "completeness",
    inputs_summary: `${output.tickets.length} ticket(s) from classifier`,
    steps: traceSteps,
    outputs_summary: `${completeCount}/${decisions.length} ticket(s) complete, ${decisions.length - completeCount} need clarification`,
    duration_ms: Date.now() - startedAt,
  };

  return { decisions, trace };
}

function evaluateTicket(
  ticket: Ticket,
  classifier: ClassifierOutput,
): CompletenessDecision {
  const v = ticket.vehicle;
  const r = ticket.request;

  const hasVin = Boolean(v.vin);
  const hasFullVehicle = Boolean(v.brand && v.model && v.year);
  const hasBrandModel = Boolean(v.brand && v.model);

  if (!hasVin && !hasBrandModel) {
    return {
      ticket_id: ticket.id,
      status: "NEEDS_VEHICLE",
      missing_fields: ["vehicle brand and model"],
      reasoning:
        "The email does not identify which vehicle the customer drives. Without brand and model we cannot suggest compatible parts.",
    };
  }

  if (!hasVin && isEngineSpecific(r.part_type)) {
    if (!hasFullVehicle || !v.engine) {
      const need: string[] = [];
      if (!v.year) need.push("vehicle year");
      if (!v.engine) need.push("engine variant (e.g. 1.5 dCi, 2.0 TDI)");
      return {
        ticket_id: ticket.id,
        status: "NEEDS_VIN",
        missing_fields: need,
        reasoning: `${r.part_type ?? "This part"} varies between engine variants of the same model. We need either the VIN or both year and engine to match the correct part.`,
      };
    }
  }

  if (!r.part_type && !r.part_number) {
    return {
      ticket_id: ticket.id,
      status: "NEEDS_PART_DETAIL",
      missing_fields: ["specific part name or part number"],
      reasoning:
        "The email mentions a part but is too vague to identify which specific component is needed.",
    };
  }

  if (r.confidence < 0.6) {
    return {
      ticket_id: ticket.id,
      status: "NEEDS_PART_DETAIL",
      missing_fields: ["clearer part description or photo of the part label"],
      reasoning:
        "The part identification confidence is low. A clearer description, or a photo of the OEM label on the original part, would help.",
    };
  }

  const damagedPartWithNoLabel = classifier.attachments.some(
    (a) =>
      a.classification === "DAMAGED_PART" &&
      !a.part_number &&
      (!a.ocr_text || a.ocr_text.length < 5),
  );
  const hasLabelAttachment = classifier.attachments.some(
    (a) => a.classification === "PART_LABEL",
  );
  if (
    damagedPartWithNoLabel &&
    !hasLabelAttachment &&
    !r.part_number &&
    r.confidence < 0.85
  ) {
    return {
      ticket_id: ticket.id,
      status: "NEEDS_PHOTO",
      missing_fields: ["photo of the part's OEM label or part number"],
      reasoning:
        "A photo of the damaged part was sent but no readable label was found. A close-up of the OEM sticker/part number would let us identify the exact replacement.",
    };
  }

  return {
    ticket_id: ticket.id,
    status: "COMPLETE",
    missing_fields: [],
    reasoning: "All required fields are present with acceptable confidence.",
  };
}
