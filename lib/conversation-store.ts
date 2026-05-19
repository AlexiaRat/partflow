/**
 * Conversation state store.
 *
 * Every email starts a thread (or replies to one). When a thread already
 * exists, downstream agents can use the prior context to disambiguate -
 * e.g. the customer replies "yes, 2018, 1.5 dCi" to a clarification email,
 * and we already know which part was being asked about.
 *
 * This is an in-memory store. For a real deployment you'd replace this
 * with Postgres/Supabase. The interface is small (createThread, getThread,
 * appendMessage, updateTickets) so the swap is straightforward - see
 * README "Production Roadmap" for details.
 */

import type { ConversationRecord, Customer, Ticket } from "./types";

const MAX_CONVERSATIONS = Number(process.env.MAX_CONVERSATIONS ?? 100);

// Module-level Map; reset on cold start of the serverless function.
// For Vercel free tier this means thread state survives within a single
// session but not across deploys. Good enough for a demo.
const store: Map<string, ConversationRecord> = new Map();

export function createThread(customer: Customer, language: ConversationRecord["language"]): ConversationRecord {
  evictIfFull();

  const thread_id = `thr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  const record: ConversationRecord = {
    thread_id,
    created_at: now,
    last_activity: now,
    customer,
    messages: [],
    open_tickets: [],
    language,
  };
  store.set(thread_id, record);
  return record;
}

export function getThread(thread_id: string): ConversationRecord | undefined {
  return store.get(thread_id);
}

export function appendIncoming(thread_id: string, subject: string, body: string): void {
  const t = store.get(thread_id);
  if (!t) return;
  t.messages.push({ role: "incoming", timestamp: new Date().toISOString(), subject, body });
  t.last_activity = new Date().toISOString();
}

export function appendOutgoing(thread_id: string, subject: string, body: string): void {
  const t = store.get(thread_id);
  if (!t) return;
  t.messages.push({ role: "outgoing", timestamp: new Date().toISOString(), subject, body });
  t.last_activity = new Date().toISOString();
}

export function updateOpenTickets(thread_id: string, tickets: Ticket[]): void {
  const t = store.get(thread_id);
  if (!t) return;
  t.open_tickets = tickets;
  t.last_activity = new Date().toISOString();
}

export function closeTicket(thread_id: string, ticket_id: string): void {
  const t = store.get(thread_id);
  if (!t) return;
  t.open_tickets = t.open_tickets.filter((tk) => tk.id !== ticket_id);
}

function evictIfFull(): void {
  if (store.size < MAX_CONVERSATIONS) return;
  // Evict the least recently active thread
  let oldestId: string | null = null;
  let oldestTime = Infinity;
  for (const [id, record] of store.entries()) {
    const t = new Date(record.last_activity).getTime();
    if (t < oldestTime) {
      oldestTime = t;
      oldestId = id;
    }
  }
  if (oldestId) store.delete(oldestId);
}

// Exposed for the GET /api/conversations/:id route
export function listThreads(): ConversationRecord[] {
  return Array.from(store.values()).sort(
    (a, b) => new Date(b.last_activity).getTime() - new Date(a.last_activity).getTime(),
  );
}
