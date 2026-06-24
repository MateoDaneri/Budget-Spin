# BudgetSpin — Destacados para estudiar

> Agent-readable mirror of `DESTACADOS.html`. Keep both in sync.
> Decisiones y conceptos para subrayar (no problemas — eso va en la bitácora),
> porque encierran un principio reusable. Se agrega cuando el usuario dice
> «destacar en html». Estructura: la decisión → por qué → contraejemplo → para
> recordar.

## DEST-001 — El orden de las instrucciones decide la velocidad del build
Fase 2 · Stage 1 (builder) · Docker · cache de capas · `Dockerfile` stage `builder`

- **La decisión:** copiar primero solo los manifiestos e instalar, y recién después el resto del código:
  ```dockerfile
  COPY package.json package-lock.json ./
  RUN npm ci
  COPY . .
  RUN npm run build
  ```
- **Por qué (cache de capas):** cada instrucción produce una capa; Docker reusa una capa cacheada si la instrucción y sus inputs no cambiaron. Para `COPY`, el input es el contenido copiado; para `RUN`, el comando + el estado de las capas previas. Regla clave: apenas una capa se invalida, todas las siguientes se reconstruyen. Como `npm ci` depende solo de `package*.json` (cambia rara vez), su capa queda cacheada y los ~503 MB no se reinstalan cuando solo tocás un `.tsx`.
- **Contraejemplo (orden ingenuo):** `COPY . .` antes de `npm ci` → cualquier cambio de código bustea el cache de instalación y reinstala 503 MB en cada build. En CI se paga en cada push.
- **Para recordar:** ordená de lo que menos cambia a lo que más cambia (deps arriba, código abajo). Una capa invalidada arrastra a todas las siguientes → pasos caros y estables lo más arriba posible. DevSecOps: build rápido = *time-to-patch* corto; `npm ci` mantiene reproducibilidad con verificación de hashes.

## DEST-002 — Tu app viaja compilada, no como `src/` — y por qué `migrate.ts` necesita esbuild aparte
Fase 2 · Stage 1 (builder) · Compilación · fuente vs artefacto · esbuild · `next build` · `.next/standalone`

- **El concepto:** el código fuente (`app/` + `src/`, TypeScript) no es lo que corre en prod. Lo que corre es el artefacto compilado: `next build` transforma la app a JS plano en `.next/standalone`. `src/` cruda no viaja porque en runtime nadie la lee.
  ```
  app/ + src/ (lo que la app usa)  ──next build──▶  .next/standalone/   # app web
  src/db/migrate.ts (entrypoint suelto) ──esbuild──▶  migrate.mjs        # migración
  ```
  Analogía: en C escribís `.c` y compilás a un binario; a prod mandás el binario, no los `.c`.
- **Por qué `migrate.ts` necesita esbuild aparte:** `next build` solo compila lo conectado al grafo de imports de la app. `migrate.ts` es un entrypoint suelto (ninguna página lo importa; se ejecuta con `node` vía `db:migrate`), así que Next no lo ve. esbuild lo compila a `migrate.mjs`: TS→JS + bundle de `repository.ts`/`client.ts`, sin externos salvo `node:` builtins.
- **La confusión común:** «no veo `src/` en la imagen, ¿falta mi app?» No: la app está compilada en `.next/standalone` (las páginas `app/*.tsx` → `.next/server/app/*.js`) y la migración en `migrate.mjs`. Solo no viaja la fuente cruda; el código muerto (`schema.ts`, que nadie importa) no se compila a ningún lado.
- **Para recordar:** embarcá el artefacto, no la fuente (receta vs plato cocinado). Los entrypoints fuera del grafo necesitan su propia compilación. Compilar en build time (no runtime con tsx) saca la maquinaria de compilación de la imagen → menos superficie. Seguridad: que la fuente no viaje reduce superficie (no es control fuerte — el JS es reversible).

## DEST-003 — El lockfile de la app no es el inventario del artefacto
Fase 3 · CI · Supply chain · imagen base · undici en npm global · CVE-2026-12151

- **El concepto:** el gate de Trivy frenó por `CVE-2026-12151` (HIGH) en **undici 6.25.0**. `npm why undici` devolvió "No dependencies found" porque consultaba el árbol local de BudgetSpin, mientras que el log de Trivy ubicó el paquete en `/usr/local/lib/node_modules/npm/node_modules/undici/package.json`: lo incorpora el npm global de `node:24-slim`, fuera de `package-lock.json`.
- **Por qué:** `lo que DECLARÁS (package.json) ⊂ lo que SHIPPEA (la imagen)`. El artefacto también hereda SO, Node, npm y sus dependencias desde la imagen base. Por eso un lockfile limpio no prueba que la imagen esté limpia; hay que escanear e inventariar el artefacto final.
- **Impacto en la remediación:** `npm update undici` u `overrides` en BudgetSpin no alcanzan un paquete gestionado por el npm global de la base. Las opciones reales son actualizar el digest de la imagen base, retirar npm del stage runtime si no se necesita, o aceptar el riesgo con alcance y vencimiento. En este caso se aceptó hasta 2026-09-22: producción ejecuta `node` directamente y el repo no usa `new WebSocket`, `WebSocketStream`, `ws://` ni `wss://`, condiciones requeridas por el advisory.
- **Para recordar:** el SBOM de la imagen es el inventario relevante porque incluye paquetes heredados de la base. Aun así no es omnisciente: código inlineado/minificado sin metadatos puede perder identidad. La aceptación vive en `.trivyignore-gate` y se aplica solo al gate; SARIF y JSON conservan el hallazgo para que aceptar no signifique dejar de verlo.

## DEST-004 — El "base" de un PR es una etiqueta, no un commit — y encadenar PRs sobre ramas sin mergear tiene una trampa
Git/GitHub · workflow · PRs encadenados · base branch · PR #21 (chore/node-lts-discipline → main) · PR #22 (docs/... → chore/node-lts-discipline)

- **La decisión:** para un cambio que depende de docs ya editados en una rama todavía sin mergear, conviene ramificar **desde esa rama**, no desde `main` — evita editar una versión vieja del archivo y generar conflicto cuando la primera se mergee. Resultado: PR #22 (base `chore/node-lts-discipline`) encadenado sobre PR #21 (base `main`), todavía abierto.
- **Por qué (qué ES el base de un PR):** un PR tiene dos puntas — **head** (la rama con los commits nuevos) y **base** (la rama a la que apunta el botón "Merge"). El base no es un commit fijo ni una copia, es una *etiqueta* que GitHub usa para calcular el diff y decidir el destino real del merge. Cambiarlo (`gh pr edit N --base main`) no toca ningún commit ni reescribe historia — solo redirige el sobre, no cambia el contenido.
- **La trampa de encadenar sobre una rama no mergeada:** mergear el PR de abajo (#21 → main) **no** mueve solo el base del de arriba (#22 → chore/node-lts-discipline). Dos rutas posibles: (a) merge #21 sin borrar la rama → #22 sigue apuntando a esa rama ya "cumplida"; mergearlo entraría dentro de ella, no llega a `main` solo. (b) merge #21 + borrar la rama → GitHub **auto-retargetea** #22 hacia `main` (su "padre"). El auto-retargeteo solo se dispara al **borrar** la rama base de un PR abierto, no al mergearla — si la rama queda viva "por las dudas", el PR de arriba queda flotando sin que nada avise.
- **Para recordar:** el base es metadata, no contenido — cambiarlo antes o después de mergear el PR de abajo no afecta los commits, solo el destino final. La forma más prolija de encadenar PRs es retargetear explícitamente el de arriba a la rama final en cuanto se sabe cuál va a ser, en vez de confiar en el auto-retargeteo por borrado — elimina la ambigüedad de orden de operaciones. Si retargeteás *antes* de mergear el PR de abajo, el diff se ve "inflado" temporalmente (incluye esos commits, porque todavía no están en el destino) — se acomoda solo al mergearse. Encadenar PRs sobre ramas no mergeadas es válido y común, pero exige ser explícito sobre el destino final.
