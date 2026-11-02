import { withEmailPresentation } from "../email/presentation";

export function promotionExpiryEmail(expiresAt: string, days: 30 | 7) {
  const date = new Date(expiresAt);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid expiry");
  const format = (locale: string) => new Intl.DateTimeFormat(locale, {
    dateStyle: "long", timeStyle: "short", timeZone: "UTC",
  }).format(date) + " UTC";
  return withEmailPresentation({
    subject: `ETERPAX — acceso promocional / promotional access (${days} días / days)`,
    text: `Tu acceso promocional de ETERPAX vence el ${format("es-MX")}.

Sin otro plan vigente, no podrás crear ni editar mensajes ni iniciar nuevos ciclos de Check-in. Podrás consultar, descargar y solicitar la eliminación de tus mensajes, respetando las protecciones existentes de entrega. Los procesos de continuidad ya iniciados seguirán sus reglas originales y podrás confirmar que estás bien.

No habrá cargos, renovación automática ni borrado por vencimiento. Si deseas mantener todas las funciones, puedes elegir un plan en tu cuenta. Si ya tienes otro plan vigente, conservarás sus permisos.

Your ETERPAX promotional access expires on ${format("en-US")}.

Without another active plan, you will no longer be able to create or edit messages or start new Check-in cycles. You can view, download and request deletion of your messages, subject to existing delivery safeguards. Continuity processes already started will follow their original rules, and you can still confirm that you are well.

There is no charge, automatic renewal or deletion on expiry. Choose a plan in your account to keep all features. Another active plan retains its permissions.

https://www.eterpax.com/dashboard`,
  });
}
