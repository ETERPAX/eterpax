// Guardians are selected by their owner; there is no Guardian response workflow.
function retired() {
  return Response.json({ error: "Gone" }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
export const GET = retired;
export const POST = retired;
