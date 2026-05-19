/**
 * GET /api/conversations/[id]
 *
 * Returns the full thread record, including message history and open
 * tickets, so the UI can render a thread view.
 */

import { NextRequest, NextResponse } from "next/server";
import { getThread } from "@/lib/conversation-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const thread = getThread(params.id);
  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }
  return NextResponse.json(thread);
}
