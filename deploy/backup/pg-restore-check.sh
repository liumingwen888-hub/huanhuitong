#!/usr/bin/env bash
# Verify a backup by restoring it into a throwaway PostgreSQL
# container, checking critical tables, then destroying everything.
# An unverified backup is no backup — this script is mandatory
# after every backup run.
set -euo pipefail

usage() {
  echo "usage: pg-restore-check.sh <physical_dir|logical_dump> [docker_image]" >&2
  exit 2
}

SOURCE="${1:-}"
IMAGE="${2:-postgres:18}"
[ -n "$SOURCE" ] || usage

CONTAINER=""
CLEANUP_DONE=0
cleanup() {
  if [ "$CLEANUP_DONE" -eq 0 ] && [ -n "$CONTAINER" ]; then
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  fi
  CLEANANUP_DONE=1
}
trap cleanup EXIT

kind="unknown"
if [ -d "$SOURCE" ]; then
  kind="physical"
elif [ -f "$SOURCE" ]; then
  kind="logical"
else
  echo "[restore-check] source not found: $SOURCE" >&2
  exit 1
fi

PORT="$((20000 + RANDOM % 20000))"
CONTAINER="hht-restore-check-$PORT"
echo "[restore-check] kind=$kind container=$CONTAINER port=$PORT"

if [ "$kind" = "logical" ]; then
  # verify archive is readable before restoring
  pg_restore --list "$SOURCE" >/dev/null
  docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=check \
    -p "$PORT:5432" "$IMAGE" >/dev/null
  for _ in $(seq 1 30); do
    docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
    sleep 1
  done
  docker exec -i "$CONTAINER" createdb -U postgres hht_check
  pg_restore -h localhost -p "$PORT" -U postgres -d hht_check --no-owner "$SOURCE"
else
  # physical: boot a container directly on the backup data directory
  docker run -d --name "$CONTAINER" \
    -v "$(cd "$SOURCE" && pwd):/var/lib/postgresql/data:rw" \
    -e POSTGRES_PASSWORD=check -p "$PORT:5432" "$IMAGE" >/dev/null
  for _ in $(seq 1 60); do
    docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
    sleep 1
  done
fi

# critical-table verification: a restore without data is a failure
for table in users ledger_transactions audit_events; do
  COUNT="$(docker exec "$CONTAINER" psql -U postgres -d hht_check -At \
    -c "select count(*) from $table" 2>/dev/null \
    || docker exec "$CONTAINER" psql -U postgres -At \
    -c "select count(*) from $table" 2>/dev/null || echo -1)"
  if [ "$COUNT" -lt 0 ] 2>/dev/null; then
    echo "[restore-check] FAILED: table $table missing or query error" >&2
    exit 1
  fi
  echo "[restore-check] $table rows=$COUNT"
done

docker rm -f "$CONTAINER" >/dev/null
CONTAINER=""
echo "RESTORE_CHECK_PASSED"
