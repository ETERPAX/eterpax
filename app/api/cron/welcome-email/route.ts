import { runWelcomeEmails } from "@/lib/welcome/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const GET = runWelcomeEmails;
