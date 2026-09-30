import { NextResponse } from "next/server";
import { runAgent } from "@/lib/agent";
import type { ChatMessage } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { messages?: ChatMessage[] };
    if (!Array.isArray(body.messages)) {
      return NextResponse.json({ error: "messages must be an array" }, { status: 400 });
    }
    const result = await runAgent(body.messages);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
