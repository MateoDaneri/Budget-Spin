# Diseño: neto real del mes y saldo acumulado por moneda

Fecha: 2026-11-14 · Rama: `claude/feature-neto-y-saldo` · Base: `main` @ `f9eb81d`

## 1. Intención

El dashboard hoy muestra un neto **solo de plan** (ingresos − gastos recurrentes, en
UYU con tipo de cambio). Lo gastado de verdad (avisos de Itaú + Splitwise) aparece
aparte y nunca se resta. El dueño quiere ver, **por moneda (UYU y USD, sin
convertir)**:

- **A · Neto real del mes:** ingreso fijo del mes − lo gastado observado en el mes.
- **B · Saldo acumulado:** cuánto "tiene" en cada moneda, donde un gasto cuenta
  **desde que se hizo**, aunque la plata salga de la cuenta días después (una compra
  con tarjeta ya está gastada).

No se quiere deuda técnica: si el cálculo actual hay que rehacerlo, se rehace.

## 2. Objetivos / no-objetivos / anti-objetivos

| | |
|---|---|
| Objetivos | A y B por moneda en el dashboard; carga de saldo inicial por moneda; ajustes manuales con nota; una sola regla de "qué es gasto observado" compartida por todas las vistas |
| No-objetivos | checklist de cuentas a pagar y su vínculo con transferencias de Itaú (se diseña después); contar transferencias enviadas; ingresos observados (el ingreso es el fijo configurado); conversión entre monedas; reemplazar el neto de plan existente |
| Anti-objetivos | un saldo guardado que pueda desincronizarse de sus fuentes; dos implementaciones de la misma regla de gasto; un número que parezca exacto cuando hay avisos pendientes/ambiguos sin revisar |

## 3. Enfoques considerados

| Enfoque | Trade-off | Decisión |
|---|---|---|
| **1. Calcular al leer** desde saldo inicial + ingresos + gastos observados + ajustes | sin estado derivado; recalcula todo el historial por request (despreciable al volumen actual) | **Elegido** |
| 2. Saldo mensual persistido, actualizado al importar | lecturas baratas, pero descartes, pares confirmados y syncs de Splitwise obligan a invalidar meses viejos; un caso olvidado deja el saldo mal en silencio | descartado |
| 3. Libro de asientos materializado | modelo contable clásico; duplica datos que ya existen | descartado |

El dueño delegó la elección ("la que tenga más sentido con la arquitectura"). La 1 es
la que encaja: todo `src/finance/*` ya son funciones puras sobre filas listadas, que
los server components calculan en cada request (`app/page.tsx`), y el esquema se crea
con `CREATE TABLE IF NOT EXISTS` en `migrate()` (`src/db/repository.ts`).

## 4. Rework del cálculo existente (parte del alcance)

**R1 · Recurrencia por fechas.** `src/finance/recurrence.ts` solo cuenta ocurrencias
por mes. El saldo necesita *fechas* (el ingreso suma el día configurado). Se agrega
`listOccurrences(schedule, from, to): string[]` (fechas `YYYY-MM-DD`) como única
implementación, y `countOccurrencesInMonth` pasa a ser `listOccurrences(...mes).length`.
Los tests existentes de `tests/recurrence.test.ts` deben seguir pasando sin cambios.

**R2 · El gasto observado expone sus aportes.** `calculateActualMonth`
(`src/finance/actual-spending.ts`) devuelve solo totales por moneda. Pasa a devolver
también `contributions: Array<{ date: "YYYY-MM-DD"; currency; amountMinor; source:
"bank" | "splitwise"; refId }>`, uno por cada importe que hoy entra al total (compra
completa, parte propia de un par, parte propia de un gasto de Splitwise sin pagar).
`totals` se **deriva** de `contributions` (no se suma por separado). Así A, B y la
comparación plan-vs-gasto usan exactamente la misma regla de `FINANCIAL-RULES`.
Fecha del aporte: prefijo de 10 caracteres del timestamp guardado (misma convención
UTC ya documentada en FINANCIAL-RULES §8; para un par, la fecha de la compra bancaria).

**R3 · Cambio de política documentado.** FINANCIAL-RULES §1 dice que lo observado
"nunca se resta del plan". Se mantiene para los **gastos** planificados; se agrega que
el **ingreso fijo** sí se combina con lo observado en A y B. Actualizar
`FINANCIAL-RULES.md` y `.html` en el mismo cambio.

## 5. Modelo nuevo

Dos tablas en `migrate()` y en `src/db/schema.ts`:

```sql
CREATE TABLE IF NOT EXISTS opening_balances (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency_code TEXT NOT NULL REFERENCES currencies(code),
  amount_minor INTEGER NOT NULL,          -- puede ser negativo
  as_of_date TEXT NOT NULL,               -- saldo al CIERRE de ese día
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, currency_code)
);
CREATE TABLE IF NOT EXISTS balance_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency_code TEXT NOT NULL REFERENCES currencies(code),
  amount_minor INTEGER NOT NULL,          -- con signo, distinto de 0
  adjustment_date TEXT NOT NULL,
  note TEXT NOT NULL,                     -- obligatoria: es la traza del ajuste
  created_at TEXT NOT NULL
);
```

Un saldo inicial por moneda (editarlo lo reemplaza). Los ajustes se agregan o
borran; no se editan (borrar + crear deja la intención clara).

## 6. Reglas de cálculo (módulo nuevo `src/finance/cash-position.ts`, puro)

**A · Neto real del mes `M`, por moneda `c`:**
`ingreso(c, M) − gastado(c, M)`
- `ingreso`: ocurrencias de ingresos activos en moneda `c` dentro de **todo** el mes
  (es fijo; en el mes en curso muestra "lo que va a quedar con lo gastado hasta hoy").
- `gastado`: suma de `contributions` del mes en `c`.
- Monedas mostradas: unión de monedas con ingreso o gasto en el mes.

**B · Saldo al día `T` (hoy), por moneda `c` con saldo inicial `(S, D)`:**
`S + Σ ingresos(c, D < fecha ≤ T) − Σ aportes(c, D < fecha ≤ T) + Σ ajustes(c, D < fecha ≤ T)`
- Se recorre mes a mes desde el mes de `D` hasta el de `T` llamando a
  `calculateActualMonth` (los pares nunca cruzan meses, así que es equivalente) y se
  filtra por fecha.
- Moneda sin saldo inicial → no hay saldo; la UI dice "cargá un saldo inicial".
- `T` = fecha de hoy con la misma convención que `currentMonthKey` / `dateOnly`
  (`src/finance/dates.ts`).

**Calidad del número.** Junto a A y B se muestran los contadores que ya existen
(avisos pendientes, ambiguos, omitidos) del período: B los suma desde `D`. Si alguno
es > 0 el número se marca como provisorio. Un aviso pendiente cuenta (regla vigente);
como el remitente todavía está en modo observación (MEJ-002), un mail falso bajaría
el saldo hasta que se descarte: el contador de pendientes es la señal para revisarlo.

## 7. UI

- **Dashboard (`app/page.tsx`):** bloque nuevo "Neto real y saldo", una fila por
  moneda: neto real del mes seleccionado, saldo hoy, y el chip de provisorio. El neto
  de plan y el trend existentes no cambian.
- **Página nueva `/balance`:** formulario de saldo inicial por moneda (monto, fecha);
  lista de ajustes del más reciente al más viejo con alta (moneda, monto con signo,
  fecha, nota) y borrado.
- Server actions en `src/actions/`, con el mismo control de acceso que las demás
  (`src/auth/access-policy.ts`). Los montos se parsean en el servidor con el
  `minorUnit` de la moneda y se rechazan si no son enteros seguros; errores con
  códigos fijos (`src/actions/error-codes.ts`, criterio de MEJ-007).

## 8. Pruebas (proporcionales: hay lógica de dinero no trivial)

- R1: los casos existentes de recurrencia + `listOccurrences` devuelve fechas cuya
  cantidad coincide con el conteo en cada frecuencia.
- R2: para los fixtures existentes de `actual-spending`, `Σ contributions == totals`
  por moneda; un par aporta la parte propia con la fecha bancaria.
- A: mes con ingreso UYU y gastos UYU+USD → neto USD negativo sin ingreso USD.
- B: saldo inicial a mitad de mes excluye gastos de ese mes hasta `D` inclusive;
  ingreso futuro del mes en curso no suma al saldo; ajuste negativo; moneda sin
  saldo inicial; descartar un aviso cambia el saldo (sin estado persistido).
- Repositorio: `migrate()` idempotente con las tablas nuevas; un único saldo inicial
  por moneda; monto no entero o moneda desconocida rechazados por la action.
- Lint, typecheck, suite y build en el servidor de build (procedimiento de `RUNBOOK`).
- Validación de entrada: fecha de saldo inicial o de ajuste posterior a hoy → rechazada.

## 9. Documentación a tocar (mismo cambio, `.md` y `.html` sincronizados)

`FINANCIAL-RULES` (R3 y reglas de A/B), `HANDOFF` (tablas y módulo nuevos),
`RUNBOOK` si cambia algún procedimiento (no se espera).

## 10. Queda a criterio del implementador

Nombres exactos de funciones y componentes, layout visual del bloque y de `/balance`,
orden de los commits. No puede cambiar: las reglas de §6, que `totals` se derive de
`contributions`, ni que no exista saldo persistido.
