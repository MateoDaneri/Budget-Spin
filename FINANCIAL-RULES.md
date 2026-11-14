# Financial rules for imported activity

> Agent-readable mirror of `FINANCIAL-RULES.html`. Keep both in sync (see `CLAUDE.md`).
> Describes the "Observed spending" estimate on the dashboard, as implemented in
> `src/finance/actual-spending.ts` (`calculateActualMonth`) and wired in `app/page.tsx`.

**Status:** this logic was merged into main via PR 58 and deployed on 2026-11-10. Lint, typecheck, the test suite (126 tests) and the production build passed under Node 24 on 2026-11-10 at commit `b71b5de`; the logic has not been checked against real bank or Splitwise data. Everything below describes what the code says, not observed
results. Suggestions and manual confirmation (section 7) were added by PR 66;
lint, typecheck, 188 tests and the build passed on the server on 2026-11-11.
The real net and the running balance (section 9) are on branch
`claude/feature-neto-y-saldo`, not merged or deployed yet.

## 1. What observed spending is — and is not

- The recurring budget is a **projection**. Observed spending is a separate,
  **incomplete estimate** for one month. It is shown next to the planned
  expenses and is never subtracted from them. The only place where planned
  and observed figures meet is section 9: the fixed **income** minus observed
  spending.
- It is not a bank statement and not a cash balance. An e-mail notice does not
  prove that a payment settled, and the rules below do not check whether a
  notice is authentic.
- Totals are kept **per original currency**. No exchange rate is applied or
  invented.
- Meaning of each amount: a bank purchase is cash that left the account; a
  Splitwise *paid share* is what the user fronted; an *owed share* is the
  user's own consumption. A settlement between people changes a debt, not the
  expense, so it is never counted again as spending.
- Splitwise balances are shown as the provider returns them; their sign has not
  been independently established and they do not enter the estimate.

## 2. Which records enter the calculation

Both sources are filtered to the selected month by the **first seven
characters** (`YYYY-MM`) of the stored timestamp.

| Source | Included | Excluded before any matching |
|---|---|---|
| Bank notices (`transactions`) | `kind = purchase`, amount > 0, status `pending` or `confirmed` | transfers (`transfer_out`/`transfer_in`), notices reviewed as `discarded`, zero amounts |
| Splitwise (`splitwise_imports`, current account only) | expenses that are not payments and not deleted | payments (settlements) and deleted records |

**Pending notices count.** A bank notice is imported as `pending` and is
included until someone discards it on `/transactions`.

## 3. Decision flow (conceptual diagram, not measured data)

The HTML version draws this as two flowcharts. They show the automatic rule;
pairs confirmed by hand (section 7) are applied before it, and their two
records skip these flows. Text equivalent:

**One bank purchase** (already inside the included set of section 2):

0. Is it in a pair confirmed by hand (section 7)?
   - Yes, amounts still valid → **paired**: count the **owed share**.
   - Yes, amounts no longer valid → count the **full bank amount** and count
     the pair as omitted.
   - Either way the automatic rule is skipped.
1. Is there **exactly one** Splitwise expense that meets every pairing
   condition of section 4, and the pair has not been rejected?
   - No → count the **full bank amount**.
2. Are the candidate's shares usable — owed share and total convertible,
   owed ≤ total, bank amount ≤ total — and does that Splitwise expense match
   **only this** bank purchase?
   - No → count the **full bank amount**.
   - Yes → **paired**: count the user's **owed share** instead of the bank
     amount (in the bank purchase's currency).

**One Splitwise expense:**

1. Payment (settlement) or deleted? → **never an expense** (dropped in section 2).
2. Already paired with a bank purchase (automatic or by hand)? → counted
   through that pair; nothing more. In a confirmed pair that is no longer
   valid → **omitted**.
3. Are the amounts usable? The user's paid share, owed share and total must all
   convert to the currency's minor unit (section 5), with owed ≤ total and
   paid ≤ total. If the user does not participate, the shares are empty and
   the expense fails here.
   - No → **omitted** (counted in the "unavailable or unsupported" figure).
4. Did the user pay **nothing**, and is there **no** bank purchase with the
   same date prefix, same normalised description and same currency (amount is
   not compared here)?
   - Yes → count the user's **owed share**.
5. Otherwise, if the user paid or owes anything → **ambiguous, left out**
   (counted in the "need a clear match" figure). If both shares are zero,
   nothing is counted or flagged.

Consequences worth knowing:

- An unpaired Splitwise expense that the user paid is left out as ambiguous,
  because the same money may already be in a bank purchase.
- When a pair is rejected, the bank purchase goes back to its full amount and
  the Splitwise expense (whose paid share is > 0) becomes ambiguous.
- If two bank purchases fit the same Splitwise expense, neither pairs: both
  count at full amount and the Splitwise expense becomes ambiguous.
- A pair confirmed by hand wins over the automatic rule. If the bank purchase
  had an automatic candidate, that Splitwise expense is left unpaired and, if
  the user paid part of it, becomes ambiguous.

## 4. Pairing conditions (all required)

| Condition | How the code checks it |
|---|---|
| Same day | the first ten characters of both stored timestamps are equal. The bank's is the e-mail `Date` header converted to UTC; Splitwise's is stored as the provider returns it |
| Same description | after Unicode NFKC normalisation, trimming, collapsing whitespace and lower-casing, both texts are identical and not empty |
| Same currency | identical ISO code |
| Same amount | the user's Splitwise paid share, converted to minor units, equals the bank amount and is > 0 |
| Not rejected | the pair is not in `import_pair_exclusions` |
| Not paired by hand | neither record is in a pair confirmed by hand (`import_pair_confirmations`) |
| Unique on both sides | one candidate for the bank purchase, and that candidate fits only one bank purchase |

## 5. Converting Splitwise amounts

Splitwise amounts are decimal strings. They are converted to integer minor
units using the **minor unit configured for that currency** in the
`currencies` table — the same scale the bank amounts use — without
floating-point arithmetic.

- A currency that is not configured, or whose minor unit is outside 0–6,
  cannot be converted.
- Digits beyond the currency's minor unit are accepted only when they are
  zeros (`1500.00` in a 0-decimal currency). Anything finer is **not rounded**:
  the value is treated as unusable and the expense is omitted.
- Negative values (including refunds) are not converted and are omitted.

## 6. What the dashboard shows

| Figure | Meaning |
|---|---|
| Totals per currency | sum of full bank amounts, paired owed shares and unpaid owed shares |
| Pending bank notices | included purchases still in `pending` status |
| Possible matches | pairs where the owed share replaced the bank amount, automatic or confirmed by hand |
| Suggested | near matches waiting for a decision; they do not change any total |
| Need a clear match | Splitwise expenses left out as ambiguous |
| Unavailable or unsupported | Splitwise expenses omitted because the amounts could not be used, plus confirmed pairs that are no longer valid |

## 7. Reviewing pairs

"Review matches" on the dashboard has three short lists. It opens by itself
when there is a suggestion.

| List | Buttons | Effect on totals |
|---|---|---|
| Suggested | **"Same expense"** stores a manual pair; **"Not the same"** stores a rejection | none while suggested |
| Confirmed | **"Undo"** removes the manual pair | owed share replaces the bank amount; "Not applied" when the pair is no longer valid |
| Matched | **"Not the same expense"** on automatic pairs; **"Allow matching again"** on rejected ones | automatic pairs count the owed share |

### When a pair is suggested (all required)

- Both records are in the month's included set (section 2) and the automatic
  rule did not pair them.
- Same currency, and the user's paid share equals the bank amount and is
  above zero.
- The date prefixes (first ten characters of the stored timestamps) are at most **one day** apart. The description is not
  compared.
- Neither record is in an automatic or manual pair, and this pair is not
  rejected.
- The shares are usable (owed ≤ total, bank amount ≤ total).
- **Unique on both sides:** the bank purchase has exactly one such candidate
  and that expense has exactly one such bank purchase. Otherwise nothing is
  suggested.

### Manual confirmation

- Stored in `import_pair_confirmations` (bank transaction, Splitwise account,
  expense), kept across Splitwise syncs and deleted with the bank transaction.
- The server re-reads both records before saving: both must exist, the
  expense must belong to the current Splitwise account, both must be in the
  selected month, in the same currency, at most one day apart, with paid share
  equal to the bank amount and usable shares. Amounts are never taken from the
  form.
- A bank purchase or a Splitwise expense can be in **at most one** confirmed
  pair; a second confirmation for either side is refused.
- Confirmation and rejection of the same pair exclude each other: confirming
  removes the rejection, and rejecting removes the confirmation.
- A confirmed pair counts exactly like an automatic one (owed share instead of
  the bank amount) and takes priority over the automatic rule. It is
  re-checked on every calculation: if the paid share no longer equals the bank
  amount, the shares are no longer usable, or one record left the month, it is
  **not applied**, the bank purchase counts in full and the pair is counted as
  omitted.
- "Undo" returns both records to the automatic rule and to suggestions.

Bank notices are reviewed separately on `/transactions` (confirm or discard).

## 8. Limitations (true in the current code)

- **The automatic rule is exact.** A different spelling of the merchant, or a
  Splitwise date on another day than the bank's UTC date (for example near
  midnight in local time), prevents an automatic pair; such cases appear only
  as suggestions, and only when unique and at most one day apart. Duplicate
  amounts, installments, partial payments and currency conversions are not
  inferred.
- **Month and day boundaries use the stored timestamps' text**, not local time.
  A purchase made late in the evening locally can land in the next UTC day or
  month. Suggestions never cross a month boundary.
- **A manual confirmation is trusted.** Suggestions ignore the description, so
  a wrong "Same expense" replaces the bank amount with the owed share and
  **underestimates** spending until it is undone.
- **Totals are an estimate.** They can be incomplete and need review whenever
  ambiguous or omitted counts are non-zero.
- **Amounts finer than the currency's minor unit are omitted**, not rounded.
- **Pending imports are counted.** A notice that was never reviewed — including
  one that is not genuine — is in the total until discarded. Bank e-mails are
  accepted by sender address and subject only; there is no sender
  authentication (see `HANDOFF`).
- Categories (saved per normalised description and editable on the source
  screens) never change the monetary calculation.
- A changed or deleted Splitwise record is recalculated after the next
  successful snapshot; records missing from a provider response are kept, not
  assumed deleted.
- **Deleting an income rewrites past balances.** Only active incomes are
  listed, so a deleted income disappears from every month, including those
  already in the running balance. End an income with an end date instead.
- **A false pending notice lowers the balance** until it is discarded on
  `/transactions`, because pending notices count (section 2) and the sender
  check is in observation mode. The "provisional" count is the cue to review.
- **Transfers do not count** in the net or the balance. Money sent by bank
  transfer must be entered as an adjustment until bill payments are modelled.

## 9. Real net and balance

Implemented in `src/finance/cash-position.ts` (pure functions) and shown in
the "Real net and balance" block of the dashboard. Nothing is stored: both
figures are recomputed from their sources on every page load, so discarding a
notice or confirming a pair changes them immediately.

Both use the observed spending of this document **per original currency**,
with no exchange rate. Each counted amount carries a date: the bank date for a
purchase or a pair, the Splitwise date for an unpaid shared expense (the first
ten characters of the stored timestamp, as in section 8).

| Figure | Formula | Window |
|---|---|---|
| Net this month | fixed income of the month − observed spending of the month | the whole selected month; income dated later in the current month counts (it is fixed) |
| Balance today | opening balance + income − observed spending + adjustments | after the opening date, up to and including today (UTC date) |

- **Opening balance:** one per currency, set on `/balance` with an amount
  (negative allowed) and a date. It is the amount at the **end** of that day,
  so movements on the opening date itself are not counted again. A currency
  without an opening balance shows no balance. An opening date after today
  shows the opening amount unchanged.
- **Income:** the configured incomes (`/income`), each counted on the dates its
  recurrence produces. It is not confirmed by any notice.
- **Adjustments:** signed amounts with a mandatory note, for anything the
  notices miss (cash, other banks, transfers, refunds). They can be added or
  deleted, not edited.
- **Provisional:** the net shows the month's pending, ambiguous and omitted
  counts; the balance shows the same counts summed over every month since the
  earliest opening date (the first month may include notices dated before the
  opening date, so it errs towards flagging).
- **Input checks** (server side): known currency; a real date not after today;
  amounts with at most the currency's decimals (extra non-zero digits are
  rejected, not truncated); adjustments different from zero.

