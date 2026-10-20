#!/bin/sh
# Restores a server backup (roadmap 9.1; see docs/runbook.md). Run on the server, in the folder that holds
# docker-compose.prod.yml and .env:
#
#   sh deploy/restore.sh 2026-10-19T02-30-00-000Z-nightly.pcrmbak
#
# The backup is checked first. Then the app and the worker stop, the current data is backed up once more,
# the backup is loaded into a new database, and only when that has worked does the new database replace
# the old one. The old database is kept (renamed) until you drop it. A failed restore changes nothing.
# The key is BACKUP_KEY from .env; for a backup made with an older key, export PCRM_RECOVERY_KEY first.
set -eu
# Git Bash on Windows (a drill on a test PC) would turn /backups/... into a Windows path
export MSYS_NO_PATHCONV=1
FILE="${1:?Name the backup file, for example: sh deploy/restore.sh 2026-10-19T02-30-00-000Z-nightly.pcrmbak}"
case "$FILE" in */*) echo "Give only the file name; backups are read from the backups volume."; exit 1 ;; esac
# COMPOSE overrides the command, for example to add --env-file or a project name for a restore drill
C="${COMPOSE:-docker compose -f docker-compose.prod.yml}"
STAMP=$(date -u +%Y-%m-%dT%H-%M-%S-000Z)
OLD="pharmacy_crm_old_$(date -u +%Y%m%d%H%M%S)"
# docker compose reads stdin; only the question below should
ops() { $C run --rm --no-deps -T -e PCRM_RECOVERY_KEY worker sh -c 'PCRM_RECOVERY_KEY="${PCRM_RECOVERY_KEY:-$BACKUP_KEY}" node dist/ops.js "$@"' ops "$@" </dev/null; }
psql_admin() { $C exec -T db psql -v ON_ERROR_STOP=1 -U pharmacy -d postgres "$@" </dev/null; }

echo "Checking the backup..."
ops verify "/backups/$FILE"

printf 'This replaces ALL pharmacy data with the backup above. Type RESTORE to continue: '
read -r answer || answer=""
[ "$answer" = "RESTORE" ] || { echo "Nothing changed."; exit 1; }

swapped=no
restart() {
  if [ "$swapped" = no ]; then echo "The restore did not finish; the current data is unchanged."; fi
  $C up -d app worker </dev/null >/dev/null
}
trap restart EXIT

echo "Stopping the app and the worker..."
$C stop app worker </dev/null

echo "Backing up the current data first..."
$C run --rm --no-deps -T worker sh -c 'PCRM_RECOVERY_KEY="$BACKUP_KEY" node dist/ops.js backup "/backups/$0-before-restore.pcrmbak"' "$STAMP" </dev/null

echo "Loading the backup into a new database..."
psql_admin -c "DROP DATABASE IF EXISTS pharmacy_crm_restore WITH (FORCE)" -c "CREATE DATABASE pharmacy_crm_restore"
$C run --rm --no-deps -T -e PCRM_RECOVERY_KEY worker sh -c 'PCRM_RECOVERY_KEY="${PCRM_RECOVERY_KEY:-$BACKUP_KEY}" node dist/ops.js restore "/backups/$0" --db "${DATABASE_URL%%/pharmacy_crm*}/pharmacy_crm_restore?schema=public"' "$FILE" </dev/null

echo "Switching to the restored data..."
psql_admin -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'pharmacy_crm' AND pid <> pg_backend_pid()" \
  -c "ALTER DATABASE pharmacy_crm RENAME TO $OLD" -c "ALTER DATABASE pharmacy_crm_restore RENAME TO pharmacy_crm"
swapped=yes

echo "Restored $FILE. The app is starting again."
echo "The previous data is kept as the database $OLD. When you are sure, remove it with:"
echo "  $C exec db psql -U pharmacy -d postgres -c 'DROP DATABASE $OLD'"
