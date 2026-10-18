import { dispatchManualCheckIn } from "@/lib/continuity/manual-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = dispatchManualCheckIn;
