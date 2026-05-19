/**
 * GET /api/conversations
 *
 * Returns the in-memory thread list (most recently active first). Used by
 * the dashboard's "Threads" panel to show what conversations are open.
 *
 * In a real deployment this would query Postgres / Supabase. For the demo,
 * the in-memory store is sufficient.
 */

import { NextResponse } from "next/server";
import { listThreads } from "@/lib/conversation-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const threads = listThreads().map((t) => ({
    thread_id: t.thread_id,
    created_at: t.created_at,
    last_activity: t.last_activity,
    customer: t.customer,
    language: t.language,
    open_ticket_count: t.open_tickets.length,
    message_count: t.messages.length,
  }));
  return NextResponse.json({ threads });
}
