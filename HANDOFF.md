# BudgetSpin — Handoff

> Agent-readable mirror of `HANDOFF.html`. Keep both in sync (see `CLAUDE.md`).
> Architecture, current state, and operational context. Roadmap **state** is the
> source of truth in `DEPLOY-ROADMAP` — don't re-derive from code/git.

## Where the project is
Goal: from a local-only Docker app to a self-hosted production app on a personal
server over Tailscale, behind Traefik. One phase per session.

**Phase 2 done · Phase 3 next (3/9).** Phases 0–2 complete: base hygiene, CI
gates, reproducible hardened image. Next: build & publish the image in CI with
scanning as a gate.

| Aspect | Today |
|---|---|
| Development | Mac + Docker Compose (`docker-compose.yml`) |
| Delivery | Git + SSH over Tailscale (server-side build; CD is Phase 4) |
| Production | Traefik + non-root Next.js container (`docker-compose.prod.yml`) |
| State | SQLite in a persistent Docker volume |

## Runtime architecture (as of Phase 2)
- **Image:** multi-stage Dockerfile. Builder runs `npm ci` + `next build`; final
  stage carries only the Next `standalone` output + `.next/static` + `public` +
  an esbuild-bundled `migrate.mjs`. No devDeps, no toolchain, no `src/`. Base
  `node:24-slim` pinned by digest.
- **Least privilege:** runs as `USER node` (uid 1000); code is root-owned
  read-only, only `/app/data` is writable.
- **Startup:** `node migrate.mjs && node server.js` (no npm at runtime). The prod
  compose wraps it with a guard that aborts if `BUDGETSPIN_AUTH_SECRET` is unset.
- **Routing:** Traefik labels on the app service; private hostname
  `budget-spin.ts.local` over Tailscale; no host port published.
- **Data:** SQLite at `/app/data/budgetspin.sqlite` in volume
  `budgetspin-prod-data`; created/seeded by `migrate()` on first start; persists
  across deploys. The image contains **no** database (see bitácora OBS-008).
- **Result:** image 1.75 GB → 421 MB (−76%), non-root, reproducible. Verified:
  `whoami` = node, `migrate.mjs` runs standalone, `GET /login` 200.

## App capabilities
**Auth:** single local user `mdaneri` (legacy local-user data migrates to it);
first login initializes the password (hash + salt); session as signed HTTP-only
cookie; credential comparison via `timingSafeEqual` (`src/auth/session.ts`);
routes protected by `proxy.ts`; logout in header. 2FA modeled but **not enforced
yet**.

**Finance:** recurring income (incl. custom recurrences, e.g. aguinaldo) and
recurring expenses (committed vs optional, custom recurrences); expense
categories and families/groups; dashboard (income, committed/optional spend,
net, category & family breakdown, six-month projection); plans with target
date/amount/currency, sub-purchases/checklist, calculation detail; currency
amounts display in source currency and cycle on click, FX stored per record with
automatic lookup in forms.

## Data ownership & volumes
| Location | Volume / file | Role |
|---|---|---|
| Mac, original dev | `budgetspin_budgetspin-data` | Historical records |
| Mac, renamed project | `budgetspin-dev_budgetspin-data` | May be seed-only |
| Server, production | `budgetspin-prod-data` | Production database |

Backups and the dev→prod promotion procedure live in `RUNBOOK`. The database is
the one thing that can't be rebuilt — back up before destructive operations.

## Known constraints & security notes
- Private self-hosting over Tailscale, not public exposure. Still use a strong,
  stable `BUDGETSPIN_AUTH_SECRET` (changing it invalidates sessions) and a strong
  password.
- Never commit `.env.production`. No secrets or personal data in the repo (it is
  public) — see the PII rule in `CLAUDE.md`.
- Single instance behind Traefik; migrate-on-start is fine for one replica.
  Multi-instance would need migrations as a separate step (Phase 6).
- If ever exposed beyond Tailscale: add HTTPS, stricter headers, 2FA (future).
- **Open improvement:** migration is hand-written idempotent SQL; `schema.ts`
  (Drizzle) is declared but disconnected from it. Drizzle Kit versioned
  migrations tracked as MEJ-001 (deferred to project close).

## Resume next — exact state as of 2026-06-23
Phase 3 PR #15 **merged** 2026-06-22 (the undici `CVE-2026-12151` risk
acceptance in `.trivyignore-gate` unblocked the gate; SARIF/JSON reporting
stayed unfiltered, evidence still visible). First-ever GHCR publish happened —
private package, tagged by SHA. CI on `main` is green end to end.

**Live issue on `main` right now:** a Dependabot PR (#18) bumped the
Dockerfile's base image `node:24-slim → node:26-slim` and got merged without
review catching that Node 26 is Current, not LTS (verified against
endoflife.date: `isLts: false`, `ltsFrom: 2026-10-28`) — the same mistake
explicitly rejected for Node 25 earlier in the project. **`main` is building
production images on a non-LTS Node right now.** The fix is ready but not yet
merged — see below.

- **Branch `chore/node-lts-discipline` (2 commits, pushed, no PR opened yet):**
  reverts the Dockerfile to `node:24-slim` (freshly re-pulled digest — the old
  digest had gone stale); adds an `ignore` rule (`update-types:
  semver-major`) for the `node` dependency in the `docker` ecosystem of
  `dependabot.yml`, mirroring the manual-review discipline already used for
  npm majors (ESLint 10, TypeScript 6) but structurally this time; adds two
  new scheduled workflows: `node-lts-watch.yml` (monthly, queries
  endoflife.date, opens a tracking issue the day the watched major reaches
  LTS) and `repo-activity-watch.yml` (weekly, opens a tracking issue if no
  commit/PR/issue activity in ≥45 days — proactive, because GitHub
  auto-disables scheduled workflows after 60 days of inactivity and a cron
  run itself does not count as activity).
- **Next action:** open the PR for `chore/node-lts-discipline` against `main`,
  confirm CI green (image job rebuilds on node:24-slim, gate should pass —
  same undici acceptance still applies), then merge.
- **Separately open, NOT part of this branch:** Dependabot PR #20 bumps
  `@types/node` 24.12.4 → 26.0.0 — same Current-vs-LTS class of mistake on the
  npm side. Mateo is closing it manually.
- **Still pending from Phase 3 (not done):** the `image` job is **not yet** a
  required check in branch protection — only the original 3 verification jobs
  are required. Add it once confident in its stability (it can only be added
  after it has run at least once, which it now has).
- **Still deferred, undecided:** whether to add `scanners: vuln` to the gate
  step to exclude Trivy's secret scanning from the image gate (gitleaks
  already covers secrets at the source) — raised mid-Phase-3, never applied.
