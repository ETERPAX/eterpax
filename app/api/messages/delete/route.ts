import { handleMessageDeletion } from "@/lib/messages/deletion-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const GET = handleMessageDeletion;
export const POST = handleMessageDeletion;
