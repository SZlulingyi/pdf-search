import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import type { HealthResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const payload: HealthResponse = {
    status: "ok",
    mock: config.agentMock || config.agentMockLlm,
    backendBaseUrl: config.backendBaseUrl,
    qwenConfigured: !config.agentMockLlm && Boolean(config.qwenBaseUrl),
  };
  return NextResponse.json(payload);
}
