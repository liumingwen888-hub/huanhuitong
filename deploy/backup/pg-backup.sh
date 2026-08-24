#!/usr/bin/env bash
# Dual-track PostgreSQL backup: physical (pg_basebackup + WAL) and
# logical (pg_dump). Connection parameters come exclusively from the
# standard PG* environment variables — never hardcoded here.
set -euo pipefail

usage() {
  echo "usage: pg-backup.sh <physical|logical|both> <target_dir>" >&2
  exit 2
}

KIND="${1:-}"
TARGET_DIR="${2:-}"
case "$KIND" in
  physical|logical|both) ;;
  *) usage ;;
esac
[ -n "$TARGET_DIR" ] || usage

: "${PGHOST:?PGHOST required}"
: "${PGPORT:?PGPORT required}"
: "${PGUSER:?PGUSER required}"
: "${PGPASSWORD:?PGPASSWORD required}"

STAMP="$(date -u +%Y%m%d-%H%M%S)"
mkdir -p "$TARGET_DIR"

manifest_entry() {
  # kind|path|sha256|size_bytes|db_version
  printf '%s|%s|%s|%s|%s\n' "$1" "$2" "$3" "$4" "$5"
}

DB_VERSION="$(psql -X -At -c 'select version()' | head -c 120)"

run_physical() {
  local dir="$TARGET_DIR/hht-physical-$STAMP"
  echo "[backup] physical → $dir"
  pg_basebackup -D "$dir" --wal-method=stream --checkpoint=fast --progress
  local sha size
  sha="$(cd "$dir" && find . -type f | sort | xargs sha256sum | sha256sum | cut -d' ' -f1)"
  size="$(du -sb "$dir" | cut -f1)"
  manifest_entry physical "$dir" "$sha" "$size" "$DB_VERSION" \
    >> "$TARGET_DIR/backup-manifest.txt"
  (cd "$dir" && find . -type f | sort | xargs sha256sum > SHA256SUMS)
  echo "[backup] physical done"
}

run_logical() {
  local file="$TARGET_DIR/hht-logical-$STAMP.dump"
  echo "[backup] logical → $file"
  pg_dump --format=custom --file "$file"
  local sha size
  sha="$(sha256sum "$file" | cut -d' ' -f1)"
  size="$(stat -c%s "$file" 2>/dev/null || stat -f%z "$file")"
  manifest_entry logical "$file" "$sha" "$size" "$DB_VERSION" \
    >> "$TARGET_DIR/backup-manifest.txt"
  sha256sum "$file" > "$file.sha256"
  echo "[backup] logical done"
}

case "$KIND" in
  physical) run_physical ;;
  logical)  run_logical ;;
  both)     run_physical; run_logical ;;
esac

echo "[backup] manifest: $TARGET_DIR/backup-manifest.txt"
