import { runPromotionExpiryNotices } from "@/lib/promotions/expiry-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const GET = runPromotionExpiryNotices;
