# Guardian Verification — despliegue manual preparado

Base: `sprint-1-landing`, commit `8574f5e`. Integración local selectiva en
`/tmp/eterpax-gv-production`; la rama de desarrollo y su trabajo pendiente se conservan.
Referencia remota actualizada mediante fetch: `2388c94` es ancestro de la base local;
no hay cambios remotos de aplicación omitidos. SQL de producción ya instalado y confirmado por el CTO. No reinstalar ni repetir
pruebas de SQL. No preparar rondas, crear escalaciones ni enviar correos al desplegar.

## Contenido

- `/guardian-verification`: página dinámica, dos respuestas aprobadas, confirmación
  explícita, token solo en fragmento y eliminación inmediata del fragmento.
- `/api/guardian-verification/respond`: POST, validación de origen y digest SHA256,
  RPC restringida de respuesta ya instalada. GET no vota.
- Módulos `lib/continuity/guardian-verification-*` y comando manual de un destinatario.
- `vercel.json`: cron vacío. El coordinador `lib/continuity/server.ts` de la rama
  de producción se conserva exactamente; no se incorpora preparación ni envío automático.
- No hay cambios a mensajes privados, al resto de rutas, dependencias o migraciones.

## Configuración lista para aplicar tras autorización

`deployment/guardian-verification.production.json` contiene valores no secretos,
los textos aprobados copiados sin cambios y los límites del primer envío. Los campos
projectId y teamId deben coincidir con el proyecto Vercel existente;
no crear otro proyecto. El CTO confirmó `https://www.eterpax.com` como origen canónico;
el JSON lo fija en NEXT_PUBLIC_SITE_URL, sin copiar localhost de desarrollo.

Aplicar `vercel.variables` exclusivamente al entorno Production. Conservar todas
las demás variables del proyecto y sus funcionalidades. SUPABASE_SECRET_KEY debe
ser la credencial de servicio del proyecto de producción identificado en el JSON;
no imprimirla ni copiarla a archivos versionados. NEXT_PUBLIC_SITE_URL debe ser el
origen HTTPS canónico exacto, sin ruta. El build y runtime deben compartir ese valor: Next incorpora NEXT_PUBLIC_SITE_URL
durante compilación; cambiarlo solo al arrancar no corrige un build con localhost.
RESPONSE_ENABLED=true es correcto porque el SQL ya fue confirmado con COMMIT.
EMAIL_ENABLED, AUTOMATIC_ENABLED, PREPARATION_ENABLED y CONTINUITY_SCHEDULER_ENABLED
permanecen false. No reactivar cron en el dashboard.

Las credenciales de Resend existentes del resto de funcionalidades se conservan.
El envío manual usa `RESEND_API_KEY` cargada solo en el proceso autorizado, remitente
`ETERPAX <hello@eterpax.com>`, dominio eterpax.com verificado y click tracking
 desactivado para conservar el enlace con fragmento. No se modificó Resend remotamente.
La consulta de solo lectura a Resend con la credencial local devolvió HTTP 401.
Cargar una credencial válida y confirmar dominio/tracking antes del primer correo; no es necesario enviar un correo de prueba.

Documentación consultada: [variables de Vercel](https://vercel.com/docs/environment-variables),
[despliegue CLI](https://vercel.com/docs/cli/deploy) y
[tracking de Resend](https://www.resend.com/changelog/update-click-open-tracking-via-api).

## Autorización y ejecución posterior

Autorización propuesta: «Autorizo aplicar la configuración preparada y desplegar
Guardian Verification desde sprint-1-landing al proyecto/equipo y dominio confirmados,
sin push, sin preparar rondas y sin enviar correos».

Después de esa autorización: vincular únicamente el proyecto existente, configurar
las variables Production del JSON conservando las restantes y ejecutar
`vercel deploy --prod` desde `/tmp/eterpax-gv-production`. Antes de ejecutar, acreditar
la cuenta/proyecto correctos y que el origen coincide; no usar `--yes` para crear proyectos.
No requiere push. No usar `--prebuilt`: Vercel debe compilar con sus variables de
Production, conservando también las credenciales públicas existentes de la aplicación. El CLI no está instalado ni hay `.vercel` vinculado en este entorno.

Tras el despliegue, comprobar GET de la página y POST vacío (400, sin voto), origen
canónico y las dos etiquetas. El propio comando de envío vuelve a comprobarlos.
El primer correo requiere autorización separada, propietario y destinatario exactos,
escalación vigente con snapshot y ronda preparada; no se inventan esos datos.

## Validación local

La compilación y el smoke test se realizan únicamente contra la aplicación local de
producción. `tests/guardian-verification-production-smoke.mjs` comprueba página,
textos, endpoint y cron apagado sin credenciales, SQL ni proveedor. La verificación
remota solo será posible después del despliegue autorizado.

Resultado 2026-10-11: build de producción Next 16.2.10 (webpack) y TypeScript PASS
con NEXT_PUBLIC_SITE_URL=https://www.eterpax.com. Smoke sobre ese build PASS:
página 200 con los dos textos exactos, POST vacío 400, GET de API 405, cron 503.
Sin SQL, votos ni correos. No se repitieron pruebas funcionales/concurrentes aprobadas.
