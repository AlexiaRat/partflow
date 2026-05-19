/**
 * Pricing Agent.
 *
 * Calculates the final quote with deterministic business rules:
 *
 *   subtotal = unit_price * quantity * (1 - discount_pct)
 *   total    = subtotal + shipping + VAT
 *
 * Discount tiers (additive, capped at 15%):
 *   - Business customer:        5%
 *   - Order >= 500 EUR gross:   +2%
 *   - Order >= 1500 EUR gross:  +3% (so 1500+ = +5% volume total)
 *
 * Shipping:
 *   - Free above 1000 EUR subtotal
 *   - 25 EUR otherwise
 *
 * VAT: 19% (Romania).
 * Validity: 7 days from generation.
 *
 * No LLM. Pure arithmetic. The reply writer is forbidden from changing any
 * of these numbers, so prompt injection cannot lower prices.
 *
 * Trace records each rule that fired and the running totals.
 */

import type {
  CatalogResult,
  PricingBreakdown,
  Ticket,
  Customer,
  AgentTrace,
  TraceStep,
} from "../types";

const VAT_PCT = 0.19;
const SHIPPING_FLAT_EUR = 25;
const SHIPPING_FREE_THRESHOLD_EUR = 1000;
const BUSINESS_DISCOUNT = 0.05;
const VOLUME_DISCOUNT_500 = 0.02;
const VOLUME_DISCOUNT_1500 = 0.03;
const MAX_DISCOUNT = 0.15;
const QUOTE_VALIDITY_DAYS = 7;

export interface PriceTicketResult {
  breakdown: PricingBreakdown | null;
  steps: TraceStep[];
}

export function priceTicketsBatch(params: {
  tickets: Ticket[];
  catalogResults: Map<string, CatalogResult>;
  customer: Customer;
}): { breakdowns: PricingBreakdown[]; trace: AgentTrace } {
  const startedAt = Date.now();
  const { tickets, catalogResults, customer } = params;
  const breakdowns: PricingBreakdown[] = [];
  const traceSteps: TraceStep[] = [];

  for (const ticket of tickets) {
    const cr = catalogResults.get(ticket.id);
    if (!cr) continue;
    const { breakdown, steps } = priceTicket({ ticket, catalogResult: cr, customer });
    traceSteps.push(...steps);
    if (breakdown) breakdowns.push(breakdown);
  }

  const trace: AgentTrace = {
    name: "pricing",
    inputs_summary: `${tickets.length} ticket(s), customer type=${customer.company_type ?? "unknown"}`,
    steps: traceSteps,
    outputs_summary: `${breakdowns.length} quote(s) generated, total value ${breakdowns
      .reduce((s, b) => s + b.total_eur, 0)
      .toFixed(2)} EUR`,
    duration_ms: Date.now() - startedAt,
  };

  return { breakdowns, trace };
}

export function priceTicket(params: {
  ticket: Ticket;
  catalogResult: CatalogResult;
  customer: Customer;
}): PriceTicketResult {
  const { ticket, catalogResult, customer } = params;
  const steps: TraceStep[] = [];

  if (!catalogResult.primary) {
    steps.push({
      label: `ticket ${ticket.id}: no primary part`,
      ticket_id: ticket.id,
      detail: "Catalog returned no primary part. Skipping pricing.",
    });
    return { breakdown: null, steps };
  }

  const part = catalogResult.primary.part;
  const quantity = ticket.request.quantity;
  const unitPrice = part.price_eur;
  const grossSubtotal = unitPrice * quantity;

  steps.push({
    label: `ticket ${ticket.id}: base`,
    ticket_id: ticket.id,
    detail: `${quantity} × ${unitPrice} EUR = ${round2(grossSubtotal)} EUR gross (SKU ${part.sku}).`,
    data: { sku: part.sku, unit_price: unitPrice, quantity, gross_subtotal: round2(grossSubtotal) },
  });

  let discount = 0;
  const reasons: string[] = [];

  if (customer.company_type === "business") {
    discount += BUSINESS_DISCOUNT;
    reasons.push("business customer (5%)");
    steps.push({
      label: `ticket ${ticket.id}: discount rule`,
      ticket_id: ticket.id,
      detail: `Business customer → +5%. Running discount ${(discount * 100).toFixed(0)}%.`,
    });
  }
  if (grossSubtotal >= 1500) {
    discount += VOLUME_DISCOUNT_500 + VOLUME_DISCOUNT_1500;
    reasons.push("volume >=1500 EUR (+5%)");
    steps.push({
      label: `ticket ${ticket.id}: discount rule`,
      ticket_id: ticket.id,
      detail: `Volume >=1500 EUR → +5%. Running discount ${(discount * 100).toFixed(0)}%.`,
    });
  } else if (grossSubtotal >= 500) {
    discount += VOLUME_DISCOUNT_500;
    reasons.push("volume >=500 EUR (+2%)");
    steps.push({
      label: `ticket ${ticket.id}: discount rule`,
      ticket_id: ticket.id,
      detail: `Volume >=500 EUR → +2%. Running discount ${(discount * 100).toFixed(0)}%.`,
    });
  }

  if (discount > MAX_DISCOUNT) {
    steps.push({
      label: `ticket ${ticket.id}: discount cap`,
      ticket_id: ticket.id,
      detail: `Capping discount at ${MAX_DISCOUNT * 100}% (was ${(discount * 100).toFixed(0)}%).`,
    });
    discount = MAX_DISCOUNT;
  }

  const discountReason = reasons.length > 0 ? reasons.join(" + ") : "No discount applied";
  const subtotal = round2(grossSubtotal * (1 - discount));
  const shipping = subtotal >= SHIPPING_FREE_THRESHOLD_EUR ? 0 : SHIPPING_FLAT_EUR;
  const vat = round2((subtotal + shipping) * VAT_PCT);
  const total = round2(subtotal + shipping + vat);

  // Stock availability. Customers can ask for any quantity; we should not
  // pretend we have it. If they want 50 and we have 11, the in-stock part
  // ships in 2 days, the rest is a backorder with longer lead time.
  const stockOnHand = part.stock;
  const inStockQty = Math.min(quantity, stockOnHand);
  const backorderQty = Math.max(0, quantity - stockOnHand);
  const partialFulfillment = backorderQty > 0;

  let deliveryDays: number;
  if (stockOnHand === 0) {
    // Nothing on hand, full backorder
    deliveryDays = 14;
  } else if (quantity > stockOnHand) {
    // Partial fulfillment: dominant lead time is the backordered portion
    deliveryDays = 14;
  } else if (stockOnHand >= 5) {
    deliveryDays = 2;
  } else {
    deliveryDays = 5;
  }

  if (partialFulfillment) {
    steps.push({
      label: `ticket ${ticket.id}: partial fulfillment`,
      ticket_id: ticket.id,
      detail: `Customer requested ${quantity}, only ${stockOnHand} on hand. Splitting: ${inStockQty} ships in ${stockOnHand >= 5 ? 2 : 5} days, ${backorderQty} on backorder (~14 days).`,
      data: { requested: quantity, stock: stockOnHand, in_stock: inStockQty, backorder: backorderQty },
    });
  }

  steps.push({
    label: `ticket ${ticket.id}: totals`,
    ticket_id: ticket.id,
    detail: `Subtotal ${subtotal} EUR (after ${(discount * 100).toFixed(0)}% discount) + shipping ${shipping} EUR + VAT 19% ${vat} EUR = ${total} EUR. Delivery ${deliveryDays} business day(s).${partialFulfillment ? ` BACKORDER on ${backorderQty} unit(s).` : ""}`,
    data: {
      subtotal,
      shipping,
      vat,
      total,
      delivery_days: deliveryDays,
      stock: part.stock,
      partial_fulfillment: partialFulfillment,
    },
  });

  const validUntil = new Date(Date.now() + QUOTE_VALIDITY_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  return {
    breakdown: {
      ticket_id: ticket.id,
      sku: part.sku,
      unit_price_eur: unitPrice,
      quantity,
      discount_pct: round4(discount),
      discount_reason: discountReason,
      subtotal_eur: subtotal,
      shipping_eur: shipping,
      vat_pct: VAT_PCT,
      vat_eur: vat,
      total_eur: total,
      delivery_days: deliveryDays,
      valid_until: validUntil,
      stock_on_hand: stockOnHand,
      in_stock_qty: inStockQty,
      backorder_qty: backorderQty,
      partial_fulfillment: partialFulfillment,
    },
    steps,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
