# Release y entrega privada — entrega de implementación

Base: `a0f1a9d0fb0fe7bd1fc7d1ec9ffbf8bb49db56d8`, worktree `/private/tmp/eterpax-gv-production`, inicialmente limpio. No se aplicó SQL remoto, no se hicieron envíos, commits ni push. El workspace principal no se modifica.

## Arquitectura

`/api/cron/recipient-delivery` (GET autenticado con `CRON_SECRET`, cada minuto) ejecuta `process_private_message_releases()` y después reclama hasta tres notificaciones, una por vez. El endpoint permanece apagado salvo `PRIVATE_DELIVERY_ENABLED=true`; la migración instala además `release_enabled=false` y `delivery_enabled=false` en `private_delivery_settings`. Ni desplegar la aplicación ni instalar la migración autoriza el envío.

El release bloquea `check_ins → guardian_escalations → verification round → autorización → advisory lock del propietario (810)`. Revalida la generación, ausencia de check-in posterior, estado activo, mayoría estricta de participantes congelados, fecha original de 48 horas y vencimiento. Una autorización excepcional, consentida por el propietario y armada separadamente por el operador, puede sustituir solo la condición de vencimiento. No modifica votos ni fechas originales.

Se toman snapshots de todos los mensajes `draft` activos aún no liberados del propietario. Las cargas pendientes, contenido vacío, correo inválido, metadatos de cifrado incompletos o un archivo ausente/en limpieza bloquean el conjunto completo: no se envía una colección parcial. Se agrupan por `lower(trim(recipient_email))` dentro del release; nombres distintos con el mismo correo corresponden a la misma colección. No se eliminan puntos ni etiquetas `+` del correo. Distintos propietarios siempre generan colecciones independientes.

Cada mensaje solo puede liberarse una vez. La escalación pasa a `released` en la misma transacción que snapshots, grupos y cola. El padre conserva el estado existente de escalación; un check-in posterior funciona para un nuevo ciclo, pero no revierte un release ya autorizado. Una cancelación que adquiere primero el bloqueo del padre impide el release. Los reintentos de cron y la unicidad de escalación/mensaje/destinatario evitan duplicados.

Los originales liberados quedan inmovilizados. Los snapshots y las referencias conservan todos los metadatos necesarios para descifrar. Los objetos de Storage se bloquean durante la captura y un trigger impide su actualización/eliminación después. Las rutas deben pertenecer al propietario. Esto también protege frente al worker de limpieza existente. No se cambian las reglas de guardianes, Stripe ni el correo Owner Safety Window.

`message_release_checks` conserva último resultado, SQLSTATE sanitizado y próxima revisión (5 minutos). El orden por última revisión evita que escalaciones bloqueadas monopolicen el cron. Un `blocked` revierte solo esa escalación; las otras pueden procesarse.

## Entrega y acceso

Estados: `pending → claimed → sending → accepted | failed | uncertain`. Un claim preenvío vencido vuelve a `pending`; un `sending` vencido pasa a `uncertain`. Una reserva autoriza una sola llamada a Resend. Resultado desconocido o respuesta de finalización perdida nunca autoriza una nueva llamada. Un rechazo definitivo queda `failed` para intervención, no en un bucle de reenvíos. `accepted` significa aceptación del proveedor, no llegada a Gmail.

La clave de idempotencia es estable por notificación. Se conserva el ID de Resend. Las excepciones del proveedor, correos, contenido, claves y tokens no entran en logs. Las notificaciones contienen únicamente un enlace y su vencimiento, nunca cartas ni adjuntos.

La capacidad usa 32 bytes aleatorios y caduca a los 30 días. En base de datos se guarda exclusivamente SHA-256. El token viaja en el fragmento del enlace (`/recipient#…`), se retira del historial y se intercambia por una cookie `HttpOnly; Secure; SameSite=Strict`, limitada a `/api/recipient`. El token identifica una colección concreta; no se confía en IDs enviados por el navegador. El servidor valida destinatario/release, caducidad y revocación en cada lectura, y vuelve a validar tras descifrar.

La posesión del enlace es la autorización: reenviarlo comparte acceso. No se presenta como verificación de identidad adicional ni OTP. No hay acceso anónimo a las tablas ni exposición de hashes, rutas o claves. Las credenciales de Supabase permanecen en servidor. Los endpoints del propietario no se reutilizan.

Las cartas se muestran como texto, sin ejecutar HTML del propietario. Los archivos se sirven mediante un proxy privado con `no-store`; no se generan URLs de Storage. Audio/video soportan byte ranges y controles móviles; los documentos y tipos activos se descargan como contenido no ejecutable. Los nombres de descarga son genéricos para no revelar rutas. Los archivos heredados sin cifrado se sirven con la misma autorización; las versiones cifradas usan los helpers KMS/AES existentes.

Límites explícitos: hasta 1.000 mensajes por release y 100 MiB por archivo. Un archivo mayor bloquea el release completo antes de notificar. El proxy descifra el archivo entero en memoria antes de transmitirlo (también para un byte range); validar memoria y tiempos con el video real de mayor tamaño antes de activar. El token no se puede recuperar de la DB ni renovar automáticamente; una eventual renovación requiere un flujo administrativo adicional. Los adjuntos se conservan, incluso tras revocar acceso; no hay borrado automático de evidencia liberada.

## Migración completa

`supabase/migrations/202610190002_private_message_release.sql` contiene todas las tablas, índices, constraints, triggers, funciones, RLS y grants nuevos. Requiere las migraciones hasta `202610190001` y `202610130004` instaladas. Se aplica de forma atómica y desactivada. No contiene backfill ni llamadas al proveedor. No ejecutar todavía en Production.

Funciones del operador: `process_private_message_releases(uuid DEFAULT NULL)`, `arm_release_acceleration(uuid)`, `claim_recipient_delivery()`, `reserve_recipient_send(uuid,uuid,text)`, `finish_recipient_send(uuid,uuid,text,text)`, `recipient_access(text)`. Solo `service_role` tiene EXECUTE; los triggers y helpers internos no son invocables por clientes.

Funciones del propietario: `authorize_release_acceleration(uuid,text,text)` y `revoke_release_acceleration(uuid)`. Exigen `auth.uid()` y pertenencia real. El consentimiento requiere la frase exacta `AUTHORIZE EARLY IRREVERSIBLE RELEASE` y un motivo de 10–500 caracteres. Solo el operador puede armarlo dentro de la hora siguiente. Una autorización por escalación, vencimiento efectivo a +1 minuto, validez de 15 minutos, evidencia de consumo/revocación persistente. No se arma ninguna autorización al instalar.

## Despliegue autorizado posterior

1. Revisar el diff completo y los resultados de pruebas; autorizar commit/push/despliegue por separado. No desplegar desde el workspace principal ni copiar sus cambios.
2. Confirmar las migraciones predecesoras instaladas y aplicar **solo** la nueva migración. Comprobar ambos flags DB en `false`; no ejecutar release ni delivery durante la instalación.
3. Desplegar la aplicación con `PRIVATE_DELIVERY_ENABLED=false`. Mantener los secretos de Supabase, AWS/KMS y Resend de Production; `NEXT_PUBLIC_SITE_URL` debe ser el origen HTTPS canónico, sin slash final. `CRON_SECRET` debe tener al menos 32 caracteres y coincidir con el utilizado por Vercel. Confirmar que el plan permite cron cada minuto. El cron existente de continuidad y el de limpieza se conservan.
4. En Resend, confirmar dominio remitente y desactivar tracking de enlaces/aperturas para la notificación privada; no permitir que un rastreador reescriba/pierda el fragmento de la capacidad. Probar la conservación del fragmento en clientes reales durante la prueba autorizada.
5. Antes de la activación global, inspeccionar todas las escalaciones vencidas y el inventario de mensajes/archivos, incluida la capacidad de descifrado. Un flag global de release autoriza también los demás propietarios elegibles: no usarlo para una prueba de un solo propietario.
6. Tras aprobar el rollout general, activar los flags DB desde una sesión privilegiada y luego `PRIVATE_DELIVERY_ENABLED=true`. Una sola actualización de los flags puede autorizar toda la cola pendiente; revisar esa cola antes. Observar conteos de resultados y estados persistentes.

SQL de activación general, **documentado, no ejecutado**:

```sql
UPDATE public.private_delivery_settings
SET release_enabled = true, delivery_enabled = true
WHERE singleton;
```

## Prueba real posterior con Manu y Jero

No hay UUIDs del propietario o de destinatarios en el código. Los IDs siguientes se obtienen en la sesión autorizada, no se sustituyen por constantes del producto.

1. Mantener `release_enabled=false` y `delivery_enabled=false`. Confirmar la escalación autorizada y su fecha original `2026-10-21 05:50:41 UTC` contra la DB, y verificar que sigue activa, sin check-in posterior. Revisar exclusivamente sus mensajes: destinatarios correctos, agrupación esperada (Manu/Jero), cartas y todos los adjuntos, subidas terminadas, tamaños admitidos, rutas privadas y metadatos KMS. No inferir correos a partir de nombres. Esta lectura remota aún está pendiente de autorización/ejecución.
2. Desde una sesión **autenticada del propietario**, invocar `authorize_release_acceleration` con `p_escalation_id`, motivo y frase explícita. Conservar el ID devuelto como recibo. Un operador no debe suplantar `auth.uid()` mediante SQL.
3. El operador revisa el recibo y llama `arm_release_acceleration(p_authorization_id)`. Esperar un minuto. No modificar `majority_reached_at`, `safety_deadline_at` ni respuestas de guardianes.
4. Con credenciales servidor, llamar `process_private_message_releases({p_authorization_id: recibo})` dentro de los 15 minutos de vigencia. Esta ejecución **solo** acepta la escalación del recibo, aun con el release global apagado; no libera otros propietarios vencidos. El cron normal sin parámetro permanece inactivo para releases mientras `release_enabled=false`. No hace falta adelantar el reloj del servidor.
5. Antes de habilitar envíos, verificar un único release, los grupos esperados y todos los snapshots/adjuntos. Confirmar que la cola pendiente global contiene exclusivamente las notificaciones autorizadas para esta prueba. Si contiene otras, no habilitar entrega global: investigar el estado primero.
6. Con autorización explícita de envío, mantener `release_enabled=false`, establecer `delivery_enabled=true` y `PRIVATE_DELIVERY_ENABLED=true`. El cron dedicado entrega las notificaciones pendientes. Confirmar un único ID de proveedor por destinatario y estado `accepted`. No reenviar `uncertain`: contrastar con Resend primero. Una repetición del cron no debe producir un segundo envío.
7. Manu y Jero confirman recepción real, abren sus enlaces en móvil y revisan todos sus mensajes, carta, audio, video, fotografías y documentos. Verificar que cada colección contiene únicamente su contenido. No copiar tokens a logs, tickets, capturas o esta conversación. La confirmación de inbox y el acceso real completan la prueba; `accepted` por sí solo no basta.
8. Apagar `delivery_enabled` y el endpoint si aún no se autorizó operación general. La prueba no altera la regla de 48 horas. Conservar la autorización consumida y la evidencia del release/IDs de proveedor.

Antes del consumo, el propietario puede llamar `revoke_release_acceleration` y la fecha original sigue siendo la única fecha efectiva. Después del release no existe rollback de información ya vista o descargada. Para detener acceso futuro, un operador puede establecer `message_releases.revoked_at` en una sesión privilegiada, además de apagar nuevos envíos; no elimina evidencia ni deshace un correo enviado.

## Operación y recuperación

Consulta orientativa para el operador (lectura, no ejecutada):

```sql
SELECT r.id AS release_id, r.escalation_id, rr.id AS recipient_id,
       count(i.id) AS messages, d.id AS delivery_id, d.status,
       d.provider_message_id, d.outcome_code, d.token_expires_at
FROM public.message_releases r
JOIN public.message_release_recipients rr ON rr.release_id = r.id
JOIN public.message_release_items i ON i.recipient_id = rr.id
JOIN public.recipient_deliveries d ON d.recipient_id = rr.id
GROUP BY r.id, rr.id, d.id;

SELECT escalation_id, outcome_code, error_sqlstate, next_attempt_at
FROM public.message_release_checks;
```

No seleccionar ni registrar tokens, ciphertexts, claves o contenidos para diagnosticar delivery. Tras fallo preenvío, el próximo cron recupera el claim vencido. Tras un envío incierto, conservarlo sin reenvío automático. Si Resend confirma aceptación, reconciliar el estado con evidencia; no fabricar un nuevo token para reintentar una solicitud de resultado desconocido. Los estados `failed` requieren corregir la causa y diseñar una reemisión explícita revisada; este incremento no la automatiza.

Para pausar: apagar `PRIVATE_DELIVERY_ENABLED` y ambos flags DB. Un envío ya reservado podría terminar; la pausa no retracta solicitudes en vuelo. No eliminar tablas/constraints como rollback después de un release. Conservar snapshots y evidencias; revocar acceso si procede. La revocación no interrumpe una transmisión ya autorizada y comenzada.

## Verificación local

- `python3 tests/private-delivery-lab.py`: PostgreSQL 17 desechable, socket Unix, sin conexión remota. Aplica migraciones reales de coordinación/borrado y la nueva migración, usa la función existente de confirmación del propietario, prueba bloqueos, concurrencia, RLS, autorizaciones, snapshots y claims.
- `node --test tests/*.test.mjs`: suite existente más pruebas de worker, clasificación del proveedor, capacidades, cookie segura, aislamiento y proxy de adjuntos. Resend, KMS y Storage se simulan solo en estas pruebas; no hay envío real.
- `npx tsc --noEmit`, `npm run lint`, `npm run build -- --webpack`.
- El build por defecto con Turbopack rechaza el enlace externo de `node_modules` de este worktree; Webpack usa las mismas fuentes para el build de Production. En CI con instalación normal de dependencias no existe ese enlace.

Se corrigieron siete errores de lint ya presentes en la base (seis escapes de apóstrofos JSX y un alias de tipo equivalente). No se modificó comportamiento de esos componentes.

## Archivos de esta entrega

| Archivo | Cambio |
| --- | --- |
| `supabase/migrations/202610190002_private_message_release.sql` | Migración completa, desactivada |
| `lib/recipient-delivery/core.ts` | Capacidades, hashes, clasificación del proveedor y cabeceras |
| `lib/recipient-delivery/client.ts` | Cliente servidor con tiempos máximos |
| `lib/recipient-delivery/worker.ts` | Release/claims/reserva/envío/finalización |
| `lib/recipient-delivery/access.ts` | Sesión privada, colección y proxy de descifrado |
| `app/api/cron/recipient-delivery/route.ts` | Cron dedicado autenticado |
| `app/api/recipient/session/route.ts` | Intercambio de capacidad por cookie |
| `app/api/recipient/messages/route.ts` | Colección autorizada |
| `app/api/recipient/content/route.ts` | Carta y adjuntos autorizados |
| `app/recipient/page.tsx` | Entrada privada y metadatos |
| `app/recipient/recipient-collection.tsx` | Experiencia móvil, descargas y reproductores |
| `next.config.ts` | Cabeceras privadas únicamente para `/recipient` |
| `vercel.json` | Cron nuevo, sin eliminar los existentes |
| `tests/private-delivery-lab.py` | 43 comprobaciones PostgreSQL real desechable |
| `tests/recipient-delivery.test.mjs` | 15 pruebas nuevas de worker/acceso/archivos |
| `scripts/private-message-delivery-rollout.md` | Arquitectura, despliegue, prueba real y resultados |
| `app/(auth)/forgot-password/page.tsx` | Dos escapes JSX para lint |
| `app/(auth)/your-guardians/page.tsx` | Un escape JSX para lint |
| `app/check-in/page.tsx` | Dos escapes JSX para lint |
| `components/auth/OnboardingSidebar.tsx` | Un escape JSX para lint |
| `design-system/ui/Card.tsx` | Alias de tipo equivalente para lint |

Resultados: 155/155 pruebas Node aprobadas; 43/43 comprobaciones PostgreSQL aprobadas; TypeScript sin errores; lint global con 0 errores y 35 advertencias previas, lint de archivos nuevos sin advertencias. Build Webpack pendiente de resultado final en el momento de esta anotación. Los valores públicos usados para el build local son `https://build.invalid` y una clave ficticia: ese artefacto no se despliega; Production debe recompilar con su configuración real.
