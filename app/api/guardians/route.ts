import { authenticateOwner, guardianAdmin, guardianColumns, sendGuardianConfirmations, uuidPattern } from "@/lib/guardians/server";

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  try {
    const user = await authenticateOwner(request);
    if (!user) return reply({ error: "Unauthorized" }, 401);
    const { data, error } = await guardianAdmin().from("guardians").select(guardianColumns)
      .eq("user_id", user.id).order("created_at", { ascending: true });
    if (error) return reply({ error: "Unable to load Guardians" }, 503);
    // Deployed legacy Guardian fields are nullable. Normalize only the API
    // presentation; do not rewrite legacy records while loading them.
    return reply({ guardians: (data ?? []).map(row => ({
      ...row, name: row.name ?? "", email: row.email ?? "", relationship: row.relationship ?? "",
    })) });
  } catch { return reply({ error: "Unable to load Guardians" }, 503); }
}

export async function POST(request: Request) {
  try {
    const user = await authenticateOwner(request);
    if (!user) return reply({ error: "Unauthorized" }, 401);
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return reply({ error: "JSON required" }, 415);
    let body;
    try { body = await request.json(); } catch { return reply({ error: "Invalid request" }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).some(key => !["guardians", "existingIds"].includes(key))
      || !Array.isArray(body.guardians) || body.guardians.length < 2 || body.guardians.length > 6
      || !Array.isArray(body.existingIds) || body.existingIds.some((id: unknown) => typeof id !== "string" || !uuidPattern.test(id))
      || new Set(body.existingIds).size !== body.existingIds.length) return reply({ error: "Choose 2–6 Guardians" }, 400);
    const rows: { id: string | null; name: string; email: string; relationship: string }[] = [];
    for (const row of body.guardians) {
      if (!row || typeof row !== "object" || Array.isArray(row)
        || Object.keys(row).some(key => !["id", "name", "email", "relationship"].includes(key))
        || (row.id !== null && (typeof row.id !== "string" || !uuidPattern.test(row.id)))
        || ["name", "email", "relationship"].some(key => typeof row[key] !== "string" || !row[key].trim() || row[key].length > 254)
        || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(row.email.trim())) return reply({ error: "Invalid Guardian" }, 400);
      rows.push({ id: row.id, name: row.name.trim(), email: row.email.trim().toLowerCase(), relationship: row.relationship.trim() });
    }
    const ids = rows.filter(row => row.id).map(row => row.id);
    if (new Set(rows.map(row => row.email)).size !== rows.length || new Set(ids).size !== ids.length) return reply({ error: "Each Guardian must be distinct" }, 400);
    const admin = guardianAdmin();
    const { data, error } = await admin.rpc("save_guardian_selection", {
      p_user_id: user.id, p_existing_ids: body.existingIds, p_guardians: rows,
    });
    if (error || !data || !Array.isArray(data.guardians)) return reply({ error: "Unable to save Guardians. Please reload before retrying." }, 409);
    let notificationsComplete = true;
    if (data.active) {
      try { notificationsComplete = await sendGuardianConfirmations(admin, user.id); }
      catch { notificationsComplete = false; }
    }
    return reply({ guardians: data.guardians, active: data.active === true, notificationsComplete });
  } catch { return reply({ error: "Unable to save Guardians. Please reload before retrying." }, 503); }
}
