# ETERPAX EN/ES — implementación de interfaz activa

Base: `origin/sprint-1-landing`, `2671c9aa841aab08c356ac1119a6b232cb54de57`, descendiente de `38deb33`.
Rama: `feature/complete-en-es`. Worktree: `/private/tmp/eterpax-complete-en-es`.
El workspace principal y su trabajo pendiente se conservaron. No se añadieron dependencias ni páginas duplicadas.

## Rutas cubiertas

- `/create-account`, `/login`, `/about-you`, `/journey`, `/your-wishes`, `/your-guardians`, `/check-in`, `/payment`, `/activate`.
- `/dashboard`, `/your-messages` (lista, alta, edición, grabadores, fotos, documentos y carta), `/guardians`, `/review` (Preview), `/document-viewer`, `/continuity-space`.
- `/recipient`: bienvenida, colección, apertura, etiquetas de archivos, descarga y errores; el contenido personal se conserva literalmente.
- `/settings/personal-information`: reutiliza CreateAccountView y conserva su modo de edición.
- `/`, `/welcome`, `/settings`, `/forgot-password`, `/reset-password`, `/check-in-settings`: conservan la traducción publicada y comparten el catálogo ampliado de errores.
- Componentes activos compartidos: encabezado de onboarding, campos, botones, aviso de Guardianes, selección de planes, modal Your Plan y editor de cartas.

La ruta `/` importa la Landing de `/welcome`; no existe una ruta `/preview`: la vista activa es `/review`. Los componentes históricos de `components/home`, `components/landing`, `components/layout`, OnboardingSidebar y OnboardingLayout no se importan en estos flujos y no se modificaron.

## Alcance y garantías

- Inglés predeterminado, preferencia `eterpax_language`, restauración después de hidratar y `html lang` conservados en el proveedor existente.
- Solo se mantienen los selectores de Landing y Settings. Registro ya no condiciona la traducción al modo de edición de cuenta.
- El slogan de marca permanece en inglés. El titular español sigue siendo «Deja un legado que perdure.»
- Los precios, USD, rutas, tokens, nombres, correos, archivos y contenido personal no se traducen ni modifican.
- Los estados internos siguen en inglés; sus etiquetas se traducen únicamente al mostrarse. Los errores conocidos se traducen al renderizar o mostrar un aviso, sin cambiar los errores usados por el código.
- El placeholder del editor se actualiza mediante decoración, sin modificar el documento ni su historial.
- No se modificaron APIs, Stripe, webhooks, Supabase, RLS, migraciones, cron, Continuity Engine, Safety Window, Delivery, cifrado ni correos operativos.
- En `useMessageDeletion` solo cambia el texto de la confirmación; condiciones, llamadas, estados y autorización permanecen iguales.

## Excepciones explícitas

- `/guardian-verification` conserva su HTML y comparaciones sensibles. No se modificó su contrato ni sus respuestas literales.
- `/owner/release-authorization` es una herramienta de prueba controlada con identificador fijo y confirmación irreversible; permanece intacta, fuera del flujo de clientes.
- `/lab` y los componentes antiguos no utilizados permanecen intactos.
- Detalles desconocidos de errores de servicios externos se conservan literalmente. Las etiquetas conocidas que los acompañan sí se traducen.
- Metadatos de servidor, nombres de archivos, fechas producidas por el formato existente y controles nativos del navegador conservan su comportamiento anterior.
- Los correos operativos permanecen en su idioma original por la restricción expresa del alcance.

## Validaciones

- TypeScript: `tsc --noEmit --incremental false` correcto; también pasó TypeScript dentro del build final.
- Lint global final: `npm run lint`, 0 errores y 34 advertencias de imágenes, variables sin usar y dependencias de hooks existentes. El ajuste del placeholder también pasó lint específico.
- Build de Production: `npm run build -- --webpack`, correcto, 39/39 páginas generadas. Se usaron `NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co` y una clave pública ficticia para evitar datos reales. Google Fonts requirió acceso de red autorizado. No se cambiaron configuración ni dependencias para compilar.
- `git diff --check`: correcto.
- `node --test tests/i18n-interface.test.mjs`: 5/5 pruebas correctas. Paridad EN/ES, claves de llamadas literales, parámetros, inglés original, titular aprobado, errores compuestos y conservación de valores personales.
- Auditoría estructural contra `2671c9a`: correcta en 25 archivos de interfaz; no cambiaron llamadas sensibles, comparaciones existentes ni atributos técnicos.
- Chrome local sobre el build final, con respuestas simuladas y escrituras bloqueadas: Landing ES → Create Account ES; onboarding ES; Dashboard ES → Your Messages ES → Settings ES; cambio ES → EN y recarga; regreso a ES y recarga. También Login, recuperación, Guardianes, Check-in Settings, Preview y destinatarios.
- Modal de planes: textos traducidos y precio `$4.99` conservado.
- Carta ficticia de destinatario: contenido original en inglés, nombre y llaves conservados literalmente mientras la interfaz está en español.
- No se observaron errores de hidratación ni excepciones de la aplicación en la ejecución final. Se corrigieron esperas y aserciones del verificador local durante su preparación; no requirieron cambios de la aplicación.
- Revisión visual: 1440×1000 y 390×844, registro, Dashboard y nuevo mensaje. Seis capturas, sin desbordamiento horizontal. Se conserva el contraste bajo preexistente de la etiqueta del destinatario y el indicador de pasos; no se alteró el diseño.
- No se ejecutaron pagos, correos, escrituras reales, simulaciones de fallecimiento ni operaciones de entrega.

Evidencia local: `/private/tmp/eterpax-browser-report.json`, `/private/tmp/eterpax-*-desktop.png`, `/private/tmp/eterpax-*-mobile.png`, `/private/tmp/i18n-build.log`, `/private/tmp/i18n-lint-verified.log`.


La comprobación estructural compara contra `2671c9a` las llamadas de autenticación, API, almacenamiento y navegación, comparaciones estrictas y atributos técnicos de JSX. Todo permanece igual; la única comparación nueva permitida identifica la extensión visual `placeholder` del editor.

## Archivos modificados

- `app/(auth)/about-you/page.tsx`
- `app/(auth)/activate/page.tsx`
- `app/(auth)/document-viewer/DocumentViewerClient.tsx`
- `app/(auth)/guardians/page.tsx`
- `app/(auth)/journey/page.tsx`
- `app/(auth)/login/page.tsx`
- `app/(auth)/payment/page.tsx`
- `app/(auth)/review/page.tsx`
- `app/(auth)/your-guardians/page.tsx`
- `app/(auth)/your-messages/page.tsx`
- `app/(auth)/your-wishes/page.tsx`
- `app/check-in/page.tsx`
- `app/continuity-space/page.tsx`
- `app/dashboard/page.tsx`
- `app/recipient/recipient-collection.tsx`
- `components/EterpaxLetterEditor.tsx/EterpaxLetterEditor.tsx`
- `components/LanguageProvider.tsx`
- `components/PlanSelection.tsx`
- `components/auth/CreateAccountView.tsx`
- `components/auth/OnboardingHeader.tsx`
- `components/dashboard/YourPlanModal.tsx`
- `components/guardians/GuardianSavedNotice.tsx`
- `components/messages/useMessageDeletion.ts`
- `components/ui/Button.tsx`
- `components/ui/Input.tsx`
- `lib/i18n/dictionaries.ts`
- `tests/i18n-interface.test.mjs`

- `Docs/en-es-completion.md` (este reporte).

## Riesgos y límites

La revisión de interfaz usa servicios simulados locales y datos ficticios. No demuestra una operación real de pago, envío, cifrado, entrega o fallecimiento, ni intenta realizarla. Los flujos funcionales originales se preservan y no se vuelven a probar de forma extensa. El español puede ocupar más líneas que el inglés; la revisión visual verifica las pantallas representativas.

Sin push ni deploy. Publicación pendiente de autorización de ARGOS CTO.

## Commits por módulo

- `39b4856`: catálogo, interpolación y pruebas de cobertura.
- `c30d78d`: cuenta, autenticación y onboarding.
- `c73cb63`: presentación de Guardianes y Check-in.
- `2349115`: Dashboard y planes.
- `93e370e`: mensajes, editor, Preview y destinatarios.
- El commit de cierre incluye este reporte y el ajuste del placeholder validado en el build final.
