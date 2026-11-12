# Financial rules for imported activity

> Agent-readable mirror of `FINANCIAL-RULES.html`. Keep both in sync (see `CLAUDE.md`).
> Describes the "Observed spending" estimate on the dashboard, as implemented in
> `src/finance/actual-spending.ts` (`calculateActualMonth`) and wired in `app/page.tsx`.

**Status:** this logic was merged into main via PR 58 and deployed on 2026-11-10. Lint, typecheck, the test suite (126 tests) and the production build passed under Node 24 on 2026-11-10 at commit `b71b5de`; the logic has not been checked against real bank or Splitwise data. Everything below describes what the code says, not observed
results.

## 1. What observed spending is — and is not

- The recurring budget is a **projection**. Observed spending is a separate,
  **incomplete estimate** for one month. It is shown next to the plan and is
  never subtracted from it.
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

The HTML version draws this as two flowcharts. Text equivalent:

**One bank purchase** (already inside the included set of section 2):

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
2. Already paired with a bank purchase? → counted through that pair; nothing more.
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

## 4. Pairing conditions (all required)

| Condition | How the code checks it |
|---|---|
| Same day | the first ten characters of both stored timestamps are equal. The bank's is the e-mail `Date` header converted to UTC; Splitwise's is stored as the provider returns it |
| Same description | after Unicode NFKC normalisation, trimming, collapsing whitespace and lower-casing, both texts are identical and not empty |
| Same currency | identical ISO code |
| Same amount | the user's Splitwise paid share, converted to minor units, equals the bank amount and is > 0 |
| Not rejected | the pair is not in `import_pair_exclusions` |
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
| Possible matches | pairs where the owed share replaced the bank amount |
| Need a clear match | Splitwise expenses left out as ambiguous |
| Unavailable or unsupported | Splitwise expenses omitted because the amounts could not be used |

## 7. Reviewing pairs

Each pair is listed under "Review possible matches" with a **"Not the same
expense"** button, which stores a rejection in `import_pair_exclusions`
(keyed by bank transaction, Splitwise account and expense). Rejections persist
across Splitwise syncs and can be undone with **"Allow matching again"**
(the pair returns only if it still meets every condition). There is **no manual confirmation**
of a pair and no way to pair two records by hand: a pair only exists when the
automatic rule finds it.

## 8. Limitations (true in the current code)

- **Exact matching only.** A different spelling of the merchant, or a Splitwise
  date that falls on another day than the bank's UTC date (for example near
  midnight in local time), prevents a pair. Duplicate amounts, installments,
  partial payments and currency conversions are not inferred.
- **Month and day boundaries use the stored timestamps' text**, not local time.
  A purchase made late in the evening locally can land in the next UTC day or
  month.
- **No manual pair confirmation**, only rejection.
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
