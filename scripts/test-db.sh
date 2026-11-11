#!/usr/bin/env bash
# One disposable Postgres for validating database changes without Docker.
#
#   scripts/test-db.sh                 apply the migrations, run every pgTAP test
#   scripts/test-db.sh -- <command>    apply the migrations, run <command> with
#                                      DATABASE_URL pointing at the database
#
# It creates a throwaway cluster in a temp directory (about 40 MB), starts it
# on 127.0.0.1 on a free port, and deletes it when the script exits, however it
# exits. It only ever removes the directory it created. Nothing outside that
# directory is touched.
#
# What Supabase provides and Postgres does not is stubbed in
# scripts/test-db-supabase-stub.sql: the anon / authenticated / service_role
# roles, auth.users and auth.uid(). The storage schema is not, so the invoices
# bucket migration and its test are skipped. CI's `supabase start` + `supabase
# test db` (.github/workflows/ci.yml) remains the reference; this script is the
# quick local check that needs no containers.
#
# Needs Postgres 15+ (initdb, pg_ctl, psql) and pgTAP:
#   PG_BIN     directory with initdb, pg_ctl and psql. Default: pg_config's, the
#              PATH, or a Homebrew postgresql@N.
#   PGTAP_SQL  path of pgtap--<version>.sql, when the server has no pgtap
#              extension installed.
#   KEEP_DB=1  leave the cluster running and print its URL (stop it with
#              `pg_ctl -D <dir>/data stop`, then delete <dir>).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
migrations="$root/backend/supabase/migrations"
tests="$root/backend/supabase/tests"
stub="$root/scripts/test-db-supabase-stub.sql"

find_pg_bin() {
  if [ -n "${PG_BIN:-}" ]; then
    echo "$PG_BIN"
  elif command -v pg_config >/dev/null 2>&1; then
    pg_config --bindir
  elif command -v initdb >/dev/null 2>&1; then
    dirname "$(command -v initdb)"
  else
    local candidate
    for candidate in /opt/homebrew/opt/postgresql@*/bin /usr/local/opt/postgresql@*/bin \
      /usr/lib/postgresql/*/bin; do
      if [ -x "$candidate/initdb" ]; then
        echo "$candidate"
      fi
    done | sort -V | tail -n 1
  fi
}

pg_bin="$(find_pg_bin)"
if [ -z "$pg_bin" ] || [ ! -x "$pg_bin/initdb" ]; then
  echo "test-db: no Postgres found; set PG_BIN to a directory with initdb, pg_ctl and psql" >&2
  exit 2
fi

workdir="$(mktemp -d "${TMPDIR:-/tmp}/test-db.XXXXXX")"
port="$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"
url="postgresql://postgres@127.0.0.1:$port/test"

cleanup() {
  local status=$?
  if [ "${KEEP_DB:-}" = 1 ] && [ "$status" -eq 0 ]; then
    echo "test-db: left running: $url (data in $workdir)" >&2
    return
  fi
  "$pg_bin/pg_ctl" -D "$workdir/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$workdir"
}
trap cleanup EXIT

export LC_ALL="${LC_ALL:-en_US.UTF-8}"
"$pg_bin/initdb" -D "$workdir/data" -U postgres --auth=trust --no-sync -E UTF8 >/dev/null
"$pg_bin/pg_ctl" -D "$workdir/data" -l "$workdir/postgres.log" -w \
  -o "-p $port -c listen_addresses=127.0.0.1 -c unix_socket_directories=$workdir -c fsync=off -c synchronous_commit=off" \
  start >/dev/null

psql_run() {
  "$pg_bin/psql" "$url" -X -q -v ON_ERROR_STOP=1 "$@"
}

"$pg_bin/createdb" -h 127.0.0.1 -p "$port" -U postgres test
psql_run -c 'alter database test set search_path = "$user", public, extensions'
psql_run -f "$stub"

# pgTAP: the server's extension if it has one, else the SQL file.
if ! psql_run -c 'create extension if not exists pgtap with schema extensions' 2>/dev/null; then
  if [ -z "${PGTAP_SQL:-}" ] || [ ! -f "$PGTAP_SQL" ]; then
    echo "test-db: this Postgres has no pgtap extension; set PGTAP_SQL to pgtap--<version>.sql" >&2
    exit 2
  fi
  # The file creates its own schema line; pgTAP lives in `extensions` here.
  sed 's/^CREATE SCHEMA.*//' "$PGTAP_SQL" |
    psql_run -c 'set search_path = extensions' -f - >/dev/null
fi

for migration in $(ls "$migrations"/*.sql | sort); do
  case "$migration" in
    *invoices_bucket*) continue ;; # needs Supabase's storage schema
  esac
  psql_run -f "$migration" || {
    echo "test-db: migration failed: $migration" >&2
    exit 1
  }
  # Supabase records each applied migration; a test replays one from there.
  file_name="$(basename "$migration" .sql)"
  echo "insert into supabase_migrations.schema_migrations
    values (:'version', :'name', array[:'statements'])" |
    psql_run -v version="${file_name%%_*}" -v name="${file_name#*_}" \
      -v statements="$(cat "$migration")" -f -
done
echo "test-db: migrations applied" >&2

if [ "${1:-}" = "--" ]; then
  shift
  if [ "$#" -eq 0 ]; then
    echo "test-db: nothing to run after --" >&2
    exit 2
  fi
  DATABASE_URL="$url" "$@"
  exit $?
fi

failed=0
for test_file in $(ls "$tests"/*.test.sql | sort); do
  case "$test_file" in
    *invoices_bucket*) continue ;; # needs Supabase's storage schema
  esac
  name="$(basename "$test_file")"
  # psql's own errors go to stderr; TAP goes to stdout.
  if output="$("$pg_bin/psql" "$url" -X -q -t -A -f "$test_file" 2>&1)"; then
    :
  else
    failed=1
  fi
  if printf '%s\n' "$output" | grep -qE '^(not ok|# Looks like|ERROR|psql:)'; then
    failed=1
    printf '%s\n' "$output" |
      grep -E '^(not ok|#|psql:|ERROR|DETAIL|HINT|CONTEXT|LINE|[0-9]+\.\.[0-9]+)' | head -n 20 | sed 's/^/  /'
    echo "FAIL $name"
  else
    passed="$(printf '%s\n' "$output" | grep -cE '^ok ' || true)"
    echo "ok   $name ($passed tests)"
  fi
done
exit "$failed"
