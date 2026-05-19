/**
 * Shared type definitions for the Auto Parts Quote Agent.
 *
 * The type hierarchy mirrors the agent pipeline:
 *   IncomingEmail -> ClassifierOutput -> Ticket[] -> ... -> QuoteReply
 *
 * Every agent's output is structured. We do not pass raw text between
 * agents; we pass typed objects with confidence scores, so downstream
 * agents can make decisions based on the certainty of upstream ones.
 */

import type { FriendlyError } from "./errors";
export type { FriendlyError };

// ============================================================================
// Catalog
// ============================================================================

export type PartCategory =
  | "ENGINE"
  | "TRANSMISSION"
  | "SUSPENSION"
  | "BRAKING"
  | "ELECTRICAL"
  | "BODY";

export interface CatalogPart {
  sku: string;
  name: string;
  category: PartCategory;
  brand: string;
  model: string;
  compatible_years: number[];
  compatible_engines: string[];
  price_eur: number;
  stock: number;
  weight_kg: number;
  warranty_months: number;
}

// ============================================================================
// Incoming email (the input to the pipeline)
// ============================================================================

export type AttachmentKind = "image" | "pdf";

export interface IncomingAttachment {
  filename: string;
  kind: AttachmentKind;
  // Base64-encoded content. We pass it through to Claude vision/PDF support.
  base64: string;
  // MIME type, e.g. "image/jpeg", "application/pdf"
  mime_type: string;
}

export interface IncomingEmail {
  thread_id?: string;            // present on replies to a clarification
  from_name: string;
  from_email: string;
  subject: string;
  body: string;
  attachments: IncomingAttachment[];
  received_at: string;            // ISO timestamp
  // Operator overrides for human-in-the-loop resolutions. Maps ticket_id to
  // a chosen SKU. When set, the catalog agent uses that SKU as the primary
  // match and skips escalation for that ticket.
  ticket_overrides?: Record<string, string>;
}

// ============================================================================
// Classifier output (the first structured representation)
// ============================================================================

export type EmailIntent =
  | "quote_request"
  | "inquiry"
  | "complaint"
  | "order_confirmation"
  | "other";

export type Language = "ro" | "en" | "hu" | "de";

export type AttachmentClass =
  | "PART_LABEL"      // the user photographed the OEM label of a part
  | "VIN_DOCUMENT"    // photo of registration document / VIN sticker
  | "DAMAGED_PART"    // photo of the broken/damaged part itself
  | "COMPANY_LOGO"    // sender's company logo (skip)
  | "SIGNATURE"       // email signature image (skip)
  | "OTHER";          // unclassified, may need human review

export interface ClassifiedAttachment {
  filename: string;
  classification: AttachmentClass;
  // OCR text extracted from the image, if any was found.
  ocr_text?: string;
  // VIN extracted from this attachment, if any
  vin?: string;
  // Part number extracted, if any
  part_number?: string;
  // Vehicle data extracted from a VIN_DOCUMENT (registration card). These
  // override what was extracted from email body when present, since the
  // document is more reliable than free-form customer text.
  extracted_brand?: string;
  extracted_model?: string;
  extracted_year?: number;
  extracted_engine?: string;
  confidence: number;             // 0..1
}

export type RedFlagSeverity = "high" | "medium" | "low";

export interface RedFlag {
  id: string;
  severity: RedFlagSeverity;
  title: string;
  detail: string;
}

export interface Customer {
  name: string;
  email: string;
  phone?: string;
  // Detected from email signature / domain
  company_type?: "individual" | "business";
  company_name?: string;
}

export interface VehicleInfo {
  brand?: string;
  model?: string;
  year?: number;
  engine?: string;
  vin?: string;
  confidence: number;             // 0..1
}

export interface RequestedItem {
  // A single thing the customer wants pricing/info for.
  description: string;            // free-text from the email
  category?: PartCategory;        // best-guess category
  part_type?: string;             // "fuel pump", "brake pads", etc.
  part_number?: string;           // OEM number if visible
  quantity: number;
  // True when the customer did NOT specify a quantity and we defaulted to 1.
  // Used by the reply writer to disclose the assumption.
  quantity_assumed?: boolean;
  confidence: number;             // 0..1 on the part identification
}

export interface Ticket {
  // A single actionable request. Multi-intent emails produce multiple tickets.
  id: string;
  customer: Customer;
  vehicle: VehicleInfo;
  request: RequestedItem;
  language: Language;
}

export interface ClassifierOutput {
  intent: EmailIntent;
  language: Language;
  customer: Customer;
  // Auto-reply and prompt-injection detection are surface-level signals
  // returned by the classifier so downstream agents can decide what to do.
  is_auto_reply: boolean;
  prompt_injection_detected: boolean;
  // Structured red flags surfaced to the operator. Populated by heuristic
  // pattern matching (see lib/red-flags.ts) alongside the LLM classifier.
  // The pipeline still produces a reply when these fire — the flags are
  // advisory so the operator can decide whether to actually send it.
  red_flags?: RedFlag[];
  attachments: ClassifiedAttachment[];
  tickets: Ticket[];              // one per requested item (multi-intent)
  reasoning: string;
}

// ============================================================================
// Completeness decision (per ticket)
// ============================================================================

export type CompletenessStatus =
  | "COMPLETE"                    // proceed to routing + catalog + pricing
  | "NEEDS_VEHICLE"               // we have a part but no vehicle identification
  | "NEEDS_VIN"                   // we have brand/model but not enough to disambiguate engine variant
  | "NEEDS_PART_DETAIL"           // we have a vehicle but the part description is too vague
  | "NEEDS_PHOTO";                // ask for a photo of the part / its label

export interface CompletenessDecision {
  ticket_id: string;
  status: CompletenessStatus;
  missing_fields: string[];
  reasoning: string;
}

// ============================================================================
// Router output (per complete ticket)
// ============================================================================

export type Department =
  | "MOTOR"           // ENGINE
  | "TRANSMISIE"      // TRANSMISSION
  | "SUSPENSIE"       // SUSPENSION
  | "FRANARE"         // BRAKING
  | "ELECTRIC"        // ELECTRICAL
  | "CAROSERIE";      // BODY

export interface RoutingDecision {
  ticket_id: string;
  department: Department;
  confidence: number;
}

// ============================================================================
// Catalog match (per ticket)
// ============================================================================

export interface CatalogMatch {
  part: CatalogPart;
  match_score: number;            // 0..1
  match_reasons: string[];        // ["brand matched", "year in range", "engine compatible"]
}

export interface CatalogResult {
  ticket_id: string;
  matches: CatalogMatch[];
  primary?: CatalogMatch;         // highest-scored match, if any
  needs_human_review: boolean;    // true if zero matches OR too many ambiguous
  review_reason?: string;
}

// ============================================================================
// Pricing output (per ticket)
// ============================================================================

export interface PricingBreakdown {
  ticket_id: string;
  sku: string;
  unit_price_eur: number;
  quantity: number;
  discount_pct: number;           // e.g. 0.05 = 5%
  discount_reason: string;        // "Business customer", "Loyal customer", etc.
  subtotal_eur: number;
  shipping_eur: number;
  vat_pct: number;                // 0.19 in RO
  vat_eur: number;                // pre-computed VAT amount (no drift in reply)
  total_eur: number;
  delivery_days: number;
  valid_until: string;            // ISO date (7 days from now)
  // Stock availability info. When requested quantity exceeds on-hand stock,
  // we mark this as a backorder so the reply writer can disclose lead times
  // honestly instead of promising 2-day delivery for items we don't have.
  stock_on_hand: number;
  in_stock_qty: number;           // min(requested, stock_on_hand)
  backorder_qty: number;          // max(0, requested - stock_on_hand)
  partial_fulfillment: boolean;   // true when backorder_qty > 0
}

// ============================================================================
// Final reply
// ============================================================================

export interface QuoteReply {
  thread_id: string;
  language: Language;
  subject: string;
  body: string;
  // What was actually delivered to the customer (may be a partial set of tickets)
  fulfilled_tickets: string[];
  // Tickets that ended up in human review or clarification
  escalated_tickets: string[];
  clarification_tickets: string[];
}

// ============================================================================
// Streaming events for the UI
// ============================================================================

export type AgentName =
  | "classifier"
  | "completeness"
  | "clarification"
  | "router"
  | "catalog"
  | "pricing"
  | "reply_writer";

export type AgentStatus =
  | "pending"
  | "running"
  | "done"
  | "skipped"
  | "attention"
  | "error";

export interface AgentState {
  name: AgentName;
  status: AgentStatus;
  detail?: string;
  started_at?: string;
  completed_at?: string;
}

// ============================================================================
// Agent trace (structured reasoning, surfaced to the UI)
// ============================================================================

export interface TraceStep {
  // Short label for the decision/sub-step, e.g. "language detection" or
  // "engine-specific part check"
  label: string;
  // One-line explanation of what was decided and why.
  detail: string;
  // Optional structured payload (catalog scores, rule matches, etc.) the UI
  // can render as a small table.
  data?: Record<string, unknown>;
  // Optional ticket this step applies to (so the UI can render per-ticket lanes)
  ticket_id?: string;
}

export interface AgentTrace {
  name: AgentName;
  // Short summary of what the agent was given
  inputs_summary: string;
  // Ordered decisions / sub-steps
  steps: TraceStep[];
  // Short summary of what came out
  outputs_summary: string;
  // Total wall-clock duration for the agent (ms)
  duration_ms?: number;
  // True if the agent was skipped entirely (e.g. nothing to route)
  skipped?: boolean;
  // Optional skip reason
  skip_reason?: string;
}

export type PipelineEvent =
  | { type: "started"; thread_id: string }
  | { type: "agent_status"; name: AgentName; status: AgentStatus; detail?: string }
  | { type: "agent_trace"; trace: AgentTrace }
  | { type: "classifier_done"; output: ClassifierOutput }
  | { type: "completeness_done"; decisions: CompletenessDecision[] }
  | { type: "clarification_drafted"; ticket_id: string; subject: string; body: string }
  | { type: "router_done"; decisions: RoutingDecision[] }
  | { type: "catalog_done"; results: CatalogResult[] }
  | { type: "pricing_done"; breakdowns: PricingBreakdown[] }
  | { type: "reply_done"; reply: QuoteReply }
  | { type: "human_review_required"; reason: string; ticket_id: string }
  | { type: "intent_blocked"; intent: EmailIntent; reason: string }
  | { type: "auto_reply_detected" }
  | { type: "prompt_injection_detected"; sanitized: boolean }
  | { type: "finished" }
  | { type: "error"; friendly: FriendlyError };

// ============================================================================
// Conversation state (persisted in memory across messages in a thread)
// ============================================================================

export interface ConversationRecord {
  thread_id: string;
  created_at: string;
  last_activity: string;
  customer: Customer;
  messages: Array<{
    role: "incoming" | "outgoing";
    timestamp: string;
    subject: string;
    body: string;
  }>;
  open_tickets: Ticket[];
  language: Language;
}

// ============================================================================
// SSE encoding helper
// ============================================================================

export function encodeEvent(event: PipelineEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}