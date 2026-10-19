"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

const ESCALATION_ID = "d17b2200-5ad1-46b1-888c-a3b5ba8a0d90";
const CONFIRMATION = "AUTHORIZE EARLY IRREVERSIBLE RELEASE";

export default function ReleaseAuthorizationPage() {
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");

  async function authorize() {
    if (!confirmed || loading) return;

    setLoading(true);
    setResult("");

    try {
      

      const { data: { session }, error } =
        await supabase.auth.getSession();

      if (error || !session?.access_token) {
        throw new Error("Inicia sesión en ETERPAX primero.");
      }

      const response = await fetch(
        "/api/owner/release-authorization",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            escalationId: ESCALATION_ID,
            reason:
              "Controlled production delivery test authorized by the owner for Manu.",
            confirmation: CONFIRMATION,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok || !data.authorization_id) {
        throw new Error(data.error || "No se pudo autorizar.");
      }

      setResult(
        `Autorización registrada: ${data.authorization_id}`
      );
    } catch (error) {
      setResult(
        error instanceof Error ? error.message : "Error inesperado."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 600, margin: "60px auto", padding: 24 }}>
     <h1>ETERPAX — Autorización excepcional</h1>

      <p>
        Autorizo la liberación anticipada e irreversible
        de mis mensajes destinados a Manu, exclusivamente
        para esta prueba controlada de Production.
      </p>

      <p>     Entiendo que, una vez liberados, los mensajes
        podrían ser vistos o descargados y que la operación
        no puede deshacerse.
      </p>

      <label>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        {" "}Confirmo expresamente esta autorización.
      </label>

      <div style={{ marginTop: 24 }}>
        <button
          type="button"
          disabled={!confirmed || loading || !!result.startsWith("Autorización registrada")}
          onClick={authorize}
        >
          {loading ? "Registrando..." : "AUTORIZAR LIBERACIÓN EXCEPCIONAL"}
        </button>
      </div>

      <p>{result}</p>
    </main>
  );
}
