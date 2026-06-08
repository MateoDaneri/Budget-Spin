#!/usr/bin/env sh
set -eu

: "${BUDGETSPIN_SSH_TARGET:?Set BUDGETSPIN_SSH_TARGET to user@host or an SSH alias.}"

REMOTE_DIR="${BUDGETSPIN_REMOTE_DIR:-/opt/budgetspin}"
BRANCH="${BUDGETSPIN_BRANCH:-main}"
COMPOSE="docker compose --env-file .env.production -f docker-compose.prod.yml"

ssh "$BUDGETSPIN_SSH_TARGET" "
  set -eu
  cd '$REMOTE_DIR'
  git fetch --all --prune
  git checkout '$BRANCH'
  git pull --ff-only
  $COMPOSE build --pull=false
  $COMPOSE up -d --remove-orphans
  $COMPOSE ps
  $COMPOSE logs --tail=80 app
"
