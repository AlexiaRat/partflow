/**
 * POST /api/process-email
 *
 * Body: IncomingEmail (see lib/types.ts)
 * Response: Server-Sent Events stream of PipelineEvents.
 *
 * The frontend opens this with fetch + ReadableStream reader and parses
 * one event per "data: ...\n\n" frame, exactly the same pattern as the
 * Medical Research Agent.
 *
 * Node runtime (not Edge) because we may need PDF / image base64 of
 * larger payloads than Edge functions handle well.
 */

import { NextRequest } from "next/server";
import { runPipeline } from "@/lib/agents/orchestrator";
import { classifyError } from "@/lib/errors";
import { encodeEvent } from "@/lib/types";
import type { IncomingEmail } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  let body: IncomingEmail;
  try {
    body = (await request.json()) as IncomingEmail;
  } catch (err) {
    return new Response(
      encodeEvent({ type: "error", friendly: classifyError(err) }),
      {
        status: 400,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
        },
      },
    );
  }

  if (!body.from_email || !body.body || !body.subject) {
    return new Response(
      encodeEvent({
        type: "error",
        friendly: {
          title: "Email is missing required fields",
          message:
            "The pipeline needs at minimum: a sender email, a subject line, and a body.",
          tip: "Fill in the From email, Subject, and Body fields in the input form.",
        },
      }),
      {
        status: 400,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
        },
      },
    );
  }

  // Default fields if missing
  body.received_at = body.received_at ?? new Date().toISOString();
  body.attachments = body.attachments ?? [];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of runPipeline(body)) {
          controller.enqueue(encoder.encode(encodeEvent(event)));
        }
      } catch (error) {
        controller.enqueue(
          encoder.encode(
            encodeEvent({ type: "error", friendly: classifyError(error) }),
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
