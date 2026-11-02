# Campaña anual Instagram / Facebook

## Estado y alcance

Base revisada: `origin/sprint-1-landing` en `d56c0ee`. Implementación aislada en
`feature/social-annual-promotion`, checkout `eterpax-social-promotion`.
La rama inicialmente abierta, `feature/change4-guardian-verification`, contiene
trabajo ajeno sin commit. No se copió, modificó, descartó ni incluyó en este cambio.
La arquitectura de tres planes y la interfaz bilingüe ya están en la base remota;
la rama inicialmente abierta todavía usa una arquitectura anterior.

**La campaña debe permanecer deshabilitada.** El usuario decidió posponer la
política de vencimiento. No se han aplicado migraciones, cargado hashes, activado
variables ni publicado la aplicación con este trabajo. Generar el archivo privado
no hace canjeables los códigos hasta instalar su inventario y abrir ambos gates.
No se envían mensajes, no se publican códigos en redes y no se contacta a nadie.

## Contrato

- Campaña única `social-annual-2026`: 10 slots Instagram y 10 Facebook, sin cupos
  adicionales. Códigos aleatorios de 192 bits; SHA-256 en la base de datos.
- Cada cuenta puede recibir un solo beneficio, incluso después de vencer.
  Cada código puede beneficiar a una sola cuenta. La cuenta proviene del token
  autenticado, nunca de un campo del formulario. Correo confirmado se comprueba
  en servidor y nuevamente en PostgreSQL.
- El servidor calcula inicio/canje y vencimiento en UTC con `interval '12 months'`;
  no usa 365 días, reloj del navegador ni tiempo desde la generación del código.
- `promotional_access` enlaza el código, campaña y plataforma; registra cuenta,
  canje, inicio y vencimiento. Solo un RPC ligado a `auth.uid()` expone el beneficio
  propio, nunca hashes. RLS y revocación de permisos protegen tablas privadas.
- Un bloqueo por cuenta, compartido con Stripe/Guardian, y bloqueo de código
  serializan los canjes. Restricciones únicas impiden doble beneficio/código.
  Hasta 5 intentos por cuenta cada 15 minutos; el presupuesto persiste incluso en
  respuestas inválidas. Los errores no registran cuerpos, códigos ni tokens.
- Suscripciones activas, Lifetime y suscripciones aún potencialmente cobrables
  no son elegibles (solo estados `canceled`/`incomplete_expired` se admiten).
  No se invoca Stripe ni se modifica/cancela ninguna suscripción.
- `has_paid_plan` mantiene su significado. `has_plan_access` agrega promoción
  vigente al gating existente de Guardian; el RPC de elegibilidad informa
  `access_kind=promotion`. No se simula pago ni Lifetime.
- El repositorio no limita el número de mensajes por plan. Se conservan los
  permisos existentes y la organización, formatos y límites de adjuntos por
  mensaje. No se introduce una política nueva de almacenamiento ni RLS de mensajes.
- El ledger de activación admite una fuente promocional real con FK. Solo una
  configuración nueva pendiente, deshabilitada, sin historial, en `scheduled`,
  sin fallos ni plazo de respuesta, inicia su primer Check-in. Un ciclo existente
  queda intacto. Una configuración creada después del canje comienza desde su
  configuración, sin fechas vencidas derivadas del día de canje.
- El canje no llama a colas ni remitentes de notificaciones, entregas o Guardian.
  No hay tarea al vencer: no cobra, borra, reprograma, reinicia ni libera mensajes.
  Las acciones explícitas posteriores de guardar Guardian conservan su lógica.
- “Tengo un código / I have a code” aparece en la selección de planes, tanto en
  pago como en Your Plan. La cuenta muestra origen, estado y vencimiento UTC.
  Si la respuesta de red es incierta se pide actualizar la cuenta antes de repetir.

## Decisión de vencimiento pendiente

`Docs/activation-policy-phase1.md` documenta una política **informativa**, sin
restricciones de escritura, eliminación ni cambio de Continuity Engine. No hay
política completa de acceso vencido reutilizable para esta promoción.

El código calcula `promotion_expired` y deja de conceder `has_plan_access` por la
promoción vencida; un plan pagado conserva prioridad. No cambia mensajes ni ciclos
ya existentes. Esto permite probar el término sin elegir una política comercial.
La única opción técnica preparada en el gate, `retain_data_and_continuity`, no
está seleccionada ni aprobada. Antes de habilitar hay que decidir explícitamente
permisos de lectura/escritura, nuevas configuraciones y continuidad tras vencer;
si la decisión difiere, ajustar y revalidar primero. No interpretar este documento
como aprobación para habilitar ni para modificar la política de usuarios pagados.

## Publicación, en orden

1. Revalidar el HEAD remoto e integrar **solo** este commit conforme al flujo
   del repositorio. El push de la rama aislada no equivale a despliegue.
2. Ejecutar `scripts/social-promotion-preflight.sql` (solo lectura) en el proyecto
   correcto. Revisar que las funciones reales coincidan con las migraciones base
   `202610060002`, `202610060003`, `202610210002`, `202610210004`, y que los triggers
   de `check_ins` no emitan eventos por la transición inicial `scheduled` →
   `scheduled`. La prueba local no certifica el esquema desplegado ni triggers
   externos no versionados. Si hay drift, detener aplicación y adaptar el diff.
3. Aplicar una vez `supabase/migrations/202611010001_social_annual_promotion.sql`
   en su transacción. No volver a aplicar todo el historial ni reiniciar el reloj
   de `account_activation_policy`. La nueva campaña nace `enabled=false`,
   `expiry_policy=NULL`.
4. Mantener `SOCIAL_PROMOTION_ENABLED` ausente o `false` en servidor. Nunca usar
   una variable `NEXT_PUBLIC_` para habilitar canjes. Usar las credenciales Supabase
   existentes del servidor (`SUPABASE_SECRET_KEY`); no requiere secretos nuevos.
5. Tras validación, generar el inventario privado con:
   `node scripts/generate-social-promotion.mjs /ruta/privada/fuera-de-git`.
   Directorio 0700, archivo JSON 0600, separado por plataforma. Repetir con esa
   misma ruta conserva exactamente los mismos 20 códigos. Respaldar de forma
   privada; no borrar/recrear el inventario para “regenerar”. Una ruta distinta
   no permite añadir códigos: el RPC rechaza hashes distintos de los instalados.
6. Cuando corresponda cargar el inventario, aplicar el `install-hashes.sql`
   privado generado al proyecto revisado. Contiene hashes, no códigos utilizables.
   Repetir ese mismo archivo es idempotente. No habilita el canje.
7. Publicar la aplicación tras migrar y probar cuentas sintéticas en un proyecto
   de pruebas independiente. No instalar códigos de laboratorio en producción.
8. **Detenerse aquí hasta resolver la política de vencimiento.** Solo después
   de una decisión explícita y su validación se pueden configurar la política,
   `promotion_campaign.enabled=true` y `SOCIAL_PROMOTION_ENABLED=true`.
   No hay script que haga automáticamente esa habilitación.

Para suspender canjes, cerrar ambos gates. Esto conserva beneficios ya otorgados,
fechas, inventario, historial y ciclos; no revertir tablas ni borrar el ledger.

## Validación local

- `python3 tests/social-promotion-integration.py`: PostgreSQL 17 desechable,
  sin conexiones externas. Configurable con `PG_BIN`. Instala las migraciones
  originales de activación/planes y la nueva sobre fixtures. Valida 12 meses,
  año bisiesto, límite exacto de vencimiento, carreras de dos cuentas/un código y
  una cuenta/dos plataformas, cuenta pagada sin cambios, correo no verificado,
  cinco intentos/15 minutos, RLS/grants, inventario idempotente y rechazo de
  reemplazo, Guardian gating, primer Check-in y preservación de ciclo existente.
  La opción de vencimiento se habilita únicamente en este laboratorio desechable.
- `node --test tests/social-promotion.test.mjs tests/activation-policy.test.mjs`:
  hash, generador privado/idempotente, validación de RPC y presentación, endpoint
  con dependencias simuladas, autenticación/correo, gate, límite de cuerpo,
  respuestas HTTP y ausencia de códigos en argumentos DB/respuestas.
- `node_modules/.bin/tsc --noEmit --incremental false` y ESLint de los archivos
  modificados. Compilación de producción con valores públicos ficticios de
  Supabase; no usa credenciales reales ni activa integraciones.

Las pruebas no gastan ninguno de los 20 códigos finales ni envían correos. El
estado Problems del IDE no está expuesto a esta sesión: los diagnósticos se
verifican con TypeScript, lint y compilación; no se afirma leer el panel del IDE.
