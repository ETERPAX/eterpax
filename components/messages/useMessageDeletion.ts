"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type DeletionState = "deleting" | "pending" | "blocked" | "deleted" | "unknown";
class DeletionError extends Error {
  constructor(message: string, readonly blocked: boolean, readonly disabled = false) { super(message); }
}

async function callDeletion(body?: object) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Please sign in again.");
  const response = await fetch("/api/messages/delete", {
    method: body ? "POST" : "GET", cache: "no-store",
    headers: { Authorization: `Bearer ${data.session.access_token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok && response.status !== 403) throw new DeletionError(result.error ?? "Deletion blocked by an unresolved delivery or escalation state.", response.status === 409);
  if (body && !response.ok) throw new DeletionError("Deletion is disabled.", true, true);
  return result;
}

export function useMessageDeletion(onUnavailable: (id: string) => void, onDeleted?: (id: string) => void) {
  const [enabled, setEnabled] = useState(false);
  const [pending, setPending] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [states, setStates] = useState<Record<string, DeletionState>>({});
  const inFlight = useRef(false);
  useEffect(() => {
    let live = true;
    void callDeletion().then(result => {
      if (!live) return;
      setEnabled(result.enabled === true);
      setPending((result.pending ?? []).map((item: { message_id: string }) => item.message_id));
    }).catch(() => { /* Fail closed; unrelated message functionality stays available. */ });
    return () => { live = false; };
  }, []);

  async function run(id: string, action: "delete" | "check", recipient?: string) {
    if (!enabled || inFlight.current) return;
    if (action === "delete" && (pending.includes(id) || ["pending", "unknown", "deleted"].includes(states[id]))) return;
    if (action === "delete" && !window.confirm(`Delete this message for ${recipient ?? "this recipient"} and its attachments? This cannot be undone. Files used by another message will be retained.`)) return;
    inFlight.current = true;
    setBusy(id);
    setStates(current => ({ ...current, [id]: "deleting" }));
    setNotice("Deleting…");
    try {
      const result = await callDeletion({ messageId: id, action, ...(action === "delete" ? { confirmed: true } : {}) });
      if (result.outcome === "deleted") {
        onUnavailable(id);
        onDeleted?.(id);
        setStates(current => ({ ...current, [id]: "deleted" }));
        setPending(current => current.filter(item => item !== id));
        setNotice("Message deleted.");
      } else if (result.outcome === "pending") {
        onUnavailable(id);
        setStates(current => ({ ...current, [id]: "pending" }));
        setPending(current => Array.from(new Set([...current, id])));
        setNotice("Cleanup pending. Check deletion status to continue safely.");
      } else throw new DeletionError("The message has not been finalized.", result.outcome === "blocked");
    } catch (error) {
      const blocked = error instanceof DeletionError && error.blocked;
      if (error instanceof DeletionError && error.disabled) setEnabled(false);
      setStates(current => ({ ...current, [id]: blocked ? "blocked" : "unknown" }));
      setNotice(blocked ? `Deletion blocked. ${error.message}` : "Result uncertain. Check deletion status before retrying.");
      // A lost response may conceal a committed request. Reconcile, never repeat automatically.
      try {
        const status = await callDeletion();
        setEnabled(status.enabled === true);
        const ids: string[] = (status.pending ?? []).map((item: { message_id: string }) => item.message_id);
        setPending(ids);
        ids.forEach(onUnavailable);
      } catch { /* Inventory remains durable on the server. */ }
    } finally { inFlight.current = false; setBusy(null); }
  }
  return { enabled, pending, busy, notice, states, run };
}
