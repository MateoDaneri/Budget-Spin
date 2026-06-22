# BudgetSpin — Runbook

> Agent-readable mirror of `RUNBOOK.html`. Keep both in sync (see `CLAUDE.md`).
> Operational commands, deployment flow, SQLite backup/restore, data promotion,
> and failure diagnosis for the self-hosted service (Tailscale + Traefik).
> Placeholders: `$DEPLOY_USER`, `$SERVER_TS_HOST` (server Tailscale name),
> `/path/to/...` — no real infra identifiers in the repo.

## Assumptions
- Docker and Docker Compose installed and running.
- Supported app path is the repository root.
- Local dev uses `docker-compose.yml`; production uses `docker-compose.prod.yml`.
- App listens on port 3000 inside the container; data is SQLite.
- Local data in Docker volume `budgetspin_budgetspin-data`; production data in
  `budgetspin-prod-data`.
- `BUDGETSPIN_AUTH_SECRET` signs session cookies — keep it stable between
  restarts; changing it logs out existing sessions.
- Automatic FX lookup needs outbound HTTPS to `https://api.frankfurter.dev`.

## Local development
```bash
docker compose up --build        # run; open http://localhost:3000
docker compose down              # stop
docker compose restart app       # restart
docker compose logs -f app       # logs
docker compose run --rm app npm run db:migrate   # migrations
docker compose run --rm app npm test             # tests
docker compose run --rm app npm run typecheck    # typecheck
docker compose build             # production build check
docker compose down -v && docker compose up --build   # reset local data (destroys it)
```
On first run after auth is enabled, open `/login` and create the password for
user `mdaneri`. Do not run the reset (`down -v`) if you need to keep local data.

## Production topology
Request path: Mac browser → `budget-spin.ts.local` → `/etc/hosts` resolves to
the server Tailscale IP → Traefik on the server → Docker router
`Host(budget-spin.ts.local)` → app container on Docker network `proxy`.

Defaults encoded in `docker-compose.prod.yml` (override in `.env.production` on
the server): Traefik network `proxy`, entrypoint `websecure`, TLS enabled,
hostname `budget-spin.ts.local`, no host port published.

## Production first setup
```bash
cd /path/to/budgetspin            # deploy dir on the server
cp .env.production.example .env.production
# edit .env.production: set a long random BUDGETSPIN_AUTH_SECRET
# if needed: TRAEFIK_DOCKER_NETWORK / TRAEFIK_ENTRYPOINT=web / TRAEFIK_TLS=false
docker network inspect proxy      # confirm the Traefik network exists
docker compose --env-file .env.production -f docker-compose.prod.yml build --pull=false
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=100 app
```

### Mac hostname
Add the server Tailscale IP to `/etc/hosts` on the Mac
(`100.x.y.z budget-spin.ts.local`), then verify:
```bash
curl -k -I https://budget-spin.ts.local/login    # or http:// if TRAEFIK_TLS=false
```

## Deployments
Normal flow: develop locally → typecheck/tests locally → commit → make the
commit available on the server → SSH over Tailscale → pull → rebuild/recreate →
verify logs and `/login`.

```bash
# On the server:
cd /path/to/budgetspin
git pull --ff-only
docker compose --env-file .env.production -f docker-compose.prod.yml build --pull=false
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --remove-orphans
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=100 app

# Remote from the Mac:
BUDGETSPIN_SSH_TARGET=user@server ./scripts/deploy-prod.sh
# optional: BUDGETSPIN_REMOTE_DIR=/path/to/budgetspin  BUDGETSPIN_BRANCH=main
```

## CI image gate and accepted risks
The image job reports vulnerabilities before enforcing the CRITICAL/HIGH gate.
SARIF goes to GitHub code scanning, Trivy JSON is retained for manual
DefectDojo import, and syft produces the SBOM.

Risk acceptances live in `.trivyignore-gate` and apply **only** to the blocking
gate through the workflow's explicit `trivyignores` input. Before adding one:

1. Verify the advisory and the exact package path reported by Trivy.
2. Document why the vulnerable path is not reachable in BudgetSpin.
3. Add an expiry (`exp:YYYY-MM-DD`) that forces re-review.
4. Keep SARIF and JSON reporting unfiltered so the accepted risk remains
   visible. Never move this file back to the default `.trivyignore` name unless
   suppressing the finding from reports is intentional.

At expiry Trivy stops honoring the entry and the gate becomes red again. Remove
the entry earlier if a base-image update or runtime change eliminates the
finding.

## Rollback
Assumes the previous commit is still in git.
```bash
cd /path/to/budgetspin
git log --oneline -5
git checkout <known-good-commit>
docker compose --env-file .env.production -f docker-compose.prod.yml build --pull=false
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --remove-orphans
# then verify ps + logs
```

## Promote dev data to production
**Replaces the entire production database — does not merge. Back up production
first and avoid writing new records during promotion.** Compose derives its
project name from the directory; renaming to `BudgetSpin-Dev` created
`budgetspin-dev_budgetspin-data` while historical records stayed in
`budgetspin_budgetspin-data`. Validate the source volume before export.

1. **Validate the original volume** (read-only) — expected: income 2,
   expenses 12, plans 2, `has_password: 1`. A throwaway `node:24-slim` container
   runs a `node:sqlite` query against the mounted volume. Don't continue if
   records are missing.
2. **Export** with SQLite `VACUUM INTO` from `/path/to/BudgetSpin-Dev` (repo
   root), mounting the source volume read-only and binding `$PWD` as `/export`,
   producing `budgetspin-original-<ts>.sqlite`.
3. **Transfer:** `scp "$EXPORT" "$DEPLOY_USER@$SERVER_TS_HOST:/path/to/budgetspin/"`.
4. **Restore on the server:** `down` → remove the existing
   `budgetspin.sqlite`/`-wal`/`-shm` in the volume → `create app` →
   `compose cp "$EXPORT" app:/app/data/budgetspin.sqlite`.
5. **Verify before starting:** run `PRAGMA integrity_check` + the counts query;
   expect `ok`, income 2, expenses 12, plans 2, `has_password 1`.
6. **Start and verify:** `up -d` → `ps` → `logs`. If prod shows "Create your
   password", the imported DB lacks `password_hash`/`password_salt` for
   `users.id = 'mdaneri'` — re-check the source volume instead of creating a new
   password.

## Production backup / restore
Backup uses SQLite `VACUUM INTO` via Node's `node:sqlite` (no `sqlite3` CLI in
the image):
```bash
BACKUP="budgetspin-backup-$(date +%F-%H%M%S).sqlite"
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T app \
  node --input-type=module -e "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync('/app/data/budgetspin.sqlite'); db.exec(\"VACUUM INTO '/app/data/$BACKUP'\"); db.close();"
docker compose --env-file .env.production -f docker-compose.prod.yml cp "app:/app/data/$BACKUP" "./$BACKUP"
```
Restore: `down` → remove existing sqlite files in the volume → `create app` →
`compose cp ./<backup>.sqlite app:/app/data/budgetspin.sqlite` → `up -d`.

## Troubleshooting
```bash
docker compose --env-file .env.production -f docker-compose.prod.yml config   # rendered config
docker inspect budgetspin-app-1 --format '{{json .Config.Labels}}'            # Traefik labels
# hit the app from inside the container namespace:
docker compose --env-file .env.production -f docker-compose.prod.yml exec app \
  node -e "fetch('http://127.0.0.1:3000/login').then(r => { console.log(r.status); process.exit(r.status < 500 ? 0 : 1); }).catch(e => { console.error(e); process.exit(1); })"
```
Common failures:
- `network proxy ... could not be found` → set `TRAEFIK_DOCKER_NETWORK` to the
  server's actual Traefik network, or create `proxy`.
- `BUDGETSPIN_AUTH_SECRET missing` → create `.env.production` and set a stable
  random secret.
- Browser can't resolve `budget-spin.ts.local` → update `/etc/hosts` with the
  server Tailscale IP.
- Resolves but Traefik 404 → verify hostname, entrypoint, TLS, labels, network.
