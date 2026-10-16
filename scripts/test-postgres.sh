#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${PGDATABASE:-}" ]]; then
  echo "Set PGDATABASE to gitatlas_dev or gitatlas_test before running this fixture." >&2
  exit 2
fi

case "$PGDATABASE" in
  gitatlas_dev|gitatlas_test|gitatlas_test_1) ;;
  *)
    echo "Refusing PostgreSQL fixture on database '$PGDATABASE'." >&2
    exit 2
    ;;
esac

psql --no-psqlrc --set=ON_ERROR_STOP=1 <<'SQL'
BEGIN;
CREATE TEMP TABLE gitatlas_test_fixture (
  marker text PRIMARY KEY
) ON COMMIT DROP;
INSERT INTO gitatlas_test_fixture (marker) VALUES ('postgres-fixture-ok');
DO $$
BEGIN
  IF (SELECT count(*) FROM gitatlas_test_fixture WHERE marker = 'postgres-fixture-ok') <> 1 THEN
    RAISE EXCEPTION 'PostgreSQL test fixture did not persist its transaction-local row';
  END IF;
END
$$;
ROLLBACK;
SQL