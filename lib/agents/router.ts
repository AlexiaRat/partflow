/**
 * Router Agent.
 *
 * Assigns each complete ticket to a department:
 * Motor / Transmisie / Suspensie / Franare / Electric / Caroserie.
 *
 * Primary path: if the classifier already extracted a category, map it 1:1.
 *
 * Fallback path: keyword match on the part_type + description. Keywords are
 * checked with word-boundary semantics, not naive substring, because in
 * Romanian "fara" (without) contains "far" (headlight) which used to route
 * everyday phrases to ELECTRIC. Multi-word keywords are matched as a phrase.
 *
 * Default: if nothing matches, MOTOR with low confidence (operator should
 * verify, but it's the most common department by volume).
 *
 * Emits a trace showing which path matched per ticket.
 */

import type {
  Ticket,
  RoutingDecision,
  Department,
  PartCategory,
  AgentTrace,
  TraceStep,
} from "../types";

const CATEGORY_TO_DEPARTMENT: Record<PartCategory, Department> = {
  ENGINE: "MOTOR",
  TRANSMISSION: "TRANSMISIE",
  SUSPENSION: "SUSPENSIE",
  BRAKING: "FRANARE",
  ELECTRICAL: "ELECTRIC",
  BODY: "CAROSERIE",
};

const KEYWORD_FALLBACK: Array<{ words: string[]; department: Department }> = [
  {
    words: ["brake", "pad", "disc", "caliper", "abs", "frana", "frane", "placuta", "placute", "bremsen", "bremsbelag"],
    department: "FRANARE",
  },
  {
    words: ["clutch", "gearbox", "transmission", "flywheel", "ambreiaj", "cutie", "volanta", "kupplung"],
    department: "TRANSMISIE",
  },
  {
    words: ["shock", "absorber", "spring", "strut", "bearing", "amortizor", "arc", "arcuri", "rulment", "rulmenti", "stabilizator", "stoßdämpfer"],
    department: "SUSPENSIE",
  },
  {
    words: ["alternator", "starter", "battery", "ignition", "lambda", "maf", "headlight", "bulb", "demaror", "baterie", "bujie", "bujii", "far", "faruri", "lichtmaschine"],
    department: "ELECTRIC",
  },
  {
    words: ["bumper", "mirror", "wiper", "hood", "bara", "oglinda", "stergator", "stergatoare", "capota", "stoßstange"],
    department: "CAROSERIE",
  },
  {
    words: ["fuel", "oil", "air", "filter", "spark", "glow", "timing", "water", "turbocharger", "intercooler", "egr", "sensor", "pompa", "filtru", "filtre", "curea", "turbo", "ölfilter", "kraftstoff"],
    department: "MOTOR",
  },
];

// Strip diacritics so "ștergător" matches "stergator", "Türöl" matches "turol", etc.
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u0218\u0219]/g, "s") // Ș, ș
    .replace(/[\u021a\u021b]/g, "t") // Ț, ț
    .replace(/[\u00df]/g, "ss");      // ß
}

// Tokenize a string into a Set of words, so we can do whole-word matching.
function tokenSet(text: string): Set<string> {
  return new Set(normalize(text).split(/[^a-z0-9]+/).filter(Boolean));
}

// Check if `keyword` (which may contain spaces for multi-word keywords) is
// present in the tokenized text as a whole word or whole phrase.
function tokenMatch(textTokens: Set<string>, text: string, keyword: string): boolean {
  if (keyword.includes(" ")) {
    return normalize(text).includes(normalize(keyword));
  }
  return textTokens.has(normalize(keyword));
}

export interface RouteResult {
  decisions: RoutingDecision[];
  trace: AgentTrace;
}

export function routeTickets(tickets: Ticket[]): RouteResult {
  const startedAt = Date.now();
  const traceSteps: TraceStep[] = [];

  const decisions = tickets.map((ticket) => {
    const { decision, step } = routeOne(ticket);
    traceSteps.push(step);
    return decision;
  });

  const trace: AgentTrace = {
    name: "router",
    inputs_summary: `${tickets.length} complete ticket(s) to route`,
    steps: traceSteps,
    outputs_summary: decisions
      .map((d) => `${d.ticket_id}→${d.department}(${d.confidence.toFixed(2)})`)
      .join(", "),
    duration_ms: Date.now() - startedAt,
  };

  return { decisions, trace };
}

function routeOne(ticket: Ticket): { decision: RoutingDecision; step: TraceStep } {
  // Path A: classifier already gave us a category.
  if (ticket.request.category) {
    const department = CATEGORY_TO_DEPARTMENT[ticket.request.category];
    return {
      decision: { ticket_id: ticket.id, department, confidence: 0.95 },
      step: {
        label: `ticket ${ticket.id}: classifier category`,
        ticket_id: ticket.id,
        detail: `Classifier extracted category=${ticket.request.category}, mapped to ${department} (conf 0.95).`,
        data: { path: "category_direct" },
      },
    };
  }

  // Path B: keyword fallback with whole-word matching.
  const searchText = `${ticket.request.part_type ?? ""} ${ticket.request.description}`;
  const tokens = tokenSet(searchText);
  for (const rule of KEYWORD_FALLBACK) {
    for (const word of rule.words) {
      if (tokenMatch(tokens, searchText, word)) {
        return {
          decision: { ticket_id: ticket.id, department: rule.department, confidence: 0.75 },
          step: {
            label: `ticket ${ticket.id}: keyword match`,
            ticket_id: ticket.id,
            detail: `No category from classifier. Matched keyword "${word}" in part text → ${rule.department} (conf 0.75).`,
            data: { path: "keyword_fallback", keyword: word },
          },
        };
      }
    }
  }

  // Path C: nothing matched.
  return {
    decision: { ticket_id: ticket.id, department: "MOTOR", confidence: 0.3 },
    step: {
      label: `ticket ${ticket.id}: default route`,
      ticket_id: ticket.id,
      detail: "No category and no keyword matched. Defaulting to MOTOR with low confidence (operator should verify).",
      data: { path: "default" },
    },
  };
}
