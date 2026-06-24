# BudgetSpin — Deploy Roadmap

> Agent-readable mirror of `DEPLOY-ROADMAP.html`. Keep both in sync (see the
> sync rule in `CLAUDE.md`). From "SSH and pray" to a real production pipeline,
> incrementally, OSS/free only, one phase per session, security integrated.

**Progress: 4 / 9 phases (44%).** Started 2026-06-09.

Legend: ✅ done · ▶ next · ◻ pending · ◌ future (not yet detailed).

## ✅ Phase 0 — Base hygiene · done 2026-06-09
*Sensitive data never travels with the code · main as source of truth.*

- `.gitignore` widened: `*.sqlite`/`-shm`/`-wal` at any path (not just `data/`),
  so root exports with financial data are uncommittable.
- Created `DEPLOY-ROADMAP.html` as the permanent tracker.
- `main` clean and pushed.
- **Security:** what enters git history is compromised forever (clones, reflogs,
  caches). The right control is preventive, not corrective; gitleaks (Phase 1)
  is the second line.

## ✅ Phase 1 — CI: verification on every push · done 2026-06-11
*Mechanical gates, not discipline · change audit trail.*

- `.github/workflows/ci.yml`: `npm ci` → typecheck → vitest → `next build`, on
  every push/PR to `main`.
- gitleaks (secret scan) + osv-scanner (deps vs OSV) on every push.
- `engines` in `package.json` + `.nvmrc` (Node 24 LTS): same Node on Mac, CI,
  Docker.
- Branch protection on `main`: CI check becomes required.
- **Extras:** real ESLint + eslint-plugin-security with documented triage ·
  Actions pinned by commit SHA · Dependabot (daily, grouped to avoid serial
  lockfile conflicts) · repo made **public** (protection on private needed a
  paid plan) · ruleset `protect-main` with no bypass (PR + 3 checks + strict
  up-to-date) · inverse test: PR #11 with a broken test → merge blocked.
- **Security:** a control that depends on a human remembering to run it is not a
  control. Secrets and vulnerable deps scanned on every push, no exception.
- Tools: GitHub Actions, gitleaks, osv-scanner. Files: `ci.yml`,
  `package.json`, `.nvmrc`.
- **Follow-up identified 2026-06-23 · pending:** two native GitHub features
  left unenabled, complementing (not replacing) the above — free on a public
  repo, pure Settings toggle, no workflow changes. **Dependabot Malware
  alerts** (packages *confirmed* malicious — typosquats, compromised
  maintainer accounts — distinct from osv-scanner, which only matches
  already-reported CVEs) and **native Secret scanning + push protection**
  (provider-validated patterns, and can block the push before a secret ever
  enters history — gitleaks in CI only warns after the fact). Fits here
  because it's the same family as gitleaks/osv-scanner (Phase 1 gates), not
  image-related (Phase 3). No dependency on any future phase — can be
  enabled whenever, via Settings → Code security.

## ✅ Phase 2 — Reproducible & hardened image · done 2026-06-15
*Attack surface · reproducibility · least privilege at runtime.*

- `next.config.ts`: `output: "standalone"` (traced runtime: 319 → 12 packages).
- Multi-stage Dockerfile: builder with `npm ci`; final stage only standalone +
  static + public + `migrate.mjs` (no devDeps, no toolchain, no `src/`).
- Base **Node 24 slim pinned by digest** (`sha256:2c87…`) instead of the
  floating `node:25-slim` tag.
- `USER node` (uid 1000): no longer root; code stays root-owned read-only, only
  `data/` is writable.
- `db:migrate` without devDependencies: `migrate.ts` bundled with **esbuild**
  into a self-contained `migrate.mjs`.
- Deploy unchanged: server still does `build:` — zero conflict.
- **Extras:** detected that the standalone trace leaked the **dev sqlite** into
  the artifact → two-layer fix (`outputFileTracingExcludes` + `rm` in the
  builder, defense in depth) · `docker-compose.prod.yml` CMD →
  `node migrate.mjs && node server.js` (no npm at runtime) · `docker` ecosystem
  added to Dependabot (digest pin needs patch alerts) · `ENV HOSTNAME=0.0.0.0`
  to preserve the standalone `server.js` binding.
- **Security:** single-stage as root with full toolchain = max attack surface;
  multi-stage non-root with pinned base = min. `npm ci` + digest pin = artifact
  integrity.
- Tools: Docker multi-stage, esbuild. Files: `Dockerfile`, `next.config.ts`,
  `docker-compose.prod.yml`, `dependabot.yml`.
- **Verified:** image 1.75 GB → 421 MB (−76%) · `whoami` = node (uid 1000) ·
  `migrate.mjs` runs standalone · GET `/login` 200.

## ✅ Phase 3 — Build & publish in CI · done 2026-06-22
*Build-once · immutable artifact · scanning as a gate.*

- CI builds the image after tests (buildx + Actions cache).
- Immutable tags: `ghcr.io/mateodaneri/budget-spin:sha-<short>` + `:latest`.
- **Trivy** scans the image BEFORE push — gate on CRITICAL/HIGH (`ignore-unfixed`,
  with explicit risk acceptances via `.trivyignore-gate`, justified and expiring).
- **syft** generates SBOM (SPDX JSON) as a run artifact.
- Reporting decoupled from the gate: SARIF → GitHub code scanning (Security
  tab) and Trivy JSON → artifact for DefectDojo import — neither filters the
  risk acceptances, so accepted risk stays visible.
- Push to GHCR (**private** package) with `GITHUB_TOKEN` (`packages: write`,
  scoped to the job) — main only, never from a PR.
- Server untouched: images wait "on hold" in the registry.
- **Extras:** caught that Dependabot had merged a base-image major bump alone
  (`node:24-slim → node:26-slim`, Node 26 was *Current*, not LTS — PR #18)
  because the `docker` ecosystem had no major-version guard, unlike npm →
  reverted + structural `ignore` by `update-types` in `dependabot.yml` ·
  **2 new watch workflows**: `node-lts-watch.yml` (queries the endoflife.date
  API, opens an issue the day the next major reaches LTS) and
  `repo-activity-watch.yml` (warns before GitHub auto-disables scheduled
  workflows after 60 days of inactivity — verified that a cron run itself
  doesn't count as activity).
- **Security:** the image that passed tests and scan is bit-for-bit what runs in
  prod. SBOM = knowing what's inside when the next dependency CVE drops. An
  image scanned clean today can fail the gate tomorrow with no code change —
  the world discovers new CVEs against binaries you never touched (happened
  twice this phase: esbuild, then undici).
- Tools: GHCR, Trivy, syft, buildx, code scanning. Files: `ci.yml`,
  `.trivyignore-gate`, `dependabot.yml`, `node-lts-watch.yml`,
  `repo-activity-watch.yml`.
- **Verified:** image visible in GHCR (private) tagged by SHA · Trivy gate green
  on the `main` run · SBOM and JSON downloadable as artifacts · Security tab
  populated with SARIF.

## ▶ Phase 4 — CD: CI triggers the deploy · next
*Human access ≠ machine access · blast radius per credential.*

- Server: dedicated `deploy` user + restricted SSH key in `authorized_keys`
  with `command="/opt/budgetspin/deploy.sh"`, `no-pty`, `no-port-forwarding`.
- Fine-grained PAT **read:packages only** on the server for
  `docker login ghcr.io` (read images only).
- Server-side `deploy.sh`: pull by tag → `up -d` → wait healthcheck → smoke test
  → clear exit code.
- Compose: `build: .` → `image: ghcr.io/...:${BUDGETSPIN_TAG}`.
- Actions `deploy` job with `production` environment + `SSH_DEPLOY_KEY` secret.
- Local `scripts/deploy-prod.sh` kept as break-glass (pull mode).
- **Security:** if the CI secret leaks, the attacker can only trigger a deploy of
  what's already in main — no shell, no data read. Blast radius proportional to
  each credential's function.

## ◻ Phase 5 — Instant rollback · pending
*Rollback as a rehearsed capability, not theory · MTTR.*

- `workflow_dispatch` with `tag` input: re-deploy any version from the Actions
  UI.
- **Real rehearsal:** deploy `sha-N`, roll back to `sha-N−1`, time it.
- Runbook: step-by-step, including the "GitHub down" case (break-glass with an
  already-pulled image).
- **Concept:** a rollback never rehearsed doesn't exist. The question for every
  deploy: how do I go back in 30 seconds?

## ◻ Phase 6 — Migrations as an explicit step + backup · pending
*Migrate ≠ start · backup before any irreversible change.*

- Remove `db:migrate` from the container `command:`.
- `deploy.sh`: timestamped sqlite backup (retention N) → migrate as a separate
  step → only then `up -d`.
- Document expand/contract (the why, even if with 1 replica it doesn't bite).
- **Security:** a failed migration without a backup is data loss. The pre-deploy
  backup is the safety net for the one part that can't be rebuilt: the data.

## ◻ Phase 7 — Observability · pending
*Find out before the user does · logs as evidence.*

- **Uptime Kuma** (OSS) on the server behind Traefik: monitors the real
  endpoint; alerts via a free channel (Telegram/email).
- Log rotation in compose (`max-size`/`max-file`).
- Future noted: Loki + Grafana for centralized logs.
- **Security:** logs are evidence; without rotation they're lost or fill the
  disk. Deliberate retention, not accidental.

## ◌ Phase 8 — Pull-based GitOps + secrets management · future
*Nobody holds credentials toward prod · desired state declared in git.*

- Watchtower or a systemd timer polling GHCR: inverts credential direction (the
  server reaches out; nothing comes in).
- SOPS + age: encrypted, versioned `.env.production` in the repo.
- Planned in detail when we get there; with a single server the cost/benefit is
  evaluated then.
- Candidate tools: Watchtower, SOPS, age.

---

## Learning backlog

Topics that surfaced and stayed open. They block no phase; resume when there's
energy/context. On closing one: strike through and date it.

- **npm/npx low-level** — binary resolution (`node_modules/.bin`, symlinks, PATH
  in scripts), npx download fallback and typosquatting risk, `npx --no-install`.
  *(skimmed 2026-06-09; revisit)*
- ~~**OOM in `repository.test.ts`**~~ — *resolved 2026-06-09 (`09405ff`)*:
  timezone bug in `addMonths` (built a UTC date, read it with local getters →
  no-op in UTC−3 → infinite loop). Lesson: it passed on UTC runners — CI alone
  wouldn't have caught it; run tests with a non-UTC TZ in CI.
- ~~**Triage of the first lint's 8 findings**~~ — *resolved 2026-06-09
  (`5542048`)*: 1 real fix, 5 documented FPs, object-injection off globally with
  rationale. Lint with `--max-warnings 0` as a gate.
- **Linter vs real SAST** — where eslint-plugin-security ends and Semgrep/CodeQL
  begins.
- **Timing attacks on credential comparison** — why `===` leaks info, how
  `timingSafeEqual` works.
- **ReDoS** — catastrophic backtracking in regex.
- **Expand/contract migrations** — the full pattern (touched in Phase 6).
- **Zero-downtime / rolling deploys** — Swarm/K8s, and simulating it with
  compose+Traefik.
- **Node lifecycle (Current/LTS/EOL)** — why prod uses LTS only.
- **Secrets beyond .env** — SOPS+age, Vault, Actions environment protection
  (touched in Phases 4 and 8).
- **12-factor app** — what BudgetSpin complies with and what it doesn't.
- **What each GitHub Action we use does** — deep dive of `actions/checkout`,
  `setup-node`, `docker/setup-buildx-action`, `build-push-action`,
  `metadata-action`, `login-action`, `aquasecurity/trivy-action`,
  `anchore/sbom-action`, `gitleaks-action`, `osv-scanner-action`: what each runs
  internally, key inputs, and why each is a supply-chain dependency (third-party
  code in the runner). *(surfaced in Phase 3)*
- **The `GITHUB_TOKEN`** — what it is, how it's minted per-job and ephemeral, its
  permissions model (`contents: read` default, `packages: write` scoped to the
  `image` job), how it differs from a PAT, and its relation to the
  `read:packages` PAT the server will use in Phase 4. *(surfaced in Phase 3)*

## Principles governing the roadmap

- **Build once, deploy everywhere:** the artifact is built once in CI; prod
  never compiles.
- **No spending:** given alternatives, always the OSS/free one if the learning
  goal is the same.
- **Anti-conflict ordering:** image hardening (P2) before publishing (P3); the
  compose switches to `image:` only with CD (P4); migrations (P6) after the
  definitive deploy script exists.
- **One phase per session,** system working at the end, RUNBOOK and this roadmap
  updated in the same turn.
- **Security integrated:** each phase names its angle (supply chain, attack
  surface, least privilege, integrity, evidence).
