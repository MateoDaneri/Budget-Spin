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

## Itaú email import (experimental)

Keep the `ingest` profile disabled until the email format, matching, review and
reconciliation have been validated for the intended account. An email notice is
not a bank statement or proof that a transaction settled. The importer is not
guaranteed to capture every transaction.

For a personal Gmail account, IMAP is already enabled. Google documents
`imap.gmail.com` on port `993` with TLS. The IMAP option accepts a password. OAuth via the Gmail API is described below. If using IMAP, enable 2-Step Verification, open
[Google App Passwords](https://myaccount.google.com/apppasswords), and create a
dedicated app password. Google recommends OAuth instead; app passwords may be
unavailable for Advanced Protection, security-key-only 2-Step Verification or
organization accounts, and are revoked when the Google account password changes.
See [Google's app password guidance](https://support.google.com/mail/answer/185833)
and [Gmail IMAP settings](https://support.google.com/mail/answer/7126229).
Prefer a dedicated mailbox: read-only IMAP mode does not restrict the authority
of a stolen credential. Never put the password in a command, chat or tracked file.

Set `ITAU_IMAP_HOST`, `ITAU_IMAP_PORT`, `ITAU_IMAP_USER`,
`ITAU_IMAP_PASSWORD` and a distinct random `INGEST_TOKEN` in the protected,
untracked `.env.production`; the default mailbox is `INBOX`. Compose must read
that same file for interpolation so the scheduler and app receive the same token.
An exported `INGEST_TOKEN` in the shell takes precedence for interpolation; unset
it if it differs from the value in `.env.production`:

```sh
docker compose --env-file .env.production -f docker-compose.prod.yml --profile ingest up -d
docker compose --env-file .env.production -f docker-compose.prod.yml --profile ingest ps
docker compose --env-file .env.production -f docker-compose.prod.yml --profile ingest logs --tail=50 ingest
docker compose --env-file .env.production -f docker-compose.prod.yml stop ingest
```

The scheduler receives only `INGEST_TOKEN` and `INGEST_INTERVAL`, and uses a
dedicated internal network to reach the app over HTTP. This is not encryption
between containers; trusted Docker host and network access are required. The
endpoint remains reachable wherever the app is reachable and the token grants
the ability to trigger imports. The overlap guard applies to one Node process
only: do not run multiple app replicas without a shared lock. A concurrent call
returns 409. Errors returned by the endpoint are generic; inspect operational
records with care.

The importer stores IMAP `UIDVALIDITY` and the last processed UID in SQLite,
keyed by mailbox identity. With no cursor, or when UIDVALIDITY changes, it starts
at UID 1. Each trigger processes at most ten batches of 500 UID positions, reading
headers first and downloading only matching candidate bodies, limited to 1 MiB.
Checkpoints are saved after a complete batch. A candidate notice that cannot be
imported (any reason in [Quarantine](#quarantine)) is retained in a private
quarantine by UID and UIDVALIDITY with a reason code, retried in bounded batches
and surfaced as a sync error for review; the rest of the batch continues.
Deleted or archived notices and locators from an earlier UIDVALIDITY remain
pending for manual review. Oversized (over 1 MiB) or incomplete candidates are
quarantined too instead of failing the batch. Messages
removed before processing cannot be recovered. Reprocessing uses Message-ID to
avoid reinserting the same email, but does not reconcile distinct notices for the
same purchase. Imported entries start as pending.

An interactive local installer can stage a Gmail address and app password in a
mode-0600 file without putting either in shell arguments or logs:
`python3 scripts/install-imap-secret.py` (use `--replace` for an existing file).
Run it on the Docker host with Docker access; it does not activate IMAP. The
read-only probe `python3 scripts/probe-imap-secret.py` checks authentication and
matches the existing OAuth account without reading messages. The private selector
`/app/data/ingest-provider` contains `imap` or `gmail`; an explicit
`ITAU_INGEST_PROVIDER` environment setting takes precedence. Preserve the SQLite
backup, Gmail state and OAuth credential until IMAP coverage and rollback have
been verified.

The scheduler image is pinned by digest in Compose. Review and verify a new
digest when updating it. Avoid `compose config`
output where other people or logs can see it because interpolation reveals secrets.

### Gmail API OAuth alternative (experimental)

Google's [Gmail data policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)
lists approved uses. It is not yet established whether importing financial
notifications into this application qualifies. Check that before authorizing it.
OAuth does not authenticate the sender of an email. `gmail.readonly` grants access
to the entire mailbox, not just Itaú messages. Prefer a dedicated mailbox.

Create a Google Cloud project, enable Gmail API, configure the OAuth consent
screen and create a **Desktop app** OAuth client. For a personal account use
External audience; in Testing add the account as a test user. Google documents a
seven-day refresh-token lifetime in Testing for Gmail scopes. Its personal-use
verification exception and an unverified-app warning do not remove its policy
requirements; refresh tokens can also be revoked or invalidated at any time.
See [Google's setup](https://developers.google.com/workspace/gmail/api/quickstart/nodejs),
[token expiration](https://developers.google.com/identity/protocols/oauth2) and
[verification exceptions](https://support.google.com/cloud/answer/13464323).

On the computer running the browser, from the repository root, run the bootstrap
using a downloaded Desktop client JSON and a **new absolute path outside the
repository**. It opens a loopback callback with PKCE; open the printed URL in a
local browser. It creates the output with mode 0600 and refuses to overwrite it.
Do not share the generated file, URL or credentials in chat. This is a local
setup command; an SSH session to another host cannot use that host's loopback
callback from the local browser without a separately configured secure tunnel.

```sh
node scripts/gmail-oauth-bootstrap.mjs /path/to/desktop-client.json /secure/path/gmail-oauth.json
```

To install the credential in the running app container's persistent data volume,
substitute the local path below. The command creates a new file without
overwriting an existing one and does not print the secret. Protect and remove the
temporary host copy when appropriate; revoking and reauthorizing requires a new
file. Treat the volume and its backups as sensitive.

```sh
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T app \
  node -e 'const fs=require("node:fs"); fs.writeFileSync("/app/data/gmail-oauth.json", fs.readFileSync(0), {mode:0o600,flag:"wx"})' \
  < /secure/path/gmail-oauth.json
```

Set `ITAU_INGEST_PROVIDER=gmail`, `GMAIL_CREDENTIALS_PATH=/app/data/gmail-oauth.json`
and `GMAIL_STATE_PATH=/app/data/ingest-state/gmail-state.json` in `.env.production` and
recreate the app before starting the optional `ingest` profile. The default
provider remains IMAP. Gmail sync reads the inbox using an initial full scan and
then Gmail history; it saves a page checkpoint only after processing the page.
It reads From and Subject metadata for inbox messages and downloads bodies only
for matching supported Itaú notices. OAuth access still covers the entire mailbox.
Recognized notices with unsupported formats are retained by Gmail ID in the
private state file and retried in bounded batches; other notices can continue.
The supported debit purchase format requires an approved debit-card subject,
merchant after `Realizado en`, and an amount with decimal dot in pesos or dollars;
comma thousands groups are accepted. Other formats remain in the private queue.
An ingest run reports an error while any are retained. The queue holds at most
1000 IDs and does not store message bodies; archived or deleted notices can no
longer be imported automatically until available again.
Each pass handles up to two pages of 50 records and messages up to 1 MiB. If
history expires, a full scan restarts. Deleted or archived messages may be missed,
and distinct emails for one payment require reconciliation. Keep the state file
with the database; losing either can cause reprocessing or omissions. Gmail API
access and the complete deployment have not been tested with a real account.

### Splitwise synchronization and imported categories

The optional `splitwise-ingest` Compose profile triggers a separate authenticated
endpoint every 3600 seconds by default (`SPLITWISE_INGEST_INTERVAL`); it requires
the same dedicated `INGEST_TOKEN` configured in the app. It is disabled until
explicitly started. Install the key at `/app/data/splitwise-api-key`. The file must be owner-only. Install the personal API key or the Gmail
bootstrap output over a private stdin stream, for example from the computer that
holds the file, with Docker access on the server:

```sh
docker exec -i --user 0 budget-spin-app-1 node /app/install-provider-secret.mjs splitwise < /private/path/splitwise-key
docker exec -i --user 0 budget-spin-app-1 node /app/install-provider-secret.mjs gmail < /private/path/gmail-oauth.json
```

The installer refuses to overwrite an existing file. Do not put credentials in
shell arguments, chat, logs or the repository. Configure the app and recreate it
using the verified production image before starting either scheduler; do not
rebuild an older checkout during activation. Protect the data volume and any
backups containing provider files. Rotate credentials explicitly when needed.

On an installation using `scripts/activate-sync.py`, the fixed paths
`/app/data/gmail-oauth.json` and `/app/data/splitwise-api-key` are used by default
unless explicit provider settings override them. After installing a provider credential, run
`python3 scripts/activate-sync.py gmail --check` or `python3 scripts/activate-sync.py splitwise --check`
on the Docker host. To start it, repeat without `--check` with Docker access. It creates an
owner-only trigger token, attaches the app to a dedicated internal network,
and starts the selected pinned scheduler container. Its first check begins immediately.
The token is mounted read-only into the schedulers, without provider credentials.
The script refuses existing scheduler names and does not replace containers.

Splitwise records are stored separately by account and expense ID and are not
added to budget totals. The dashboard's observed-spending view can pair them
with bank notices; the rules are in `FINANCIAL-RULES`. The authenticated user's paid
and owed shares are stored as decimal strings. Payments and deletion flags are
preserved when supplied by Splitwise; records absent from a response are not
assumed deleted. Each complete pass reads at most 100 pages of 20; failure or an
exceeded bound leaves the prior snapshot intact. This is a bounded full scan,
not a guarantee that every deletion or concurrent change will be observed. The
page shows the latest 200 stored records and last successful synchronization.
Real-account behavior and provider rate limits still need verification.

The optional activity extension records the most recent 100 Splitwise
notifications at each successful check, retaining only supported event types
linked to a stored expense where the authenticated account participates. It
stores provider event IDs and times, never notification HTML. This feed is
bounded and can miss earlier events. It also records each returned friend/currency
balance with the observation time; it does not reconstruct earlier balances or
interpret an absent balance as zero. Previously recorded observations are
retained, and identical notification IDs are not duplicated. If the activity or
balance API request fails, the separate expense snapshot already saved remains
available, but that scheduler run reports an error and retries later.

Imported purchases receive an editable category. A prior explicit choice is
reused for the same whitespace-normalized, case-insensitive description; an
unknown description is assigned `Other`. Payments and transfers are not treated
as purchases. Categories do not cause imports to be counted in budget totals.

## Import and sync operations

> Branch `claude/feature-conciliacion`: unmerged. Lint, typecheck, the test suite (126 tests) and the production build passed under Node 24 on 2026-11-10 at commit `b71b5de`; the logic has not been checked against real bank or Splitwise data.
> Deployment status: see the operator. The commands below follow the code as
> written and have not been exercised one by one.
> Architecture and the trust boundary (bank e-mails are not sender-authenticated)
> are in `HANDOFF`; observed-spending rules in `FINANCIAL-RULES`.

### Environment variables (names only — values live in the untracked `.env.production`)
| Variable | Read by | Notes |
|---|---|---|
| `INGEST_TOKEN` | app + Compose schedulers | Bearer for both trigger routes. 32–256 chars of `[A-Za-z0-9_-]`; anything else, or the old example placeholder, makes the routes answer 503. If unset, the app reads `/app/data/ingest-token` (must be a mode-0600 file). Separate from `BUDGETSPIN_AUTH_SECRET` |
| `INGEST_INTERVAL` | `ingest` scheduler | Seconds between Itaú passes (default 900) |
| `SPLITWISE_INGEST_INTERVAL` | `splitwise-ingest` scheduler | Seconds between Splitwise syncs (default 3600) |
| `ITAU_INGEST_PROVIDER` | app | `imap` or `gmail`. If unset: private file `/app/data/ingest-provider`; else Gmail when `/app/data/gmail-oauth.json` exists; else IMAP |
| `ITAU_IMAP_HOST`, `ITAU_IMAP_PORT`, `ITAU_IMAP_USER`, `ITAU_IMAP_PASSWORD`, `ITAU_IMAP_MAILBOX` | app (IMAP) | Port defaults to 993, mailbox to `INBOX` |
| `ITAU_IMAP_CREDENTIALS_PATH` | app (IMAP) | Private JSON `{"user","password"}` used when the user/password variables are unset (default `/app/data/imap-credentials.json`) |
| `ITAU_IMAP_STATE_DIR` | app (IMAP) | Quarantine directory (default `/app/data/ingest-state`) |
| `GMAIL_CREDENTIALS_PATH`, `GMAIL_STATE_PATH` | app (Gmail) | Defaults `/app/data/gmail-oauth.json` and `/app/data/ingest-state/gmail-state.json` |
| `SPLITWISE_API_KEY` | app (Splitwise) | Read by the code but **not listed** in `.env.production.example`. Preferred: the private file `/app/data/splitwise-api-key` |

### Two activation paths — pick one
| | Compose profiles | `scripts/activate-sync.py` |
|---|---|---|
| Schedulers | `ingest`, `splitwise-ingest` services | `budgetspin-gmail-scheduler`, `budgetspin-splitwise-scheduler` containers (`docker run`, outside Compose) |
| Token | `INGEST_TOKEN` in `.env.production` | generated file on the host, installed as `/app/data/ingest-token`, mounted read-only into the scheduler |
| Visible in `docker compose ps` | yes | no |

They are **mutually exclusive**: the script stops if the app already has
`INGEST_TOKEN` (or provider overrides) in its environment, and the app prefers
`INGEST_TOKEN` over the token file, so adding the variable later makes the
script's schedulers get 401. Running both would also trigger the same route
twice (the second call gets 409). The script's "gmail" scheduler calls
`/api/ingest/itau`, which uses whichever provider is selected. Unifying the
paths is MEJ-005.

### Trigger a run by hand
Same curl form as the scheduler: the header goes to curl as config on stdin so
the token is never in a process argument. Single quotes keep `$INGEST_TOKEN`
unexpanded on the host; it is read from the scheduler container's environment.
```sh
# Compose path (scheduler running)
docker compose --env-file .env.production -f docker-compose.prod.yml --profile ingest exec ingest \
  sh -c 'printf "header = \"Authorization: Bearer %s\"\n" "$INGEST_TOKEN" | curl -K - -fsS -X POST --connect-timeout 10 http://app:3000/api/ingest/itau'
docker compose --env-file .env.production -f docker-compose.prod.yml --profile splitwise-ingest exec splitwise-ingest \
  sh -c 'printf "header = \"Authorization: Bearer %s\"\n" "$INGEST_TOKEN" | curl -K - -fsS -X POST --connect-timeout 10 --max-time 600 http://app:3000/api/ingest/splitwise'

# Script path: the token is the mounted file
docker exec budgetspin-gmail-scheduler \
  sh -c 'printf "header = \"Authorization: Bearer %s\"\n" "$(cat /run/ingest-token)" | curl -K - -fsS -X POST --connect-timeout 10 --max-time 600 http://app:3000/api/ingest/itau'
```
An Itaú pass answers `{"ok":true,"messagesSeen":…,"inserted":…,"skipped":…}`;
Splitwise answers `{"ok":true}`.

### Where to see results
- **`/transactions`**: last Itaú check (completed/failed, time, imported count),
  pending count among the latest 200 imports, and Confirm / Discard per notice.
  Pending notices count in observed spending until discarded.
- **`ingest_runs`** (one row per Itaú pass, IMAP `itau_email` or Gmail `gmail_api`;
  errors are fixed strings, never provider text):
  ```sh
  docker compose --env-file .env.production -f docker-compose.prod.yml exec -T app \
    node --input-type=module -e "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync('/app/data/budgetspin.sqlite'); console.table(db.prepare('SELECT id, source, started_at, finished_at, messages_seen, inserted, skipped, status, error FROM ingest_runs ORDER BY id DESC LIMIT 10').all()); db.close();"
  ```
- **Splitwise** writes no `ingest_runs` row. `/splitwise` shows the last
  successful sync (`splitwise_sync_account.synced_at`); the trigger's HTTP status
  and the scheduler log are the only per-run signal.
- **Scheduler logs**: a failed trigger prints `[ingest] trigger failed`,
  `[splitwise-ingest] trigger failed` (Compose) or `sync trigger failed` (script).

### Quarantine
A message that passed the sender/subject filter but cannot be imported is set
aside with a fixed reason code; only its locator is stored (IMAP UID +
UIDVALIDITY in `imap-quarantine-<mailbox-hash>.json` under the state directory,
or Gmail ID in the Gmail state file), never the body. Each pass first retries up
to 20 (IMAP) or 50 (Gmail) retained items; one that now imports is removed.

| Reason | Meaning |
|---|---|
| `unrecognized` | body format not understood, or no Message-ID |
| `non_positive_amount` | amount is zero or negative |
| `unconfigured_currency` | currency not configured in the app (add it, the retry can then import it) |
| `unsupported_precision` | more decimals than the currency's minor unit |
| `invalid_amount` | amount could not be converted |
| `oversized` | message over 1 MiB |
| `incomplete` | download incomplete or malformed headers |

While anything is retained, the pass is recorded with `status = 'error'` and
`Unrecognized notices retained for review.`, **but the route still answers
200 `{"ok":true}`**, so the scheduler logs nothing: check `ingest_runs` or
`/transactions`. Once 1000 items are retained, a pass that needs to retain one
more fails. The code has no
command to remove an entry by hand.

### Enable / disable the schedulers
```sh
# Compose path
docker compose --env-file .env.production -f docker-compose.prod.yml --profile ingest up -d
docker compose --env-file .env.production -f docker-compose.prod.yml --profile splitwise-ingest up -d
docker compose --env-file .env.production -f docker-compose.prod.yml stop ingest splitwise-ingest
docker compose --env-file .env.production -f docker-compose.prod.yml rm -f ingest splitwise-ingest

# Script path (on the Docker host)
python3 scripts/activate-sync.py gmail --check        # preflight only, starts nothing
python3 scripts/activate-sync.py gmail                # starts budgetspin-gmail-scheduler; first trigger is immediate
python3 scripts/activate-sync.py splitwise
docker stop budgetspin-gmail-scheduler budgetspin-splitwise-scheduler
docker rm budgetspin-gmail-scheduler budgetspin-splitwise-scheduler
```
Stopping a scheduler does not revoke the token: the routes still accept it from
anything that can reach the app. Remove or rotate the token to fully disable.

### When a run fails
| Trigger answer | Meaning | Check |
|---|---|---|
| 503 `Ingest is not configured.` | no usable token in the app | `INGEST_TOKEN` set and valid (format, not the placeholder); or `/app/data/ingest-token` exists, is a regular file, mode 0600 |
| 401 `Unauthorized.` | scheduler token ≠ app token | a shell-exported `INGEST_TOKEN` overriding Compose interpolation; both activation paths mixed |
| 409 `Ingest already running.` | a pass is still running in that process | wait; do not run several app replicas |
| 500 `Ingest failed.` | the pass threw | latest `ingest_runs` row: `IMAP synchronization failed.` or `Gmail synchronization failed (HTTP n).` → credential, connection or provider; also cursor errors and a full quarantine. **No new row** → it failed before the pass: IMAP not configured, invalid provider selector, or a credential/selector file that is not private. The route does not log the exception |
| 500 on Splitwise | sync threw | `/splitwise` banner (not configured / rejected credential / rate limited / unavailable); key file private; a changed Splitwise account is refused and the existing imports are kept; 2,000+ expenses make every sync fail (MEJ-004) |
| 200 but `status = 'error'` | items in quarantine | see Quarantine |
| 200, `inserted = 0` for days | possibly a changed bank e-mail format | no automatic watchdog exists; compare with the mailbox |

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
