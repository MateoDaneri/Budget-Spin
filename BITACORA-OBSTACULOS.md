# BudgetSpin — Bitácora de obstáculos

> Agent-readable mirror of `BITACORA-OBSTACULOS.html`. Keep both in sync.
> Problemas no triviales que encontramos y resolvimos, con causa raíz, evidencia
> y lección. Estructura de cada entrada: contexto → síntoma → evidencia → causa
> raíz → comportamiento esperado → resolución → lección.

## OBS-001 — Árbol de `node_modules` corrupto: tipos fantasma y `Permission denied`
Fase 1 · CI · Integridad del entorno · Resuelto · 2026-06-09 · `node_modules/`

- **Contexto:** preparar el entorno local para typecheck/tests antes del pipeline de CI.
- **Síntoma:** `rm -rf node_modules` fallaba con `Permission denied`; typecheck tiraba `Cannot find type definition file for 'chai 2'` — tipos inexistentes en deps declaradas.
- **Evidencia:** carpetas duplicadas con sufijo ` 2` (`@types/chai 2`, etc.) dentro de `node_modules` (firma de install interrumpido/concurrente); directorios con permisos no-propios que bloqueaban el borrado.
- **Causa raíz:** instalación npm corrupta. TypeScript levantaba los `@types/* 2` como definiciones válidas y se quejaba del paquete real ausente — definiciones fantasma, no problema del código.
- **Esperado:** árbol de deps limpio y reproducible, reconstruido desde el lockfile.
- **Resolución:** `sudo rm -rf node_modules && npm ci`. `npm ci` reconstruye bit a bit desde `package-lock.json`, sin re-resolver rangos.
- **Lección:** ante tipos fantasma o módulos que "no existen", sospechar del árbol antes que del código. Sufijo ` 2` = install corrupto/concurrente. `npm ci` da árbol determinista; `install` no. Seguridad: un install no determinista es riesgo de integridad — no sabés qué vas a ejecutar.

## OBS-002 — OOM en los tests: bug de timezone en `addMonths` → loop infinito
Fase 1 · CI · Clase de bug: timezone · Resuelto · 2026-06-09 · `src/finance/dates.ts` · `09405ff`

- **Contexto:** dejar verde la suite de Vitest antes de meterla como gate en CI.
- **Síntoma:** `FATAL ERROR: JavaScript heap out of memory` en `repository.test.ts`; Node consumía toda la RAM.
- **Evidencia:** aislando con `-t` y `--reporter=verbose`, el crash header reveló que el test que crasheaba era el #10 (`calculatePlanProjection`), no el #6 que sugería el output. El run compuesto ocultaba el test real.
- **Causa raíz:** `addMonths` construía la fecha con `Date.UTC(...)` pero la leía con getters de hora local. En UTC−3 era un no-op: devolvía el mismo mes → `monthsInclusive` nunca llegaba al final → loop infinito → OOM.
- **Esperado:** `addMonths` independiente de la TZ del host.
- **Resolución (2 capas):** (A) construir y leer la fecha en UTC + tests de regresión TZ-independientes en `tests/dates.test.ts`. (B) `TZ: America/Montevideo` en `ci.yml` — los runners corren UTC por default y habrían dejado pasar el bug.
- **Lección:** runners en UTC esconden una clase entera de bugs de timezone; verde en CI ≠ correcto en tu zona. El síntoma (OOM) puede estar lejos de la causa (aritmética de fechas). Tests aislados exponen lo que el run compuesto oculta.

## OBS-003 — Pinnear una Action por SHA: el tag anotado no es el commit que corre
Fase 1 · CI · Supply chain · Resuelto · 2026-06-10 · `.github/workflows/ci.yml`

- **Contexto:** pinnear las Actions por SHA (no tags mutables) para cerrar el vector tipo `tj-actions/changed-files` (2025): un repo de Action comprometido puede mover un tag a código malicioso.
- **Síntoma:** el SHA "obvio" del tag `v6.0.3` de `actions/checkout` no era el commit que ejecuta la Action.
- **Evidencia:** `v6.0.3` es un tag **anotado** → apunta a un objeto tag con hash propio (`9f69817…`), no a un commit. El commit dereferenciado — el que corre — es otro (`df4cb1c…`).
- **Causa raíz:** en git un tag anotado es un objeto propio con su SHA. Lo que ejecuta la Action es el commit al que apunta, no el objeto tag.
- **Resolución:** dereferenciar el tag al commit y pinnear ese: `uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6.0.3`. El comentario legible es para humanos; el SHA es la verdad inmutable.
- **Lección:** pinnear por SHA es la defensa contra el repunte malicioso de tags — pero hay que pinnear el commit correcto. Tag anotado vs lightweight muerde justo acá. El SHA es content-addressed (no repunteable); el tag es puntero mutable.

## OBS-004 — Gitleaks devolvía 403 en eventos `pull_request`
Fase 1 · CI · Least privilege · Resuelto · 2026-06-10 · job `secrets-scan` en `ci.yml`

- **Contexto:** el workflow declaraba `permissions: contents: read` global (least privilege: zerea los scopes no mencionados). El job de gitleaks falló en el primer `pull_request`.
- **Síntoma:** `gitleaks-action` devolvía 403 al listar los commits del PR vía API.
- **Evidencia:** header de la respuesta `x-accepted-github-permissions: pull_requests=read` — nombra el permiso faltante.
- **Causa raíz:** declarar `contents: read` a nivel workflow pone todo lo demás en `none`, incluido `pull-requests`. En `pull_request`, gitleaks lista commits por API → necesita `pull-requests: read`.
- **Esperado:** cada job con exactamente los permisos que usa.
- **Resolución:** override a nivel de job solo en `secrets-scan` (`contents: read` + `pull-requests: read`); los otros dos mantienen el default estricto. Además `GITLEAKS_ENABLE_COMMENTS: "false"` (comentar necesitaría `pull-requests: write`).
- **Lección:** `permissions:` zerea lo no mencionado — ese es el objetivo, pero hay que conceder explícito lo que cada job usa. El override por job mantiene el principio sin abrir todo. Los headers de error bien diseñados dan el permiso exacto: leer la evidencia en vez de abrir scopes de más.

## OBS-005 — La branch protection no se enforzaba en repo privado del plan Free
Fase 1 · CI · Control de cambios · Resuelto (con decisión) · 2026-06-11 · Ruleset `protect-main`

- **Contexto:** configurar protección de `main` vía Ruleset (requerir PR + 3 checks, sin bypass).
- **Síntoma:** el ruleset se creaba con warning de que no se enforzaría.
- **Evidencia:** aviso de la UI + docs: rulesets/branch protection en repos privados requieren Team/Enterprise; en Free solo enforzan en repos públicos.
- **Causa raíz:** limitación de plan, no de config. El ruleset existía pero era decorativo.
- **Esperado:** push directo a `main` y merge sin checks físicamente bloqueados, no por disciplina.
- **Resolución:** hacer el repo **público**, tras auditar el historial limpio (sin secrets — apoyado en gitleaks de OBS-004 y la higiene de `.gitignore` de Fase 0). Extra: code scanning con SARIF gratis es solo para públicos.
- **Lección:** algunas features de enforcement están detrás de un paywall — conocer el límite del plan antes de diseñar el control. Antes de publicar, auditar el historial: lo commiteado es para siempre. La verificación "no hay secrets" va ANTES de publicar.

## OBS-006 — Dependabot: conflictos seriales de lockfile en cascada
Fase 1 · CI · Mantenimiento de deps · Resuelto · 2026-06-11 · `.github/dependabot.yml` · PR #7

- **Contexto:** Dependabot abrió varios PRs de actualización a la vez.
- **Síntoma:** al mergear uno, los otros pasaban de ✓ a ✗.
- **Evidencia:** cada PR edita `package-lock.json`; tras mergear el primero, los demás quedaban desactualizados vs `main` → conflicto. El modo estricto del ruleset lo amplificaba.
- **Causa raíz:** problema estructural N²: N PRs tocando el mismo archivo compartido (el lockfile) → conflictos en cascada al mergear de a uno.
- **Resolución (arquitectónica):** `groups` en `dependabot.yml` — un grupo `npm-minor-patch` (todas minor/patch en UN PR) y un grupo `actions`. Un PR, un cambio de lockfile, cero conflicto serial.
- **Lección:** cuando varios cambios automáticos tocan un archivo compartido, agruparlos resuelve en la arquitectura; mergear rápido o rebasear a mano es un parche que no escala. El modo estricto es correcto pero amplifica el patrón → agrupar, no relajar el control.

## OBS-007 — ESLint 10 incompatible con `eslint-config-next`
Fase 1 · CI · Mantenimiento de deps · Decisión consciente: no mergear · 2026-06-11 · PR #5 (abierto)

- **Contexto:** Dependabot propuso el major ESLint 10.
- **Síntoma:** el PR quedaba en rojo; el step de lint rompía con la config de Next.
- **Causa raíz:** `eslint-config-next` aún no soporta ESLint 10 — incompatibilidad de major entre un peer y el nuevo major.
- **Resolución:** dejar el PR #5 **abierto** como recordatorio vivo de upgrade pendiente de soporte upstream. Mismo criterio con TypeScript 6 (PR #10) y `@types/node` 25.
- **Lección:** no todo lo que Dependabot propone se mergea: los majors pueden romper peers. El PR abierto es un recordatorio barato y visible; la decisión "esperar a upstream" queda documentada. Tensión parches ↔ estabilidad: un major apurado rompe más de lo que arregla.

## OBS-008 — El trace de `standalone` filtró la base de datos de desarrollo al artefacto
Fase 2 · Imagen hardened · Supply chain / fuga de datos · Resuelto (capas A + B aplicadas) · 2026-06-13 · `next.config.ts`, `src/db/client.ts`

- **Contexto:** activamos `output: "standalone"` (primer paso de Fase 2). El file tracing recorta `.next/standalone/` a lo que la app alcanza en runtime (319 paq/503 MB → 12/38 MB).
- **Síntoma:** apareció `.next/standalone/data/budgetspin.sqlite` — la DB de dev con datos sembrados.
- **Evidencia:** los `.nft.json` de casi todas las rutas listan `data/budgetspin.sqlite` como dependencia (nft la decidió incluir); mtime = build time (es una copia hecha en el build); contenido con tablas sembradas (`users`, `currencies`, …) = la DB real.
- **Causa raíz:** `@vercel/nft` hace análisis estático de operaciones de filesystem. Vio la ruta literal de `src/db/client.ts` (`path.join(process.cwd(), "data", "budgetspin.sqlite")`) y la trató como asset a hornear. No distingue asset estático (`config.json`, `.wasm`) de estado mutable de runtime (una DB): en el código las dos se ven igual (`fs.read(path)`).
- **Esperado:** imagen inmutable y stateless; la DB vive en el volume (`budgetspin-prod-data:/app/data`), la crea `db:migrate` al arrancar, persiste entre deploys. El `data/` de la imagen debe estar vacío.
- **Por qué `.dockerignore` no alcanza:** solo afecta el build context (`COPY . .`), no el `COPY --from=builder` entre stages, donde la sqlite ya vive dentro de standalone. Mitigación, no fix.
- **Resolución (2 capas):** (A, aplicado) `outputFileTracingExcludes: { "*": ["data/**"] }` en `next.config.ts` — corrige en la fuente; verificado que `.next/standalone/data` desaparece. (B, aplicado) `rm -rf .next/standalone/data` en el stage builder del Dockerfile — red determinista por si A falla o cambia la versión de Next.
- **Lección:** las herramientas de build que "ayudan" copiando assets pueden arrastrar estado mutable. Distinguir asset de build vs estado de runtime es central en contenedores inmutables. Defensa en profundidad: corregir en la fuente y poner una red determinista. El `.dockerignore` no cubre lo que pasa entre stages. Verificar, no asumir.
