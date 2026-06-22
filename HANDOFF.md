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

## Resume next — exact state as of 2026-06-22
Phase 3 is implemented on `feat/phase-2-3` but not merged. PR #15 is open and
mergeable; do not merge until its image job is green.

- The three verification jobs were green on the prior run. The image job was
  blocked by `CVE-2026-12151` (HIGH) in undici 6.25.0. Trivy located it under
  the global npm shipped by the `node:24-slim` base image, not in BudgetSpin's
  dependency tree.
- `.trivyignore-gate` accepts that finding until 2026-09-22. Evidence: the
  production command invokes `node`, never npm, and the repo uses no
  `WebSocket`/`WebSocketStream` client or `ws://`/`wss://` endpoint required by
  the advisory.
- The workflow loads the acceptance explicitly only in the blocking gate.
  SARIF and the Trivy JSON remain unfiltered, so GitHub code scanning and the
  manual DefectDojo import retain the accepted finding; the SBOM still lists
  the package.
- Next: confirm the new PR run makes the image job green, then merge. The merge
  performs the first GHCR publish from `main`. Afterwards, add the image job as
  a required check in branch protection.
- Still deferred: whether the gate should set `scanners: vuln` because gitleaks
  already covers source secret scanning.
