# syntax=docker/dockerfile:1

# ───────────────────────── Stage 1: builder ─────────────────────────
# Toolchain completa (devDeps incluidas) para compilar. Se descarta entero:
# nada de este stage llega a la imagen final salvo lo que copiemos explícito.
FROM node:24-slim@sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203 AS builder
WORKDIR /app

# Manifiestos primero: la capa de npm ci se cachea mientras no cambien las
# dependencias, aunque cambie el código (orden cache-friendly).
COPY package.json package-lock.json ./
# npm ci, no install: versiones exactas del lockfile + verificación de hashes.
RUN npm ci

# Resto del código y build. El .dockerignore filtra node_modules/.next/sqlite.
COPY . .
# 1) compila la app            -> .next/standalone
# 2) borra la DB que el trace pudiera haber copiado (defensa en profundidad)
# 3) bundlea el entrypoint de migración (fuera del grafo de Next) -> migrate.mjs
RUN npm run build \
 && rm -rf .next/standalone/data \
 && node_modules/.bin/esbuild src/db/migrate.ts --bundle --platform=node --format=esm --outfile=migrate.mjs

# ───────────────────────── Stage 2: runtime ─────────────────────────
# Arranca limpio desde la misma base pinneada: sin toolchain, sin devDeps,
# sin código fuente. Solo el artefacto compilado.
FROM node:24-slim@sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203
WORKDIR /app

# Modo producción + binding explícito en 0.0.0.0 (server.js lee HOSTNAME/PORT;
# fijarlo evita que un HOSTNAME heredado deje el server inalcanzable).
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000

# Solo los artefactos del builder. standalone no incluye static/ ni public/:
# hay que copiarlos aparte.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static     ./.next/static
COPY --from=builder /app/public           ./public
COPY --from=builder /app/migrate.mjs      ./migrate.mjs

# El dir de datos es propiedad del usuario sin privilegios; el volume montado
# ahí hereda esta propiedad. El resto del código queda de root y node solo lo
# lee: ni con RCE puede reescribir su propio código.
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

EXPOSE 3000
# Migra (idempotente) y arranca. node directo, sin npm. El compose de prod
# override-ea este CMD para sumar el guard de BUDGETSPIN_AUTH_SECRET.
CMD ["sh", "-c", "node migrate.mjs && node server.js"]
