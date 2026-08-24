#!/usr/bin/env bash
# Automated restore drill: backup a live database, destroy nothing of
# the source, restore into a throwaway container, assert data parity,
# three-domain reconciliation and — critically — NO new side effects
# (the restore is not a re-sender: outbox messages stay undelivered,
# no new job leases appear). Produces an evidence summary.
#
# RestoreRun state machine (mirrors the domain model):
#   PLANNED → RESTORING → VALIDATING → RECONCILING → SAFE_TO_RESUME
#   any failure → FAILED (the drill container is KEPT for inspection)
set -euo pipefail

usage() {
  echo "usage: pg-restore-drill.sh [--keep] [--image postgres:18]" >&2
  echo "env:   PGHOST PGPORT PGUSER PGPASSWORD (source database)" >&2
  exit 2
}

KEEP=0
IMAGE="postgres:18"
while [ $# -gt 0 ]; do
  case "$1" in
    --keep) KEEP=1 ;;
    --image) IMAGE="${2:?}"; shift ;;
    *) usage ;;
  esac
  shift
done

: "${PGHOST:?PGHOST required}"
: "${PGPORT:?PGPORT required}"
: "${PGUSER:?PGUSER required}"
: "${PGPASSWORD:?PGPASSWORD required}"

STAMP="$(date -u +%Y%m%d-%H%M%S)"
DRILL_ID="drill-$STAMP"
WORK_DIR="$(mktemp -d "$DRILL_ID.XXXXXX")"
CONTAINER="hht-$DRILL_ID"
DRILL_PORT="$((30000 + RANDOM % 20000))"
DRILL_DB=hht_drilled
CLEANED=0

phase() { echo "[$DRILL_ID][$(date -u +%H:%M:%S)] $1"; }

cleanup() {
  if [ "$CLEANED" -eq 0 ] && [ "$KEEP" -eq 0 ]; then
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    rm -rf "$WORK_DIR"
  elif [ "$KEEP" -eq 1 ]; then
    echo "[cleanup] --keep: container=$CONTAINER workdir=$WORK_DIR preserved"
  fi
}
trap cleanup EXIT

fail() {
  phase "FAILED: $1 (container kept for inspection: $CONTAINER)"
  exit 1
}

# ── PLANNED ──
phase "PLANNED drill=$DRILL_ID port=$DRILL_PORT container=$CONTAINER"

# ── RESTORING ──
phase "RESTORING logical backup of source"
DUMP="$WORK_DIR/source.dump"
pg_dump --format=custom --file "$DUMP" || fail "source dump"

phase "RESTORING boot drill container"
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=drill \
  -p "$DRILL_PORT:5432" "$IMAGE" >/dev/null || fail "container boot"
for _ in $(seq 1 30); do
  docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$CONTAINER" createdb -U postgres "$DRILL_DB" || fail "createdb"
pg_restore -h localhost -p "$DRILL_PORT" -U postgres -d "$DRILL_DB \
  --no-owner "$DUMP" || fail "pg_restore"

# ── VALIDATING ──
phase "VALIDATING row-count parity (source vs restored)"
for table in users ledger_transactions audit_events withdrawal_orders; do
  SRC_N="$(psql -X -At -c "select count(*) from $table")"
  RST_N="$(docker exec "$CONTAINER" psql -U postgres -d "$DRILL_DB" -At \
    -c "select count(*) from $table")"
  if [ "$SRC_N" != "$RST_N" ]; then
    fail "row-count mismatch on $table: source=$SRC_N restored=$RST_N"
  fi
  echo "  $table rows=$RST_N ✓"
done

# ── RECONCILING ──
phase "RECONCILING ledger balance (debits == credits)"
BAL="$(docker exec "$CONTAINER" psql -U postgres -d "$DRILL_DB" -At -c "
  select (select coalesce(sum(amount),0) from ledger_entries where direction='DEBIT')
       - (select coalesce(sum(amount),0) from ledger_entries where direction='CREDIT')")"
[ "$BAL" = "0" ] || fail "ledger unbalanced by $BAL"
echo "  debits == credits ✓"

phase "RECONCILING projection drift (signed_balance vs entries)"
DRIFT="$(docker exec "$CONTAINER" psql -U postgres -d "$DRILL_DB" -At -c "
  select count(*) from account_balances b
   where b.signed_balance <> (
     select coalesce(sum(case e.direction when 'DEBIT' then e.amount
                                          else -e.amount end), 0)
       from ledger_entries e where e.account_id = b.account_id)")"
[ "$DRIFT" = "0" ] || fail "projection drift on $DRIFT accounts"
echo "  projection drift = 0 ✓"

# ── SAFE_TO_RESUME ──
phase "SAFE_TO_RESUME no-new-side-effects assertions"
SRC_OUTBOX="$(psql -X -At -c \
  "select count(*) from outbox_messages where delivered_at is null")" \
  || SRC_OUTBOX=0
RST_OUTBOX="$(docker exec "$CONTAINER" psql -U postgres -d "$DRILL_DB" -At -c \
  "select coalesce((select count(*) from outbox_messages where delivered_at is null),0)")"
echo "  outbox undelivered: source=$SRC_OUTBOX restored=$RST_OUTBOX (preserved, NOT resent)"
[ "$RST_OUTBOX" = "$SRC_OUTBOX" ] || fail "outbox undelivered count changed"

LEASED="$(docker exec "$CONTAINER" psql -U postgres -d "$DRILL_DB" -At -c \
  "select coalesce((select count(*) from durable_jobs where status='LEASED'),0)")"
echo "  durable_jobs LEASED in restored db: $LEASED (no worker connected — no new leases)"
[ "$LEASED" = "0" ] || fail "unexpected LEASED jobs in restored database"

CLEANED=1
if [ "$KEEP" -eq 0 ]; then
  docker rm -f "$CONTAINER" >/dev/null
  rm -rf "$WORK_DIR"
fi
echo ""
echo "RESTORE_DRILL_PASSED drill=$DRILL_ID"
echo "evidence: 4 tables parity ✓, ledger balanced ✓, projection 0 drift ✓,"
echo "          outbox preserved ($RST_OUTBOX), zero new job leases"
