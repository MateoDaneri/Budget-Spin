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
