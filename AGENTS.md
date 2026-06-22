# AGENTS.md — how we work on BudgetSpin

Project-level instructions for any AI agent working in this repo. This file is
versioned and shared; it describes **how we collaborate**, not the roadmap
state (that lives in `DEPLOY-ROADMAP`). No personal data ever goes here — see
the PII rule below.

## What this project is

BudgetSpin is a **learning project**: production-grade deploy practices,
implemented incrementally, **one phase per session**, with the system left
working at the end of each. Stack: Next.js (App Router), React, SQLite via
`node:sqlite`, Tailwind, Vitest. Tooling is **OSS/free only** — no paid
services. The security perspective is integrated naturally into every step, not
bolted on as a separate section.

## How we collaborate

- **Explain before implementing.** Don't run things that haven't been
  understood yet. Walk through the concept, then act.
- **Security lens, always.** Each decision names where it touches supply chain,
  attack surface, least privilege, artifact integrity, or evidence — woven into
  the explanation, never a trailing "security section."
- **Concise and structured.** Tables and numbered lists over prose.
- **Options with trade-offs.** When a decision has alternatives, present them
  and recommend one.
- **Verify, don't assume.** Prefer reading the code / running a check over
  asserting from memory. Distinguish fact / interpretation / speculation.
- **Confirmation required before:** `git push`, opening PRs, and any
  destructive or outward-facing operation. Work happens on a feature branch,
  never directly on `main`.

## The documentation system

Four kinds of docs, each with a clear trigger. **Human-facing docs are authored
in rich HTML; each has a plain-markdown mirror for the agent to read.**

| Doc (HTML = human · MD = agent) | Holds | Added when |
|---|---|---|
| `DEPLOY-ROADMAP` | phase plan + current state | a phase opens/closes |
| `RUNBOOK` | operational commands & procedures | infra/process changes |
| `HANDOFF` | architecture & project state | context shifts |
| `BITACORA-OBSTACULOS` | resolved obstacles, written for study | an obstacle is solved |
| `DESTACADOS` | notable decisions/concepts to revisit | the user says **"destacar en html"** |
| `MEJORAS-APP` | deferred improvements backlog | an improvement is postponed to project close |

### The sync rule (critical)

The human reads HTML; the agent reads `.md`. **They must never diverge.**

- When content changes, update **both the `.html` and its `.md` in the same
  turn.** The HTML is canonical for presentation; the MD is the agent's
  source of truth for reading.
- On resuming work, if the two have drifted (e.g. the HTML was edited
  directly), **reconcile them before proceeding** — we cannot be reading
  different things.
- Roadmap **state** (which phase we're in) is derived from `DEPLOY-ROADMAP`,
  not duplicated here or re-derived from git/code.

### Conventions, disambiguated

- **"destacar en html"** → new entry in `DESTACADOS` (a concept/decision worth
  studying), structure: decision → why → counter-example → to-remember.
- **An obstacle we hit and fixed** → new entry in `BITACORA-OBSTACULOS`,
  structure: context → symptom → evidence → root cause → expected behavior →
  resolution → lesson.
- **A deferred improvement** → new entry in `MEJORAS-APP` (qué → por qué → cómo
  → alcance/riesgo → cuándo).

## PII rule — no personal data in the repo

Personal data **never** goes in any repo file (it's a public repo): no
employer, no role/identity tied to a person, no personal preferences, no
private server addresses (e.g. Tailscale IPs), no local absolute paths. That
context lives **outside** the repo (agent memory / user-global config). The
owner's GitHub username appearing in registry paths etc. is not treated as PII.
When writing docs, prefer placeholders (`<server>`, `<owner>`) over real
infrastructure identifiers.
