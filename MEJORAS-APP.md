# BudgetSpin — Mejoras a la app

> Agent-readable mirror of `MEJORAS-APP.html`. Keep both in sync.
> Backlog de mejoras diferidas a propósito para el final del proyecto (calidad/
> arquitectura, no bugs). Estructura: qué → por qué → cómo → alcance/riesgo →
> cuándo.

## MEJ-001 — Migrar a migraciones versionadas con Drizzle Kit
Capa de datos · migraciones · Prioridad media · Al final del proyecto · `src/db/repository.ts` (`migrate()`), `src/db/schema.ts`

- **Qué:** reemplazar el `migrate()` hecho a mano (SQL crudo idempotente: `CREATE TABLE IF NOT EXISTS` + helpers `ensureColumn`) por migraciones versionadas generadas con **Drizzle Kit**, con `schema.ts` como única fuente de verdad.
- **Por qué (prod-readiness):**
  - Historia auditable: una tabla de migraciones registra qué corrió y cuándo → responder "¿en qué versión de esquema está prod?" con exactitud (forense + compliance).
  - Cambios destructivos y ordenados: renames, drops, splits — que el enfoque idempotente no puede expresar (solo agrega).
  - Backfills con semántica run-once (hoy a mano en `migrateLegacyLocalUser()`).
  - Coordinación de equipo y multi-instancia: orden explícito + locking, sin carreras.
  - Salda deuda: `schema.ts` (Drizzle) está declarado pero desconectado de la migración real — se paga el costo sin el beneficio. Esto lo conecta.
- **Cómo (verificar al implementar):** definir el esquema completo en `schema.ts`; configurar Drizzle Kit y generar migraciones; sustituir el cuerpo de `migrate()` por la aplicación de las generadas; decidir cuándo corren (arranque vs paso dedicado previo, relevante con múltiples réplicas); preservar datos existentes probando sobre una copia real de la DB.
- **Alcance y riesgo:** toca la capa de datos → testing cuidadoso + preservación de datos. SQLite: `ALTER TABLE` limitado (dropear/renombrar columnas implica reconstruir la tabla), así que incluso con Drizzle Kit algunos cambios hacen maniobras. Hacerlo con la app estable, no en medio del hardening.
- **Cuándo:** al final del proyecto, junto con los TODOs de cierre (p. ej. migración a Renovate). No es parte de la Fase 2.

> MEJ-002 a MEJ-007 surgen de la rama `claude/feature-conciliacion` (importación
> de avisos Itaú, Splitwise y gasto observado). Ese trabajo se integró en `main`
> con el PR 58 y se desplegó el 2026-11-10. Cada entrada indica su propio estado.

## MEJ-002 — Autenticar el remitente de los avisos del banco
Importación · autenticidad del origen · Prioridad media · Antes de activar la importación · `src/ingest/itau-parser.ts` (`isItauAviso`), `src/ingest/itau-transfer.ts` (`isItauTransfer`), `src/ingest/imap.ts`

**Estado:** modo observación mergeado a main y desplegado el 2026-11-11 (PR 65; lint, typecheck, tests y build pasaron en el servidor el 2026-11-11); el bloqueo queda pendiente de una decisión después de revisar avisos reales. El texto de abajo queda como historia del hallazgo.

- **Qué:** antes de importar un aviso, exigir que el correo esté autenticado por el proveedor que lo recibió: `dkim=pass` (y/o `dmarc=pass`) alineado con el dominio del banco, leído del encabezado `Authentication-Results` que agrega el propio buzón. Hoy un aviso se acepta solo porque la dirección de `From` termina en el dominio del banco y el asunto coincide con un patrón.
- **Por qué:**
  - El `From` se puede falsificar: cualquiera que pueda mandar un correo al buzón puede escribir ese remitente y ese asunto. El código no consulta DKIM ni `Authentication-Results` (no aparecen en `src/`).
  - Un aviso falso cuenta en el gasto observado: se importa como `pending` y, según `FINANCIAL-RULES`, los pendientes entran en el total hasta que se descartan en `/transactions`.
  - La autenticación del buzón (contraseña de aplicación IMAP) no lo resuelve: autentica el acceso al buzón, no al remitente de cada mensaje.
- **Cómo (verificar al implementar):** pedir `Authentication-Results` junto con `From` y `Subject` (IMAP ya descarga el mensaje completo de los candidatos). Confiar solo en el encabezado del servidor propio (por su `authserv-id`), nunca en uno incluido en el mensaje original. Empezar en modo observación: registrar sin bloquear, comprobar con avisos reales que el banco firma con un dominio alineado (no verificado) y recién después mandar a cuarentena los que fallen con un motivo nuevo (p. ej. `unauthenticated`).
- **Alcance y riesgo:** toca el parser y el lector IMAP. Si el banco no firma, o firma con otro dominio, un control estricto dejaría todos los avisos en cuarentena: primero observar. Mientras no exista, el control compensatorio es revisar los pendientes antes de confiar en el total (ver `HANDOFF`, límite de confianza).
- **Cuándo:** antes de activar el scheduler de importación con un buzón real. Es la mejora de este grupo con más impacto en la integridad de los datos.
- **Implementado (modo observación):**
  - Cada aviso importado guarda un veredicto en `transactions.sender_auth`: `pass`, `fail` o `none`. Las filas importadas antes quedan en `NULL` (columna agregada con `ensureColumn`, sin migración destructiva). El encabezado no se guarda.
  - Encabezado confiable: con `ITAU_IMAP_AUTHSERV_ID` definida, el `Authentication-Results` más alto que tenga ese `authserv-id`; uno con otro `authserv-id` nunca se usa. Sin la variable, solo el más alto, lo que es más débil: depende de que el proveedor siempre agregue el suyo.
  - `pass`: `dmarc=pass` con `header.from` igual al dominio del `From`, o `dkim=pass` con `header.d` (o el dominio de `header.i`) igual al dominio del `From` o padre de él. `fail`: `dmarc=fail`, `dmarc=pass` evaluado para otro dominio, o resultados `dkim` sin ninguno alineado que pase. `none`: sin encabezado confiable o sin resultados `dkim`/`dmarc`.
  - La alineación es más estricta que la de DMARC relajado (sin lista de sufijos públicos): una firma de un subdominio del `From` no cuenta como alineada por sí sola, y un dominio de una sola etiqueta nunca se alinea.
  - Parser defensivo (`src/ingest/sender-auth.ts`, función pura): tope de 8 KB por encabezado y de 32 instancias, escáner lineal para comentarios y cadenas entre comillas, expresiones regulares fijas y acotadas.
  - No bloquea, no manda a cuarentena y no cambia totales: el gasto observado es el mismo con o sin veredicto.
  - `/transactions` muestra *Sender check failed* (`fail`) o *Sender unverified* (`none`) por fila, y un contador *N pending unverified* en la cabecera. Nada para `pass` ni para filas antiguas.
  - Tests: `tests/sender-auth.test.ts` (parser, alineación, selección del encabezado) y `tests/ingest-itau.test.ts` (veredicto guardado, encabezado inferior falsificado, gasto observado sin cambios).
  - Pendiente: revisar avisos reales, confirmar que el banco firma con un dominio alineado y decidir si los que fallan van a cuarentena con un motivo nuevo (p. ej. `unauthenticated`).

## MEJ-003 — Emparejamiento más flexible y confirmación manual de pares
Conciliación · gasto observado · Prioridad baja · Al final del proyecto · `src/finance/actual-spending.ts`, `src/actions/reconciliation.ts`, tabla `import_pair_exclusions`

**Estado:** parcialmente resuelta, mergeado a main y desplegado el 2026-11-11 (PR 66; lint, typecheck, 188 tests y build pasaron en el servidor el 2026-11-11): sugerencias con confirmación manual; la regla automática no cambia. El texto de abajo queda como historia del hallazgo.

- **Qué:** permitir que un aviso del banco y un gasto de Splitwise se emparejen aunque no coincidan exactamente (otro día cercano, descripción escrita distinto) y agregar una acción "son el mismo gasto" para confirmar un par a mano. Hoy solo se puede *rechazar* un par que la regla automática encontró.
- **Por qué:**
  - La regla exige mismo día UTC, misma descripción normalizada, misma moneda y mismo monto (detalle en `FINANCIAL-RULES`). Una compra cerca de la medianoche local o un comercio escrito distinto en Splitwise queda sin emparejar y se cuenta entero.
  - No hay forma de resolver a mano un caso "ambiguo"; el total queda marcado como estimación.
- **Cómo (verificar al implementar):** tabla de confirmaciones manuales simétrica a `import_pair_exclusions`, con prioridad sobre la regla automática. Tolerancia de fecha acotada (p. ej. ±1 día) y comparación de descripción más laxa, mostradas como "posibles" hasta confirmarse, nunca aplicadas en silencio. Actualizar `FINANCIAL-RULES` y sus tests en el mismo cambio.
- **Alcance y riesgo:** un emparejamiento falso reemplaza el monto del banco por la parte adeudada y **subestima** el gasto sin aviso. Toda regla más laxa tiene que requerir confirmación o quedar visible para revisión.
- **Cuándo:** al final del proyecto, después de observar con datos reales cuántos casos quedan ambiguos.

## MEJ-004 — Sincronización incremental de Splitwise (hoy relee todo y se corta en 2.000 gastos)
Splitwise · sincronización · Prioridad media · Al final del proyecto · `src/splitwise/client.ts` (`getSplitwiseSnapshot`, `EXPENSE_LIMIT`), `src/splitwise/store.ts`

**Estado:** resuelta, mergeado a main y desplegado el 2026-11-11 (PR 64; lint, typecheck, 134 tests y build pasaron en el servidor el 2026-11-11): sincronización incremental con marca de agua y pasada completa cada 7 días; el procedimiento está en RUNBOOK. No se comprobó contra la cuenta real de Splitwise. El texto de abajo queda como historia del hallazgo.

- **Qué:** pasar de una lectura completa en cada corrida a una incremental: pedir solo lo modificado desde la última sincronización exitosa.
- **Por qué:**
  - Límite duro: `getSplitwiseSnapshot` pide páginas de `EXPENSE_LIMIT = 20` y corta en 100 páginas. Si la página 100 llega llena, lanza `SplitwiseError("unavailable")`. Con 2.000 gastos o más, toda sincronización falla y la instantánea anterior queda congelada.
  - Costo: cada corrida (cada 3600 s por defecto) relee todo el historial y reescribe todas las filas en una transacción, aunque no haya cambios. Más pedidos implica más exposición a límites de tasa.
- **Cómo (verificar al implementar):** guardar una marca de agua (última fecha de actualización vista) y usar el filtro por fecha de actualización de `get_expenses` (verificar nombre y semántica en la documentación de la API de Splitwise). Mantener una lectura completa ocasional para detectar borrados y cambios que el filtro incremental no muestre. Reemplazar el corte por un error explícito con motivo, o por paginación sin tope fijo pero con límite de tiempo.
- **Alcance y riesgo:** cambia cómo se detectan borrados y modificaciones; una marca de agua mal guardada puede perder cambios sin que se note. Requiere tests de borde (zona horaria, gastos editados después de pagados).
- **Cuándo:** al final del proyecto, o antes si la cuenta se acerca a los 2.000 gastos.

## MEJ-005 — Un solo camino para activar los schedulers
Operación · schedulers · Prioridad media · Al final del proyecto · `docker-compose.prod.yml` (perfiles `ingest` y `splitwise-ingest`), `scripts/activate-sync.py`, `src/ingest/trigger-token.ts`

- **Qué:** quedarse con un único mecanismo para disparar las sincronizaciones. Hoy hay dos, excluyentes entre sí:
  - Perfiles de Compose: sidecars `ingest` y `splitwise-ingest`, con el token en la variable `INGEST_TOKEN`.
  - `scripts/activate-sync.py`: contenedores creados con `docker run` fuera de Compose, red interna propia y token en el archivo `/app/data/ingest-token`. El script se niega a seguir si la app tiene `INGEST_TOKEN` o la clave de Splitwise configuradas como variables.
- **Por qué:**
  - Dos caminos duplican nombres de contenedor, redes, ubicación del token e instrucciones. `triggerToken()` prefiere la variable al archivo: si alguien agrega `INGEST_TOKEN` después de usar el script, los schedulers del script reciben 401.
  - Los contenedores del script no aparecen en `docker compose ps`: más fácil olvidar uno corriendo.
- **Cómo (verificar al implementar):** elegir uno. Compose es declarativo y versionado; el script aplica más endurecimiento (`--read-only`, `--cap-drop ALL`, `no-new-privileges`, límite de PIDs, usuario sin privilegios). Llevar ese endurecimiento a los servicios de Compose y retirar el script parece el camino más simple. Unificar la ubicación del token (archivo privado montado, no variable de entorno visible en `docker inspect`).
- **Alcance y riesgo:** solo configuración y documentación; no toca datos. Si ya hay una instalación activada con el script, migrarla requiere parar y quitar esos contenedores antes de levantar los perfiles.
- **Cuándo:** antes del primer despliegue de la rama, si es posible; si no, al final del proyecto.

## MEJ-006 — Autenticar `/api/fx-rate` y acotar la exclusión `api` del proxy
Seguridad · rutas API · Prioridad media · Al final del proyecto · `proxy.ts` (`config.matcher`), `app/api/fx-rate/route.ts`

**Estado:** resuelta, mergeado a main y desplegado el 2026-11-11 (PR 63; lint, typecheck, 168 tests y build pasaron en el servidor el 2026-11-11). El texto de abajo queda como historia del hallazgo.

- **Qué:** el matcher del proxy es `/((?!_next/static|_next/image|favicon.ico|api).*)`: excluye de la verificación de sesión **toda** ruta que empiece con `api`, no solo las de importación. `/api/fx-rate` no verifica sesión por su cuenta, así que responde sin autenticación.
- **Por qué:**
  - Un cliente sin sesión puede hacer que el servidor consulte al proveedor de cotizaciones para cualquier par configurado y saber qué monedas están configuradas (400 vs 200). En caso de error devuelve el mensaje de la excepción (502).
  - Cualquier ruta `api*` futura queda pública por defecto si su autor no agrega un control: el default es abierto, no cerrado.
  - Las rutas de importación se protegen solas con el token bearer; esta mejora no las afecta.
- **Cómo (verificar al implementar):** acotar la exclusión del matcher a `api/ingest/` (con barra) para que el resto de `/api` pase por la sesión. Además, verificar sesión dentro de `/api/fx-rate` (defensa en profundidad); el único llamador, `CurrencyFxFields`, hace un `fetch` del mismo origen y ya envía la cookie. Devolver un mensaje fijo en el 502.
- **Alcance y riesgo:** cambio chico. Riesgo: que el proxy redirija a `/login` una llamada `fetch` (respuesta HTML en lugar de JSON); el componente tiene que tratarlo como error.
- **Cuándo:** al final del proyecto; antes si la app se expone fuera de la red privada.
- **Resolución:**
  - El matcher ya no excluye `api`: `/((?!_next/static|_next/image|favicon.ico).*)`. Toda ruta `/api/*` pasa por el proxy.
  - La decisión vive en `src/auth/access-policy.ts` (`decideAccess`, función pura con tests). Solo `/api/ingest/itau` y `/api/ingest/splitwise` pasan sin sesión, comparadas por ruta **exacta** (sin prefijos ni patrones): `/api/ingest/itau-foo`, `/api/ingest/itau/` o una ruta de importación nueva no heredan la excepción. Se descartó acotar el matcher a `api/ingest/`: dejaría pública por defecto cualquier ruta futura bajo ese prefijo.
  - Sin sesión, una ruta `/api/*` responde **401 JSON** `{"error":"Unauthorized."}`; una página sigue redirigiendo a `/login?next=…`. `/apiX` se trata como página, no como API ni como excepción.
  - `/api/fx-rate` verifica sesión por su cuenta (`getCurrentSession()`, 401) y devuelve un mensaje fijo en el 502.
  - Tests: `tests/access-policy.test.ts` (decisión y proxy) y `tests/fx-rate-route.test.ts`.

## MEJ-007 — Códigos de error fijos en lugar de texto libre en `?error=`
Server actions · mensajes de error · Prioridad baja · Al final del proyecto · `src/actions/forms.ts` (`redirectWithError`), `src/actions/auth.ts`, `app/expenses/page.tsx`, `app/income/page.tsx`, `app/plans/page.tsx`, `app/login/page.tsx`

**Estado:** resuelta, mergeado a main y desplegado el 2026-11-11 (PR 63; lint, typecheck, 168 tests y build pasaron en el servidor el 2026-11-11). El texto de abajo queda como historia del hallazgo.

- **Qué:** las acciones de gastos, ingresos, planes (y categorías) redirigen con `?error=<error.message>`, y login con mensajes propios o el de la excepción. Las páginas de gastos, ingresos, planes y login muestran ese parámetro tal cual. Pasar a códigos fijos que la página traduce a un texto conocido, como ya hacen `/transactions` (tabla `ERROR_MESSAGES`) y `/splitwise`.
- **Por qué:**
  - React escapa el texto, así que no es XSS, pero un enlace armado puede mostrar cualquier frase dentro de la app (inyección de contenido para engaño).
  - Los mensajes de excepciones internas (p. ej. de SQLite) llegan a la URL, al historial del navegador y a logs de proxy.
  - Hoy conviven dos patrones; uno solo es más fácil de revisar.
- **Cómo (verificar al implementar):** un mapa compartido código → mensaje; `redirectWithError` recibe un código, no un `Error`. Los errores de validación propios conservan su texto mediante códigos específicos; lo desconocido cae en un genérico.
- **Alcance y riesgo:** toca varias acciones y páginas, sin lógica de datos. Riesgo: perder detalle útil de validación si los códigos son demasiado gruesos.
- **Cuándo:** al final del proyecto, junto con MEJ-006.
- **Resolución:**
  - `src/actions/error-codes.ts`: códigos fijos, mapas código → mensaje (`FORM_ERROR_MESSAGES`, `LOGIN_ERROR_MESSAGES`) y `FormError`. Las validaciones de `src/actions/forms.ts` lanzan `FormError` con código; `redirectWithError` solo pone el código en la URL y todo lo demás (p. ej. errores de SQLite) sale como `unexpected`.
  - Formularios: `missing-field`, `invalid-number`, `invalid-option`, `unknown-currency`, `invalid-amount`, `invalid-fx-rate`, `invalid-recurrence`, `general-family-locked`. Login: `invalid-credentials` (el mismo para usuario inexistente y contraseña incorrecta), `missing-field`, `password-mismatch`, `weak-password`, `setup-failed`.
  - Gastos, ingresos, planes y login traducen el código con `formErrorMessage` / `loginErrorMessage`; un valor desconocido muestra un genérico y el parámetro nunca se renderiza. Categorías recibe el código pero no lo muestra (igual que antes).
  - Tests: `tests/error-codes.test.ts` (mapa, texto armado nunca reflejado, acciones que redirigen con código).
