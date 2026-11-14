# Neto real y saldo por moneda — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar por moneda (UYU, USD, sin conversión) el neto real del mes (ingreso fijo − gasto observado) y el saldo acumulado desde un saldo inicial, con ajustes manuales.

**Architecture:** Todo se calcula al leer, con funciones puras en `src/finance/` sobre filas listadas por el repositorio; no se persiste ningún saldo. La recurrencia pasa a producir fechas y el gasto observado expone cada aporte con su fecha, para que neto, saldo y plan-vs-gasto compartan una sola regla.

**Tech Stack:** Next.js App Router (server components + server actions), `node:sqlite` vía `src/db/repository.ts` (SQL en `migrate()`), Drizzle solo para tipos en `src/db/schema.ts`, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-14-neto-y-saldo-design.md`

## Global Constraints

- Montos siempre en enteros de unidades menores (`amountMinor`), por moneda; nunca se aplica tipo de cambio en estas vistas.
- Ningún saldo ni total derivado se guarda en la base.
- `totals` del gasto observado se deriva de `contributions`; no existe una segunda suma.
- Fecha de un aporte = primeros 10 caracteres del timestamp guardado (convención UTC de FINANCIAL-RULES §8). "Hoy" = `dateOnly(new Date())` (`src/finance/dates.ts`).
- Saldo: cuenta movimientos con `asOfDate < fecha ≤ hoy`. Neto del mes: ingreso de todo el mes − aportes del mes.
- Transferencias (`transfer_out`/`transfer_in`) no cuentan (FINANCIAL-RULES §2 sin cambios).
- Server actions nuevas: verifican `getCurrentSession()` y redirigen con códigos fijos de `FORM_ERROR_MESSAGES` (MEJ-007); nunca texto libre en la URL.
- Docs: cada `.md` tocado se actualiza junto con su `.html` en el mismo commit (CLAUDE.md, sync rule). Sin datos personales ni direcciones de servidor en el repo.
- **Checks:** no se instala nada en el Mac. Todos los comandos `npm`/`npx` corren en el servidor de build. Comando de sincronización y ejecución (definir `CHECK_HOST` en la shell, no en el repo):

  ```bash
  # desde el worktree; sube archivos versionados + nuevos sin ignorar, conserva node_modules remoto
  git ls-files -co --exclude-standard -z | tar --null -T - -czf - \
    | ssh "$CHECK_HOST" 'mkdir -p ~/budgetspin-neto-check && tar -xzf - -C ~/budgetspin-neto-check'
  ssh "$CHECK_HOST" 'cd ~/budgetspin-neto-check && mise exec node@24.22.2 -- <COMANDO>'
  ```
  La primera vez `<COMANDO>` = `npm ci`. En los pasos de abajo, "Run (server): X" significa este par de comandos con `<COMANDO>` = X.

## Review Focus

1. **Ingreso borrado reescribe el pasado:** `listIncomeItems()` devuelve solo activos; borrar un ingreso baja el saldo histórico. Se documenta en FINANCIAL-RULES y `/balance` indica "para terminar un ingreso, poné fecha de fin; no lo borres" (Task 5, Task 7). No hay test útil: es comportamiento de la fuente, no del cálculo.
2. **Compra el mismo día que el saldo inicial:** queda afuera (`fecha > asOfDate`). Test en Task 3.
3. **Moneda con ingreso pero sin saldo inicial, o saldo inicial sin ingreso:** la primera no tiene fila de saldo; la segunda sí (ingreso 0). Test en Task 3.
4. **Monto con más decimales que la moneda (`12.345` en UYU de 2 decimales):** se rechaza, no se trunca (el parser actual trunca). Test en Task 4.
5. **Par confirmado con fechas a ambos lados de `asOfDate`:** el aporte usa la fecha bancaria. Test en Task 2.

---

### Task 1: Recurrencia por fechas

**Files:**
- Modify: `src/finance/recurrence.ts`
- Test: `tests/recurrence.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type RecurrenceSchedule = {
    frequency: Frequency; customInterval?: number | null; customUnit?: CustomRecurrenceUnit | null;
    customAnchor?: CustomRecurrenceAnchor | null; customDayOfMonth?: number | null;
    customDayOfWeek?: number | null; startDate: string; endDate: string | null;
  };
  /** Fechas YYYY-MM-DD ascendentes dentro de [from, to] ∩ [startDate, endDate]. */
  export function listOccurrences(schedule: RecurrenceSchedule, from: string, to: string): string[];
  ```
  `countOccurrencesInMonth(input)` mantiene su firma y devuelve `listOccurrences(input, inicioMes, finMes).length`.

- [ ] **Step 1: Tests nuevos** (los existentes no se tocan):
  - `listOccurrences` mensual con start `2026-01-31`, rango `2026-01-01..2026-04-30` → `["2026-01-31","2026-02-28","2026-03-31","2026-04-30"]`.
  - semanal start `2026-11-02`, rango `2026-11-01..2026-11-30` → 5 fechas, la primera `2026-11-02`.
  - endDate `2026-11-15` corta: mensual start `2026-01-20` rango noviembre → `[]`; start `2026-01-10` → `["2026-11-10"]`.
  - custom `day_of_month` 15 cada 2 meses desde `2026-01-01`, rango `2026-01-01..2026-06-30` → `["2026-01-15","2026-03-15","2026-05-15"]`.
  - paridad: para cada fixture que ya usa `countOccurrencesInMonth`, `listOccurrences(...mes).length` es igual.
- [ ] **Step 2: Implementar.** Convertir cada helper `count*` en un `collect*` que devuelve `Date[]` acotado a `[rangeStart, rangeEnd]` (hoy reciben `monthStart/monthEnd`; renombrar a rango, la lógica ya sirve para rangos de varios meses). `countOccurrencesInMonth` delega. Sin código duplicado de conteo.
- [ ] **Step 3: Run (server):** `npx vitest run tests/recurrence.test.ts tests/repository.test.ts` → PASS.
- [ ] **Step 4: Commit** `refactor(finance): recurrence yields occurrence dates`.

### Task 2: El gasto observado expone sus aportes

**Files:**
- Modify: `src/finance/actual-spending.ts`
- Test: `tests/actual-spending.test.ts`, `tests/pair-suggestions.test.ts` (solo si algún `toEqual` del objeto completo rompe)

**Interfaces:**
- Produces:
  ```ts
  export type ActualContribution = { date: string; currency: string; amountMinor: number; source: "bank" | "splitwise"; refId: number };
  // ActualMonth gana: contributions: ActualContribution[]  (orden: fecha, luego source, luego refId)
  ```
  `totals` = suma de `contributions` por moneda, mismo orden que hoy. Firma de `calculateActualMonth` sin cambios.

- [ ] **Step 1: Tests:**
  - en todos los casos existentes de `calculateActualMonth`, `Σ contributions` por moneda `== totals` (helper en el test que lo verifique en cada `it`, o un `it` que recorra los fixtures).
  - compra sin par → `{ source: "bank", refId: b.id, amountMinor: b.amountMinor, date: day(b.txnDate) }`.
  - par automático y par manual → un aporte `source: "bank"`, `amountMinor` = parte propia, `date` = fecha bancaria aunque la de Splitwise sea el día siguiente (Review Focus 5).
  - gasto Splitwise no pagado sin parecido bancario → `source: "splitwise"`, `refId: s.id`, `date: day(s.date)`.
  - confirmación vencida → aporte bancario por el monto completo.
- [ ] **Step 2: Implementar.** `add(currency, amount)` pasa a `add({ ... })` que empuja a `contributions`; `totals` se calcula al final desde ahí.
- [ ] **Step 3: Run (server):** `npx vitest run tests/actual-spending.test.ts tests/pair-suggestions.test.ts tests/pair-confirmation-actions.test.ts tests/plan-vs-actual.test.ts` → PASS.
- [ ] **Step 4: Commit** `refactor(finance): observed spending exposes dated contributions`.

### Task 3: Cálculo de neto real y saldo

**Files:**
- Create: `src/finance/cash-position.ts`
- Test: `tests/cash-position.test.ts`

**Interfaces:**
- Consumes: `listOccurrences` (Task 1), `ActualMonth`/`ActualContribution` (Task 2), `IncomeItem` (repository), `addMonths`, `monthBounds`, `dateOnly` (dates.ts).
- Produces:
  ```ts
  export type OpeningBalance = { currencyCode: string; amountMinor: number; asOfDate: string };
  export type BalanceAdjustment = { id: number; currencyCode: string; amountMinor: number; adjustmentDate: string; note: string; createdAt: string };
  export type CurrencyNet = { currency: string; incomeMinor: number; spentMinor: number; netMinor: number };
  export type CurrencyBalance = { currency: string; asOfDate: string; openingMinor: number; incomeMinor: number;
    spentMinor: number; adjustmentsMinor: number; balanceMinor: number };
  export type DataQuality = { pending: number; ambiguous: number; omitted: number };
  type IncomeSchedule = RecurrenceSchedule & { currencyCode: string; amountMinor: number };

  export function monthlyNetByCurrency(month: string, incomes: IncomeSchedule[], actual: Pick<ActualMonth, "contributions">): CurrencyNet[];
  export function balanceByCurrency(input: { today: string; openings: OpeningBalance[]; incomes: IncomeSchedule[];
    adjustments: BalanceAdjustment[]; actualForMonth: (month: string) => ActualMonth }): { balances: CurrencyBalance[]; quality: DataQuality };
  ```
  Ambas listas ordenadas por código de moneda. `quality` suma los contadores de cada mes recorrido (desde el mes del `asOfDate` más antiguo hasta el de `today`); es conservador (puede contar avisos del primer mes anteriores al corte).

- [ ] **Step 1: Tests** (monedas `UYU`, `USD`; montos en minor):
  - neto: ingreso UYU 100000 mensual + aportes UYU 30000 y USD 5000 en `2026-11` → `[{USD, 0, 5000, -5000}, {UYU, 100000, 30000, 70000}]`.
  - neto del mes en curso usa el ingreso de todo el mes aunque su fecha sea posterior a hoy.
  - saldo: opening UYU 50000 al `2026-11-10`, ingreso UYU 100000 el día 1 y el 15, aportes UYU 1000 el `2026-11-10` y 2000 el `2026-11-11`, ajuste −500 el `2026-11-12`, today `2026-11-14` → income 100000, spent 2000, adjustments −500, balance 147500 (Review Focus 2: el aporte del día 10 no cuenta).
  - ingreso fechado después de today no suma.
  - ajuste fechado ≤ asOfDate no suma.
  - moneda con ingreso pero sin opening → sin fila; opening USD sin ingresos → fila con income 0 (Review Focus 3).
  - recorre varios meses: opening `2026-09-20`, today `2026-11-14` llama `actualForMonth` con `2026-09`, `2026-10`, `2026-11` exactamente.
  - `asOfDate > today` → balance = opening, sin movimientos.
- [ ] **Step 2: Implementar** las dos funciones puras.
- [ ] **Step 3: Run (server):** `npx vitest run tests/cash-position.test.ts` → PASS.
- [ ] **Step 4: Commit** `feat(finance): real monthly net and running balance per currency`.

### Task 4: Persistencia de saldo inicial y ajustes

**Files:**
- Modify: `src/db/repository.ts` (SQL en `migrate()`, funciones nuevas), `src/db/schema.ts`, `src/finance/money.ts`, `src/actions/error-codes.ts`
- Test: `tests/repository.test.ts`, `tests/money.test.ts`, `tests/error-codes.test.ts` (si enumera códigos)

**Interfaces:**
- Consumes: tipos `OpeningBalance`, `BalanceAdjustment` (Task 3).
- Produces:
  ```ts
  // repository.ts
  export function listOpeningBalances(): OpeningBalance[];
  export function setOpeningBalance(input: OpeningBalance): void;         // upsert por (user, moneda)
  export function clearOpeningBalance(currencyCode: string): void;
  export function listBalanceAdjustments(): BalanceAdjustment[];          // adjustmentDate desc, id desc
  export function addBalanceAdjustment(input: Omit<BalanceAdjustment, "id" | "createdAt">): number;
  export function deleteBalanceAdjustment(id: number): void;
  // money.ts
  /** Acepta "-" inicial; rechaza decimales distintos de 0 más allá de minorUnit y resultados no enteros seguros. */
  export function parseSignedMoneyToMinor(value: string, minorUnit: number): number;
  // error-codes.ts, nuevas entradas de FORM_ERROR_MESSAGES:
  "invalid-signed-amount": "Enter a decimal amount. Use a leading minus for money out.",
  "invalid-date": "Enter a valid date that is not in the future."
  ```
  SQL exactamente como el spec §5, más `CHECK (amount_minor <> 0)` en `balance_adjustments`. Todas las funciones filtran por `LOCAL_USER_ID` como el resto del repositorio. Errores de validación de `parseSignedMoneyToMinor` → `FormError("invalid-signed-amount")`.

- [ ] **Step 1: Tests:**
  - `migrate()` dos veces seguidas no falla y las tablas existen.
  - `setOpeningBalance` dos veces para UYU deja una fila con los últimos valores; `clearOpeningBalance` la elimina.
  - `addBalanceAdjustment` con monto 0 lanza (CHECK); moneda inexistente lanza (FK).
  - orden de `listBalanceAdjustments`; `deleteBalanceAdjustment` borra solo ese id.
  - `parseSignedMoneyToMinor`: `"-12.5"`,2 → −1250; `"12.50"`,2 → 1250; `"12.345"`,2 → lanza; `"12.340"`,2 → 1234; `"1500.00"`,0 → 1500; `"abc"`, `""`, `"--1"` → lanzan; `"99999999999999999"`,2 → lanza.
- [ ] **Step 2: Implementar.**
- [ ] **Step 3: Run (server):** `npx vitest run tests/repository.test.ts tests/money.test.ts tests/error-codes.test.ts` → PASS.
- [ ] **Step 4: Commit** `feat(db): opening balances and balance adjustments`.

### Task 5: Página `/balance` y sus actions

**Files:**
- Create: `src/actions/balance.ts`, `app/balance/page.tsx`
- Modify: `app/components/nav-config.ts` (entrada `{ href: "/balance", label: "Balance", icon: <uno existente> }`)
- Test: `tests/balance-actions.test.ts` (mismo esquema de mocks que `tests/pair-confirmation-actions.test.ts`)

**Interfaces:**
- Consumes: Task 4.
- Produces (todas `"use server"`, `(form: FormData) => Promise<void>`, redirigen a `/balance` o `/balance?error=<code>`; sin sesión → `/login`):
  `saveOpeningBalanceAction` (campos `currencyCode`, `amount`, `asOfDate`), `clearOpeningBalanceAction` (`currencyCode`), `addBalanceAdjustmentAction` (`currencyCode`, `amount`, `adjustmentDate`, `note`), `deleteBalanceAdjustmentAction` (`id`).
  Validación: moneda en `listCurrencies()` si no `unknown-currency`; fecha `YYYY-MM-DD` real y `≤ dateOnly(new Date())` si no `invalid-date`; nota no vacía si no `missing-field`; monto de ajuste ≠ 0 si no `invalid-signed-amount`.

- [ ] **Step 1: Tests:** sin sesión → redirect `/login` y nada escrito; fecha futura → `/balance?error=invalid-date`; moneda `XXX` → `unknown-currency`; `12.345` UYU → `invalid-signed-amount`; ajuste sin nota → `missing-field`; caso feliz escribe y redirige a `/balance`.
- [ ] **Step 2: Implementar actions y página.** Página: un formulario por moneda configurada (monto, fecha, guardar/quitar) mostrando el saldo inicial actual; formulario de ajuste; lista de ajustes con botón borrar; error vía `formErrorMessage(params.error)`; texto fijo: "To stop an income, set its end date instead of deleting it: deleting removes it from past balances." `export const dynamic = "force-dynamic"`.
- [ ] **Step 3: Run (server):** `npx vitest run tests/balance-actions.test.ts && npm run typecheck` → PASS.
- [ ] **Step 4: Commit** `feat(balance): manage opening balances and adjustments`.

### Task 6: Bloque en el dashboard

**Files:**
- Modify: `app/page.tsx`, `app/globals.css` (solo si hace falta estilo)

**Interfaces:**
- Consumes: `monthlyNetByCurrency`, `balanceByCurrency` (Task 3), `listOpeningBalances`, `listBalanceAdjustments` (Task 4). `actualForMonth` = closure sobre `transactions`, `shared`, `minorUnits`, `exclusions`, `confirmations` que ya existen en la página.

- [ ] **Step 1: Implementar** sección `id="real-net"` entre "Projected net" y la comparación plan-vs-gasto: tabla `Currency | Income | Spent | Net this month | Balance today`, una fila por moneda presente en neto o saldo; "Balance today" muestra "Set an opening balance" con link a `/balance` cuando falta. Chip "Provisional" con el total de `quality` cuando es > 0. Montos con `showAmount` existente (moneda nativa, sin conversión).
- [ ] **Step 2: Run (server):** `npm run lint && npm run typecheck` → PASS.
- [ ] **Step 3: Verificación manual (server, preview de dev con una copia de la base):** saldo inicial UYU cargado → aparece; descartar un aviso en `/transactions` → el saldo cambia sin otra acción.
- [ ] **Step 4: Commit** `feat(dashboard): real net and balance per currency`.

### Task 7: Documentación

**Files:**
- Modify: `FINANCIAL-RULES.md` + `FINANCIAL-RULES.html`, `HANDOFF.md` + `HANDOFF.html`

- [ ] **Step 1:** FINANCIAL-RULES: §1 aclara que el ingreso fijo sí se combina con lo observado (gastos planificados siguen sin mezclarse); sección nueva "Real net and balance" con las fórmulas del spec §6, la regla `fecha > asOfDate`, el indicador provisorio y las limitaciones (ingreso borrado reescribe el pasado; aviso pendiente falso baja el saldo hasta descartarse; transferencias no cuentan). Mismo contenido en el `.html` (con el diagrama/estilo del documento existente).
- [ ] **Step 2:** HANDOFF: tablas `opening_balances`, `balance_adjustments`, módulo `cash-position.ts`, página `/balance`. `.md` y `.html`.
- [ ] **Step 3:** `grep -nE "/Users/|100\.[0-9]+\.|@gmail" FINANCIAL-RULES.* HANDOFF.*` → sin resultados.
- [ ] **Step 4: Commit** `docs: real net and balance rules`.

### Task 8: Verificación completa

- [ ] **Step 1: Run (server):** `npm run lint && npm run typecheck && npm test && npm run build` → todo PASS; anotar cantidad de tests.
- [ ] **Step 2:** actualizar el objetivo en Projects Dashboard a `review` con la evidencia; sin push ni PR hasta confirmación del dueño.
