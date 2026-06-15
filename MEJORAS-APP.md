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
