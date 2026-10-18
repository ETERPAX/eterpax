import type { SupabaseClient } from "@supabase/supabase-js";

export type MessageBucket = "message-audio" | "message-videos" | "message-photos" | "message-documents";

/** Receives ciphertext only. Registration is committed before Storage starts.
 * Keep operationId when retrying a lost registration/completion response.
 */
export async function uploadMessageFile(client: SupabaseClient, messageId: string,
  bucket: MessageBucket, ciphertext: Blob, operationId = crypto.randomUUID()) {
  const registration = await client.rpc("register_message_upload", {
    p_message_id: messageId, p_bucket: bucket, p_operation_id: operationId,
  });
  if (registration.error) throw new Error("Unable to register upload");
  const op = registration.data;
  if (!op || op.id !== operationId || op.message_id !== messageId || op.bucket !== bucket
    || typeof op.path !== "string" || !["pending", "uploaded", "attached"].includes(op.state)) {
    throw new Error("Invalid upload registration");
  }
  if (op.state === "pending") {
    // First reconcile: the previous Storage response may have been lost.
    const existing = await client.rpc("complete_message_upload", { p_operation_id: operationId });
    if (existing.error) {
      const result = await client.storage.from(bucket).upload(op.path, ciphertext,
        { contentType: "application/octet-stream", upsert: false });
      if (result.error) {
        // A duplicate or timeout may still mean the bytes were accepted.
        const reconcile = await client.rpc("complete_message_upload", { p_operation_id: operationId });
        if (reconcile.error) throw new Error("Upload incomplete; recovery retained");
      }
    }
  }
  const completion = await client.rpc("complete_message_upload", { p_operation_id: operationId });
  if (completion.error) throw new Error("Upload completion pending; recovery retained");
  return { path: op.path as string, operationId };
}
