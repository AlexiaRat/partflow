/**
 * Catalog Agent.
 *
 * Searches the catalog for parts matching a ticket. Returns up to 5 matches
 * scored by how well they fit the request. No LLM, pure data lookup.
 *
 * Path A (exact part_number): looks for an EXACT SKU match, or an exact
 * substring match against the SKU's trailing identifier segment. The old
 * version used naive `sku.includes(partNumber)`, which matched 32 SKUs for
 * the substring "FUEL" and ordered them arbitrarily.
 *
 * Path B (scored search): if no exact match, score each part on brand +
 * model + year + engine + keyword. Category-gated to the routed department.
 *
 * Escalation:
 *   - 0 candidates at threshold → needs_human_review
 *   - Top candidate below 0.6 → needs_human_review (low confidence)
 *   - 2+ candidates clustered above 0.7 → needs_human_review (ambiguous)
 *
 * Scoring uses a multilingual term dictionary so Romanian "placute frana spate"
 * tokens become {placute, frana, spate, pad, brake, rear} and match the
 * English part name "Rear Brake Pad Set" on three signals at once. Position
 * keywords carry their own bonus/penalty so front/rear can't tie.
 *
 * Trace surfaces the scoring breakdown for every candidate above the floor.
 */

import catalog from "../data/catalog.json";
import type {
  CatalogPart,
  CatalogResult,
  CatalogMatch,
  Ticket,
  RoutingDecision,
  PartCategory,
  Department,
  AgentTrace,
  TraceStep,
} from "../types";

const CATALOG: CatalogPart[] = catalog as CatalogPart[];

const DEPARTMENT_TO_CATEGORY: Record<Department, PartCategory> = {
  MOTOR: "ENGINE",
  TRANSMISIE: "TRANSMISSION",
  SUSPENSIE: "SUSPENSION",
  FRANARE: "BRAKING",
  ELECTRIC: "ELECTRICAL",
  CAROSERIE: "BODY",
};

const SCORE_FLOOR = 0.3;
const STRONG_THRESHOLD = 0.7;
const ESCALATE_BELOW = 0.6;
// Lowered from 5: even 2 candidates with near-identical scores means the
// operator should disambiguate. With 5, vague requests like "brake pads
// Logan" would auto-pick whichever variant happened to be first.
const AMBIGUOUS_CLUSTER_SIZE = 2;

// Multilingual term map for the most common parts vocabulary. The expandTokens
// helper folds these into the customer's tokens so a Romanian "placute frana
// spate" matches an English part name "Rear Brake Pad Set". Keep the keys
// normalized (lowercase, no diacritics, ß → ss).
const TERM_TRANSLATIONS: Record<string, string[]> = {
  // Romanian → English
  fata: ["front"],
  spate: ["rear"],
  stanga: ["left"],
  dreapta: ["right"],
  placuta: ["pad"],
  placute: ["pad"],
  frana: ["brake"],
  frane: ["brake"],
  disc: ["disc"],
  discuri: ["disc"],
  pompa: ["pump"],
  filtru: ["filter"],
  filtre: ["filter"],
  ulei: ["oil"],
  aer: ["air"],
  apa: ["water"],
  combustibil: ["fuel"],
  ambreiaj: ["clutch"],
  bujie: ["plug"],
  bujii: ["plug"],
  curea: ["belt"],
  amortizor: ["shock"],
  amortizoare: ["shock"],
  arc: ["spring"],
  arcuri: ["spring"],
  rulment: ["bearing"],
  rulmenti: ["bearing"],
  demaror: ["starter"],
  baterie: ["battery"],
  far: ["headlight"],
  faruri: ["headlight"],
  stergator: ["wiper"],
  stergatoare: ["wiper"],
  capota: ["hood"],
  oglinda: ["mirror"],
  oglinzi: ["mirror"],
  bara: ["bumper"],
  volanta: ["flywheel"],
  incandescenta: ["glow"],
  incandescente: ["glow"],
  alternator: ["alternator"],
  // German → English
  bremsbelag: ["brake", "pad"],
  bremsbelage: ["brake", "pad"],
  bremse: ["brake"],
  bremsen: ["brake"],
  bremsscheibe: ["brake", "disc"],
  bremsscheiben: ["brake", "disc"],
  vorne: ["front"],
  hinten: ["rear"],
  links: ["left"],
  rechts: ["right"],
  kraftstoff: ["fuel"],
  olfilter: ["oil", "filter"],
  luftfilter: ["air", "filter"],
  kupplung: ["clutch"],
  wasserpumpe: ["water", "pump"],
  gluhkerzen: ["glow", "plug"],
  zundkerzen: ["spark", "plug"],
  scheinwerfer: ["headlight"],
  lichtmaschine: ["alternator"],
  anlasser: ["starter"],
  stossdampfer: ["shock"],
  stossstange: ["bumper"],
  // Hungarian → English
  fekbetet: ["brake", "pad"],
  fekbetetek: ["brake", "pad"],
  fek: ["brake"],
  fektarcsak: ["brake", "disc"],
  elso: ["front"],
  hatso: ["rear"],
  bal: ["left"],
  jobb: ["right"],
  olajszuro: ["oil", "filter"],
  izzitogyertyak: ["glow", "plug"],
  vizszivattyu: ["water", "pump"],
};

// Position words (any language, post-normalize/translate)
const POSITION_KEYWORDS = ["front", "rear", "left", "right"];

// Substantive part nouns. These carry meaning about WHAT the part is, not
// where it sits on the vehicle. Matching one of these is a stronger signal
// than matching a generic word. Includes both specific part names (pad, disc,
// pump, filter) AND system/fluid qualifiers (fuel, water, oil, air, brake)
// so "fuel pump" can be distinguished from "water pump" — both share "pump"
// but only the right system qualifier matches.
const PART_NOUNS = [
  // Specific physical parts
  "pad", "disc", "pump", "filter", "clutch", "plug", "belt", "shock",
  "spring", "bearing", "alternator", "starter", "battery", "headlight",
  "bulb", "wiper", "hood", "mirror", "bumper", "caliper", "flywheel",
  "sensor", "valve", "rotor", "fluid", "cable", "hose", "switch", "tank",
  // System / fluid / medium qualifiers — distinguish "fuel pump" from "water
  // pump", "oil filter" from "air filter", etc.
  "fuel", "water", "oil", "air", "brake", "coolant", "transmission",
  "glow", "spark",
];

// Specific component nouns — the THING itself. Within a single category
// (e.g. BRAKING), these are mutually exclusive: if a customer says "pad"
// they don't also want a "disc" or "caliper" or "cable". When a customer
// specifies one of these and a candidate part contains a DIFFERENT one,
// the candidate is the wrong product family and gets penalized.
//
// Generic category words like "brake", "fuel", "water" are NOT here — those
// are qualifiers describing the system, not the component.
const SPECIFIC_COMPONENT_NOUNS = new Set([
  "pad", "disc", "pump", "filter", "clutch", "plug", "belt", "shock",
  "spring", "bearing", "alternator", "starter", "battery", "headlight",
  "bulb", "wiper", "hood", "mirror", "bumper", "caliper", "flywheel",
  "sensor", "valve", "rotor", "fluid", "cable", "hose", "switch", "tank",
]);

// Negation words that mean the customer is REJECTING the part noun that
// follows. "fara disc" = without disc → exclude disc-containing parts.
const NEGATION_WORDS = new Set([
  // Romanian
  "fara",
  // English
  "without", "no", "not",
  // German
  "ohne", "kein", "keine",
  // Hungarian
  "nem", "nincs", "nelkul",
]);

// Filler words allowed between a negation and the actual noun: "fara de disc"
// still means "without disc".
const NEGATION_FILLER = new Set([
  "de", "a", "an", "the", "der", "die", "das", "of",
]);

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining diacritics
    .replace(/[\u0218\u0219]/g, "s") // Ș, ș → s
    .replace(/[\u021a\u021b]/g, "t") // Ț, ț → t
    .replace(/\u00df/g, "ss"); // ß → ss
}

/**
 * Brand match. Case-insensitive substring on either side so "Mercedes" matches
 * "Mercedes-Benz" and "VW" matches "Volkswagen" via the dictionary expansion.
 */
function brandMatches(customer: string | undefined, catalog: string): boolean {
  if (!customer) return false;
  const c = normalize(customer);
  const k = normalize(catalog);
  return c === k || k.includes(c) || c.includes(k);
}

/**
 * Lenient model matching. Customers write trim/engine codes ("C 220 d",
 * "320d", "Golf 7"); the catalog stores model families ("C-Class", "Seria 3",
 * "Golf"). We treat the model as the FAMILY identifier and accept several
 * shapes:
 *
 *   - "C 220 d" vs "C-Class": first token "c" equals first token "c".
 *   - "C220d" vs "C-Class": catalog's "c" is a single-letter prefix of "c220d".
 *   - "X 3" vs "X3": joined tokens match.
 *   - "Golf 7" vs "Golf": first token equality.
 *   - "320d" vs "Seria 3": digit prefix of customer matches a catalog token.
 */
function modelMatches(customer: string | undefined, catalog: string): boolean {
  if (!customer) return false;
  const cTokens = normalize(customer).split(/[^a-z0-9]+/).filter(Boolean);
  const kTokens = normalize(catalog).split(/[^a-z0-9]+/).filter(Boolean);
  if (!cTokens.length || !kTokens.length) return false;

  if (cTokens.join("") === kTokens.join("")) return true;
  if (cTokens[0] === kTokens[0]) return true;
  // Single-letter prefix match: "C 220" vs "C-Class" or "C220d" vs "C-Class"
  if (cTokens[0].length === 1 && kTokens[0].startsWith(cTokens[0])) return true;
  if (kTokens[0].length === 1 && cTokens[0].startsWith(kTokens[0])) return true;
  // Digit-prefix customer model: "320d" -> first digit "3" -> match "Seria 3"
  const cFirstDigit = cTokens[0].match(/^\d/)?.[0];
  if (cFirstDigit && kTokens.includes(cFirstDigit)) return true;
  return false;
}

function expandTokens(text: string): Set<string> {
  const tokens = normalize(text).split(/[^a-z0-9]+/).filter(Boolean);
  const expanded = new Set<string>(tokens);
  for (const token of tokens) {
    const translations = TERM_TRANSLATIONS[token];
    if (translations) {
      for (const t of translations) expanded.add(t);
    }
    // Basic plural stemming so "pads" matches "pad", "discs" matches "disc",
    // "filters" matches "filter". We only strip a trailing 's' for tokens of
    // length 4+ and not already ending in 'ss' (don't break "brass", "glass").
    // Also handle '-es' (e.g. "hoses" → "hose", "brakes" → "brake") and
    // '-ies' → '-y' (e.g. "batteries" → "battery").
    if (token.length >= 4 && token.endsWith("s") && !token.endsWith("ss")) {
      let singular: string;
      if (token.endsWith("ies") && token.length >= 5) {
        singular = token.slice(0, -3) + "y";
      } else if (token.endsWith("es") && token.length >= 5) {
        singular = token.slice(0, -2);
      } else {
        singular = token.slice(0, -1);
      }
      expanded.add(singular);
      // Translations of the singular too
      const trSing = TERM_TRANSLATIONS[singular];
      if (trSing) {
        for (const t of trSing) expanded.add(t);
      }
    }
  }
  return expanded;
}

/**
 * Find part nouns the customer explicitly rejected with negation phrases like
 * "fara disc", "without disc", "ohne Scheibe", "nem fektarcsa". Returns the
 * English-normalized noun set so the caller can compare against part names.
 *
 * When a translated noun expands into multiple candidates (e.g. German
 * "Bremsscheiben" → ["brake", "disc"]), we prefer the specific noun ("disc")
 * over the generic category ("brake"). The customer rejecting "Bremsscheiben"
 * does not mean they reject anything with "brake" in the name — they reject
 * discs specifically.
 */
function extractExcludedNouns(text: string): Set<string> {
  const CATEGORY_NOUNS = new Set(["brake"]);
  const tokens = normalize(text).split(/[^a-z0-9]+/).filter(Boolean);
  const excluded = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    if (!NEGATION_WORDS.has(tokens[i])) continue;
    for (let j = i + 1; j < Math.min(i + 4, tokens.length); j++) {
      if (NEGATION_FILLER.has(tokens[j])) continue;
      const tok = tokens[j];
      const translations = TERM_TRANSLATIONS[tok] ?? [];
      const candidates = [tok, ...translations];
      let specific: string | null = null;
      let generic: string | null = null;
      for (const c of candidates) {
        if (!PART_NOUNS.includes(c)) continue;
        if (CATEGORY_NOUNS.has(c)) {
          generic = c;
        } else if (!specific) {
          specific = c;
        }
      }
      // Prefer specific. Fall back to generic only if no specific noun was
      // matched (e.g. customer literally typed "fara frana" in isolation).
      if (specific) excluded.add(specific);
      else if (generic) excluded.add(generic);
      break;
    }
  }
  return excluded;
}

export interface CatalogSearchResult {
  result: CatalogResult;
  trace: AgentTrace;
}

export function searchCatalogBatch(
  tickets: Ticket[],
  routings: RoutingDecision[],
  overrides?: Record<string, string>,
): { results: CatalogResult[]; trace: AgentTrace } {
  const startedAt = Date.now();
  const traceSteps: TraceStep[] = [];
  const results: CatalogResult[] = [];

  for (const ticket of tickets) {
    const routing = routings.find((r) => r.ticket_id === ticket.id);
    if (!routing) continue;

    // Operator override path: pick the chosen SKU directly, skip scoring.
    const overrideSku = overrides?.[ticket.id];
    if (overrideSku) {
      const part = CATALOG.find((p) => p.sku === overrideSku);
      if (part) {
        const primary: CatalogMatch = {
          part,
          match_score: 1.0,
          match_reasons: ["operator override"],
        };
        results.push({
          ticket_id: ticket.id,
          matches: [primary],
          primary,
          needs_human_review: false,
        });
        traceSteps.push({
          label: `ticket ${ticket.id}: operator override`,
          ticket_id: ticket.id,
          detail: `Operator picked SKU ${overrideSku} for this ticket. Skipping scored search and escalation.`,
          data: { path: "operator_override", sku: overrideSku },
        });
        continue;
      }
      // Override SKU not found in catalog; fall through to regular search.
      traceSteps.push({
        label: `ticket ${ticket.id}: override SKU not found`,
        ticket_id: ticket.id,
        detail: `Operator override SKU "${overrideSku}" not in catalog. Falling back to scored search.`,
      });
    }

    const { result, steps } = runSearchForTicket(ticket, routing);
    results.push(result);
    traceSteps.push(...steps);
  }

  const reviewCount = results.filter((r) => r.needs_human_review).length;
  const overrideCount = overrides ? Object.keys(overrides).length : 0;
  const trace: AgentTrace = {
    name: "catalog",
    inputs_summary: `${tickets.length} ticket(s), ${CATALOG.length} SKUs in catalog${overrideCount > 0 ? `, ${overrideCount} operator override(s)` : ""}`,
    steps: traceSteps,
    outputs_summary: `${results.length - reviewCount} matched, ${reviewCount} escalated${overrideCount > 0 ? `, ${overrideCount} from operator` : ""}`,
    duration_ms: Date.now() - startedAt,
  };

  return { results, trace };
}

function runSearchForTicket(
  ticket: Ticket,
  routing: RoutingDecision,
): { result: CatalogResult; steps: TraceStep[] } {
  const steps: TraceStep[] = [];
  const expectedCategory = DEPARTMENT_TO_CATEGORY[routing.department];

  // Path A: exact part-number match.
  if (ticket.request.part_number) {
    const target = ticket.request.part_number.trim().toUpperCase();
    const exact: CatalogMatch[] = [];
    for (const part of CATALOG) {
      const sku = part.sku.toUpperCase();
      // Match if the part_number IS the SKU's trailing identifier segment
      // (after the last dash) OR exactly equal to the SKU.
      const skuTail = sku.split("-").pop() ?? sku;
      if (sku === target || skuTail === target) {
        exact.push({
          part,
          match_score: 1.0,
          match_reasons: ["exact part number match"],
        });
      }
    }
    if (exact.length > 0) {
      // Vehicle compatibility check: don't blindly trust an exact SKU when
      // the customer also told us a vehicle that conflicts. A customer asking
      // for SKU "DAC-LOGAN-FUEL_PUMP-1000" for their BMW Seria 3 is either
      // confused or trying to game the system — either way, escalate.
      const v = ticket.vehicle;
      const incompatible = exact.filter((m) => {
        if (v.brand && !brandMatches(v.brand, m.part.brand)) return true;
        if (v.model && !modelMatches(v.model, m.part.model)) return true;
        return false;
      });
      const compatible = exact.filter((m) => !incompatible.includes(m));

      if (incompatible.length > 0 && compatible.length === 0) {
        // All exact matches conflict with the stated vehicle. Don't return
        // them; fall through to scored search so the customer's vehicle is
        // the deciding signal.
        const conflict = incompatible[0].part;
        steps.push({
          label: `ticket ${ticket.id}: exact part_number rejected (vehicle conflict)`,
          ticket_id: ticket.id,
          detail: `Customer cited SKU "${ticket.request.part_number}" but the corresponding part is for ${conflict.brand} ${conflict.model}, while customer's vehicle is ${v.brand ?? "?"} ${v.model ?? "?"}. Treating SKU as unreliable, falling back to scored search.`,
          data: {
            path: "exact_part_number_vehicle_conflict",
            stated_vehicle: { brand: v.brand, model: v.model },
            part_vehicle: { brand: conflict.brand, model: conflict.model },
          },
        });
        // Fall through to Path B
      } else {
        steps.push({
          label: `ticket ${ticket.id}: exact part_number lookup`,
          ticket_id: ticket.id,
          detail: `part_number="${ticket.request.part_number}" → ${compatible.length} exact SKU match(es) compatible with vehicle.`,
          data: { path: "exact_part_number", matches: compatible.map((m) => m.part.sku) },
        });
        return { result: finalize(ticket, compatible, steps), steps };
      }
    } else {
      steps.push({
        label: `ticket ${ticket.id}: exact part_number lookup failed`,
        ticket_id: ticket.id,
        detail: `part_number="${ticket.request.part_number}" → no exact SKU match. Falling back to scored search.`,
        data: { path: "exact_part_number_miss" },
      });
    }
  }

  // Path B: scored search.
  const candidates: CatalogMatch[] = [];
  const v = ticket.vehicle;
  const r = ticket.request;
  const customerText = `${r.part_type ?? ""} ${r.description}`;
  const customerTokens = expandTokens(customerText);
  const customerPositions = POSITION_KEYWORDS.filter((p) => customerTokens.has(p));
  const excludedNouns = extractExcludedNouns(customerText);

  let categoryFiltered = 0;
  for (const part of CATALOG) {
    if (part.category !== expectedCategory) continue;
    categoryFiltered++;
    let score = 0;
    const reasons: string[] = [];

    if (v.brand) {
      if (brandMatches(v.brand, part.brand)) {
        score += 0.25;
        reasons.push("brand matched");
      } else {
        // Customer specified a brand and this part is a different brand.
        // Strong penalty so cross-brand noise doesn't reach the operator.
        score -= 0.20;
        reasons.push(`brand mismatch (want ${v.brand}, part is ${part.brand})`);
      }
    }
    if (v.model) {
      if (modelMatches(v.model, part.model)) {
        score += 0.25;
        reasons.push("model matched");
      } else {
        // Customer specified a model but this part is a different model of the
        // same brand. Soft penalty — same brand parts are still plausibly
        // useful, just less so.
        score -= 0.10;
        reasons.push(`model mismatch (want ${v.model}, part is ${part.model})`);
      }
    }
    if (v.year && part.compatible_years.includes(v.year)) {
      score += 0.10;
      reasons.push(`year ${v.year} compatible`);
    } else if (v.year) {
      // Year specified but not in this part's compatible range. Strong signal
      // the part doesn't fit. Don't return it as a confident match.
      score -= 0.15;
      const minY = Math.min(...part.compatible_years);
      const maxY = Math.max(...part.compatible_years);
      reasons.push(`year ${v.year} NOT compatible (part fits ${minY}-${maxY})`);
    }
    if (v.engine) {
      const eng = v.engine.toLowerCase();
      if (
        part.compatible_engines.some(
          (e) => e.toLowerCase().includes(eng) || eng.includes(e.toLowerCase()),
        )
      ) {
        score += 0.10;
        reasons.push(`engine "${v.engine}" compatible`);
      } else {
        // Engine specified but doesn't match any of this part's compatible
        // engines. Soft penalty — engine variants vary and customer text can
        // be imprecise ("2.0" vs "2.0 TDI"), so we don't penalize as hard
        // as brand/year.
        score -= 0.05;
        reasons.push(`engine "${v.engine}" not in part's compatible list`);
      }
    }

    const partTokens = expandTokens(part.name);
    const partPositions = POSITION_KEYWORDS.filter((p) => partTokens.has(p));

    // Position-aware scoring. If the customer asked for a specific position
    // (front/rear/left/right) and the part name has the SAME position word,
    // give a strong bonus. If the part name has a DIFFERENT position word,
    // penalize. Parts with no position word are neutral.
    if (customerPositions.length > 0) {
      const matchedPositions = customerPositions.filter((p) => partPositions.includes(p));
      if (matchedPositions.length > 0) {
        score += 0.15;
        reasons.push(`position match: ${matchedPositions.join(",")}`);
      } else if (partPositions.length > 0) {
        score -= 0.15;
        reasons.push(`position mismatch (wanted ${customerPositions.join(",")}, part is ${partPositions.join(",")})`);
      }
    }

    // Part-noun scoring. Count how many "real" part nouns from the customer
    // also appear in the part name. Each match is +0.10, capped at +0.20 so
    // brand/model/year stay dominant for vehicle-specific matching.
    const matchedNouns = PART_NOUNS.filter((n) => customerTokens.has(n) && partTokens.has(n));
    if (matchedNouns.length > 0) {
      const bonus = Math.min(0.20, matchedNouns.length * 0.10);
      score += bonus;
      reasons.push(`part nouns: ${matchedNouns.join(",")}`);
    }

    // Specific-component mismatch penalty. Within a single category, the
    // SPECIFIC component is mutually exclusive: "brake pad" and "brake disc"
    // share the qualifier "brake" but the component is different. If the
    // customer named one specific component (pad, disc, caliper, fluid,
    // cable, ...) and the candidate part contains a DIFFERENT specific
    // component, this is the wrong product family. Penalize hard so it
    // doesn't tie with the right component.
    const customerSpecifics = Array.from(customerTokens).filter((t) =>
      SPECIFIC_COMPONENT_NOUNS.has(t),
    );
    const partSpecifics = Array.from(partTokens).filter((t) =>
      SPECIFIC_COMPONENT_NOUNS.has(t),
    );
    if (customerSpecifics.length > 0 && partSpecifics.length > 0) {
      const overlap = customerSpecifics.filter((c) => partSpecifics.includes(c));
      if (overlap.length === 0) {
        score -= 0.25;
        reasons.push(`component mismatch (want ${customerSpecifics.join("/")}, part has ${partSpecifics.join("/")})`);
      }
    }

    // Negation penalty. If the customer wrote "fara disc" / "without disc",
    // and this part has "disc" in its name, drop the score hard. The customer
    // explicitly does not want this category.
    const blockedHits = Array.from(excludedNouns).filter((e) => partTokens.has(e));
    if (blockedHits.length > 0) {
      score -= 0.30;
      reasons.push(`customer rejected: "${blockedHits.join(",")}"`);
    }

    // Fallback: any other meaningful tokens overlapping (smaller bonus, only
    // when no part-noun matched, to catch off-dictionary descriptions).
    if (matchedNouns.length === 0) {
      const positionSet = new Set(POSITION_KEYWORDS);
      const nounSet = new Set(PART_NOUNS);
      const otherOverlap = Array.from(customerTokens).filter(
        (t) => t.length > 3 && !positionSet.has(t) && !nounSet.has(t) && partTokens.has(t),
      );
      // Exclude brand/model tokens we already credited explicitly
      const filtered = otherOverlap.filter(
        (t) => t !== v.brand?.toLowerCase() && t !== v.model?.toLowerCase(),
      );
      if (filtered.length > 0) {
        score += 0.05;
        reasons.push(`keyword: ${filtered.slice(0, 2).join(",")}`);
      }
    }

    if (score >= SCORE_FLOOR) {
      candidates.push({ part, match_score: Math.min(1, Math.max(0, score)), match_reasons: reasons });
    }
  }

  candidates.sort((a, b) => b.match_score - a.match_score);
  const top = candidates.slice(0, 5);

  steps.push({
    label: `ticket ${ticket.id}: scored search`,
    ticket_id: ticket.id,
    detail: `Filtered to ${categoryFiltered} parts in ${expectedCategory}. ${candidates.length} above score floor (${SCORE_FLOOR}). Top ${top.length} returned.`,
    data: {
      path: "scored_search",
      category: expectedCategory,
      candidates_in_category: categoryFiltered,
      candidates_above_floor: candidates.length,
      top_results: top.map((c) => ({
        sku: c.part.sku,
        score: c.match_score,
        reasons: c.match_reasons,
      })),
    },
  });

  return { result: finalize(ticket, top, steps), steps };
}

function finalize(ticket: Ticket, matches: CatalogMatch[], steps: TraceStep[]): CatalogResult {
  if (matches.length === 0) {
    steps.push({
      label: `ticket ${ticket.id}: escalation`,
      ticket_id: ticket.id,
      detail: "No catalog matches → human review required.",
      data: { reason: "no_matches" },
    });
    return {
      ticket_id: ticket.id,
      matches: [],
      needs_human_review: true,
      review_reason:
        "No parts in the catalog matched this request. Manual lookup needed.",
    };
  }

  const primary = matches[0];

  if (primary.match_score >= STRONG_THRESHOLD) {
    // Detect ambiguity: many candidates clustered near the top
    const close = matches.filter((m) => primary.match_score - m.match_score < 0.05);
    if (close.length >= AMBIGUOUS_CLUSTER_SIZE) {
      steps.push({
        label: `ticket ${ticket.id}: escalation`,
        ticket_id: ticket.id,
        detail: `${close.length} candidates clustered within 0.05 of top score → ambiguous, human review required.`,
        data: { reason: "ambiguous_cluster", cluster_size: close.length },
      });
      return {
        ticket_id: ticket.id,
        matches,
        primary,
        needs_human_review: true,
        review_reason:
          "Multiple catalog parts matched with similar scores. Operator should pick the right variant.",
      };
    }
    steps.push({
      label: `ticket ${ticket.id}: primary selected`,
      ticket_id: ticket.id,
      detail: `Primary=${primary.part.sku} score=${primary.match_score.toFixed(2)}. Auto-fulfill.`,
      data: { primary_sku: primary.part.sku, primary_score: primary.match_score },
    });
    return {
      ticket_id: ticket.id,
      matches,
      primary,
      needs_human_review: false,
    };
  }

  steps.push({
    label: `ticket ${ticket.id}: escalation`,
    ticket_id: ticket.id,
    detail: `Top score ${primary.match_score.toFixed(2)} below confidence threshold (${ESCALATE_BELOW}). Human review required.`,
    data: { reason: "low_confidence", primary_score: primary.match_score },
  });
  return {
    ticket_id: ticket.id,
    matches,
    primary,
    needs_human_review: true,
    review_reason:
      primary.match_score < ESCALATE_BELOW
        ? "Top catalog match is below the confidence threshold (0.6). Operator should confirm the part."
        : "Multiple parts matched with similar scores. Operator should pick the right variant.",
  };
}