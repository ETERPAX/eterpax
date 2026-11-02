# Campaña anual: vencimiento, avisos e instalación

## Estado de esta entrega

Implementación aislada en `feature/social-annual-promotion`, sobre el commit
`10e6c36` y la base de producción `d56c0ee`. El repositorio original
`/Users/Colocha/Projects/eterpax`, su rama y sus cambios pendientes se conservan.

La política de vencimiento y continuidad descrita abajo fue aprobada por el
usuario. **La campaña sigue deshabilitada.** No se han aplicado estas migraciones
ni cargado hashes en producción. No se generaron códigos nuevos y no se consumió
ninguno de los 20 códigos existentes. No se enviaron correos reales.

Vercel fue consultado con la sesión local renovada: proyecto `eterpax`, rama de
producción `sprint-1-landing`, despliegue READY `dpl_DGsc17ys2jK1b4N5ESivqLouJuor`,
commit `d56c0ee4ea6651d57d65ab4f92d15c614035a573`. Esa evidencia corresponde a la
versión anterior, no a esta implementación. No se integra la rama de producción
antes de disponer de la migración: el nuevo editor depende del RPC de permisos.

## Acceso administrativo

Se revisó `/Users/Colocha/Backups/eterpax-production-db/connection.json`: contiene
`host`, `port`, `user` y `dbname`; **no contiene contraseña**. Los scripts de
respaldo y migración allí presentes usan `getpass`, no una contraseña persistida.
No se encontró ejecutable de Supabase CLI, archivo de token en sus ubicaciones
habituales ni credencial disponible en los servicios de Keychain revisados.
La clave Supabase de la aplicación no es una conexión SQL administrativa.

El respaldo `backup-20261022T185227Z-EXPORTED/database.dump` permitió contrastar
solo el esquema histórico. Su motor contiene exactamente una vez el predicado
que cambia esta migración; el trigger de correo solo actúa al pasar de
`scheduled` a `awaiting_response`, no por la activación inicial de un plan.
El respaldo no demuestra el estado actual de producción: ejecutar el preflight.

## Política aprobada

- Al vencer una promoción sin otro plan vigente, impedir creación/edición de
  mensajes y adjuntos, nuevas configuraciones de Check-in y nuevos ciclos.
  Un ciclo `scheduled` con cero fallos, sin solicitud emitida, aún no empezó.
- Una solicitud `awaiting_response`, sus reintentos (`missed_count>0`), verificación
  de Guardianes, Safety Window y entrega ya autorizada siguen sus reglas
  originales. No se cancela, deshabilita, reprograma ni cambia su generación.
  El motor conserva sus bloqueos, plazos y creación de escalaciones; únicamente
  se añade un filtro para no iniciar ciclos nuevos de promociones vencidas.
- El titular conserva `confirm_check_in()`: puede confirmar que está bien y
  detener una escalación mediante el flujo ya existente. Esa acción voluntaria
  conserva su semántica original. El ciclo siguiente no comenzará sin plan.
- El vencimiento no ejecuta entregas ni decide una liberación. Un proceso previo
  puede llegar a entregar después del vencimiento únicamente por sus reglas
  originales de verificación, mayoría, Safety Window y autorización.
- Se mantienen lectura, descarga y eliminación de mensajes. Las restricciones
  de seguridad preexistentes para eliminación durante continuidad o de mensajes
  ya liberados permanecen: la promoción no autoriza saltarlas. La transición
  interna de borrado puede ejecutarse sin permitir cambios de contenido adjuntos.
- No hay cobro, renovación automática ni borrado por vencimiento. Las
  suscripciones y Lifetime conservan prioridad según `has_paid_plan()` vigente.
- La compra restaura permisos por consulta del plan, sin crear otra activación
  ni resetear Check-in. Se conserva el ciclo/fecha existente; un ciclo pendiente
  puede empezar en la siguiente ejecución normal del motor si su fecha ya llegó.

## Canje y privacidad

Continúan los contratos de `10e6c36`: campaña `social-annual-2026`, 10 slots por
plataforma, códigos aleatorios de 192 bits almacenados como SHA-256, correo
verificado, cuenta derivada del token, bloqueo transaccional por cuenta y código,
12 meses calendario UTC desde el canje, un beneficio por cuenta para siempre y
5 intentos cada 15 minutos. No se crean suscripciones ficticias ni acceso Lifetime.
El inventario original está fuera de Git en `eterpax-private-social-2026`.

Los bloqueos de vencimiento son triggers de DB y políticas restrictivas de Storage;
no dependen del navegador. El cliente muestra estado bilingüe y actualiza permisos
al recuperar foco o cada 30 segundos. Las lecturas/descargas no reciben una nueva
restricción. `promotion_writes_allowed` solo restringe promociones vencidas;
no cambia la política de otras cuentas gratuitas ni los planes pagados.

## Avisos de 30 y 7 días

Cron dedicado `/api/cron/promotion-expiry`, cada minuto, protegido por `CRON_SECRET`.
Requiere `PROMOTION_EXPIRY_NOTICES_ENABLED=true`, entorno Production y el gate DB
`promotion_notice_settings.enabled=true`. No llama al motor ni a entrega privada.

Cada cuenta/plazo tiene una fila única. La reserva de envío se confirma antes de
llamar a Resend; el proveedor recibe una clave de idempotencia estable. Se registran
aceptación e ID de proveedor. Errores o respuestas ambiguas quedan `uncertain` sin
reenvío automático, incluso después de vencer la idempotencia del proveedor.
Un fallo de cron se recupera en la ventana vigente; no se envía el aviso de 30 días
al alcanzar 7 días, ni avisos después de vencer. Otro plan válido suprime avisos aún
no reservados. Un aviso en vuelo puede terminar; su texto reconoce otros planes.

La ejecución no puede garantizar la recepción en inbox ni simultáneamente prometer
reintento ilimitado y cero duplicados ante un resultado desconocido. Revisar
`uncertain` con el proveedor antes de cualquier reconciliación manual; no liberar
reservas ni volver a enviar automáticamente. Los emails contienen fechas UTC y
texto EN/ES; nunca códigos, secretos ni contenido privado de mensajes.

## SQL exacto para ejecución manual

Paquete privado ya preparado, sin generar códigos:
`/Users/Colocha/Projects/eterpax-private-social-2026/manual-deployment/`.
Los archivos tienen permisos 0600; `SHA256.json` verifica sus bytes.

Ejecutar en el proyecto correcto de Supabase, SQL Editor, **uno por uno**:

1. `00-preflight.sql`: solo lectura. Revisar requisitos, funciones y triggers.
   Si `campaign_already_installed=false`, continuar con 01. Si ya es true,
   no repetir la migración base: revisar la instalación y pasar a 02 solo si falta.
   Si ya existe la política, no repetir 02 sin revisar su recibo/definiciones.
2. `01-install-campaign.sql`: copia exacta de
   `supabase/migrations/202611010001_social_annual_promotion.sql`.
3. `02-install-expiry-policy.sql`: copia exacta de
   `supabase/migrations/202611020001_promotion_expiry_policy.sql`.
   Instala la política aprobada, pero mantiene campaña y avisos apagados.
   Rechaza un motor incompatible en lugar de reemplazarlo silenciosamente.
4. `03-install-EXISTING-hashes.sql`: copia del manifiesto original de los mismos
   20 códigos. Solo hashes. Idempotente: rechaza otro inventario, no agrega códigos.
5. `04-verify-disabled.sql`: solo lectura; debe confirmar política compatible,
   RLS/permisos privados, motor filtrado, ambos gates apagados, cero beneficios,
   exactamente 10 Instagram y 10 Facebook sin usar. Guardar el recibo JSON.

**Detenerse tras 04.** Estos pasos no publican ni habilitan la campaña. Las
migraciones son incrementales: no aplicar el historial entero ni volver a iniciar
`account_activation_policy`. Si alguna transacción falla, conservar su error y no
avanzar. Los pasos 01 y 02 no son scripts recurrentes.

## Integración, publicación y habilitación posteriores

1. Completar las pruebas pendientes y verificar el resultado de 04 en la DB actual.
2. Integrar solo los commits de esta rama sobre el HEAD remoto actualizado de
   `sprint-1-landing`, mediante el flujo Git conectado a Vercel. Conservar el resto
   de cambios. Mantener ambos flags de servidor ausentes/false en el primer deploy.
3. Esperar READY en Production y comprobar que su SHA es el commit aprobado.
   Consultar `GET /api/promotions/readiness` autenticado con `CRON_SECRET`:
   `compatible=true`, `revision` correcto, DB con política
   `read_only_finish_started_cycles_v1`, `engine_gated=true`, 10/10 disponibles,
   cero beneficios, gates apagados. Es una consulta: no consume códigos ni manda correo.
4. Solo con estas evidencias, ejecutar
   `05-enable-ONLY-AFTER-VERIFIED-DEPLOY.sql`. No ejecutarlo durante la instalación.
5. Configurar en Vercel Production únicamente `SOCIAL_PROMOTION_ENABLED=true` y
   `PROMOTION_EXPIRY_NOTICES_ENABLED=true`; desplegar el mismo commit. No cambiar
   flags de continuidad, Guardian, Safety Window, entrega privada o Stripe.
6. Repetir readiness autenticado: SHA correcto, compatible, gates de servidor y
   DB activos, exactamente 10 códigos disponibles por plataforma, cero beneficios.
   Confirmar cron configurado y ausencia de avisos pendientes sin promociones.
   No hacer un canje real para probar producción.

Para suspender nuevos canjes/avisos, apagar sus propios gates. No eliminar
beneficios, inventarios, reservas, mensajes o ledger; no tocar ciclos en curso.

## Validación y límites

- 15 pruebas Node aprobadas: canje, presentación, generador anterior, autenticación,
  avisos bilingües, claves idempotentes, resultados inciertos y cron aislado.
- PostgreSQL desechable: aprobados canje/concurrencia, vencimiento, escrituras y
  Storage, preservación de borrado, bloqueo de ciclos nuevos, continuidad de
  solicitudes/reintentos, Safety Window y RPC original de confirmación, restauración
  mediante el webhook de plan sin reset, y cola concurrente de 30/7 días.
- Posteriormente se amplió ese laboratorio para usar el motor completo versionado
  de `202610080002_guardian_escalation_handoff.sql`, compatible con el respaldo.
  **Esa última ampliación quedó sin ejecutar:** se rechazó el permiso de ejecución
  local elevada. Su sintaxis Python fue validada. Comando pendiente:
  `python3 tests/social-promotion-integration.py --expiry`.
- TypeScript sin errores. Lint global: 0 errores, 34 advertencias preexistentes.
  Build Webpack de producción completado con valores públicos ficticios de
  Supabase. Ese artefacto local no se publica: Vercel recompila con sus variables.
- No hay validación de SQL contra producción ni evidencia de nueva migración o
  activación remota. No presentar este estado como campaña habilitada.
