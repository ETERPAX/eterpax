import { invokeContinuityEngine } from "@/lib/continuity/server";

// 60s is supported even on Hobby without Fluid Compute (Vercel duration docs).
export const maxDuration = 60;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return invokeContinuityEngine(request);
}
