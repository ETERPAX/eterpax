import { invokeContinuityEngine } from "@/lib/continuity/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return invokeContinuityEngine(request);
}
