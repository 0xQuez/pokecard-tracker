#!/usr/bin/env bash
# Verify 004_valuation_share.sql against a real Postgres 16 instance:
# idempotency, token auto-generation, token-gated read, service-role-only rotate.
set -euo pipefail

psql_postgres() { psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres "$@"; }
DB="val_share_t_$$"

echo "== create scratch db: $DB"
psql_postgres -c "CREATE DATABASE $DB;"
psql_postgres -c "CREATE ROLE anon NOLOGIN; CREATE ROLE service_role NOLOGIN;" 2>/dev/null || true

psql_db() { psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$DB" "$@"; }
FAIL=0

echo "== apply 003 (base schema) then 004 twice (idempotency)"
# 003's valuation_requests.card_id is FK -> cards (created by 001/002, which use
# invalid 'CREATE POLICY IF NOT EXISTS' syntax). Provide a minimal cards table so
# the 003/004 migrations can be exercised in isolation.
psql_db -c "CREATE TABLE IF NOT EXISTS public.cards (id bigint generated always as identity primary key);" >/dev/null
for i in 1 2 3 4 5; do
  psql_db -f supabase/migrations/003_valuation_requests.sql >/dev/null
  psql_db -f supabase/migrations/004_valuation_share.sql >/dev/null
done
echo "  applied 003 + 004 five times cleanly (idempotent)"

echo "== seed a request + result (service-role write path)"
psql_db <<'SQL'
WITH req AS (
  INSERT INTO public.valuation_requests (card_query, user_id, status)
  VALUES ('Dragonite ex 90/97', 'Quez', 'done')
  RETURNING id
)
INSERT INTO public.valuation_results (request_id, card_identity, price_points, condition_curve)
SELECT id,
  '{"set":"Dragon","number":"90/97","name":"Dragonite ex"}',
  '[{"source":"ebay","url":"https://ebay.com/itm/1","price":850,"condition_verified":"NM"}]',
  '{"NM":{"estimated_price":850,"sample_count":8}}'
FROM req;
SQL
RES_ID=$(psql_db -t -A -c "SELECT id FROM public.valuation_results LIMIT 1;")
TOK=$(psql_db -t -A -c "SELECT share_token FROM public.valuation_results LIMIT 1;")
echo "  result id=$RES_ID token=$TOK"
test -n "$TOK" || { echo "FAIL: share_token not auto-generated"; FAIL=1; }

echo "== get_valuation_by_share_token returns exactly the matching row"
psql_db -c "SELECT id, share_token FROM public.get_valuation_by_share_token('$TOK');"
GOT=$(psql_db -t -A -c "SELECT count(*) FROM public.get_valuation_by_share_token('$TOK');")
test "$GOT" = "1" || { echo "FAIL: expected 1 row, got $GOT"; FAIL=1; }

echo "== get_valuation_by_share_token with a bogus token returns nothing"
GOT=$(psql_db -t -A -c "SELECT count(*) FROM public.get_valuation_by_share_token('bogus');")
test "$GOT" = "0" || { echo "FAIL: bogus token returned $GOT rows"; FAIL=1; }

echo "== regenerate rotates the token and revokes the old one"
NEW=$(psql_db -t -A -c "SELECT public.regenerate_valuation_share_token($RES_ID);")
echo "  new token=$NEW"
test -n "$NEW" && test "$NEW" != "$TOK" || { echo "FAIL: token did not rotate"; FAIL=1; }
OLD=$(psql_db -t -A -c "SELECT count(*) FROM public.get_valuation_by_share_token('$TOK');")
test "$OLD" = "0" || { echo "FAIL: old token still resolves after rotate"; FAIL=1; }
CUR=$(psql_db -t -A -c "SELECT count(*) FROM public.get_valuation_by_share_token('$NEW');")
test "$CUR" = "1" || { echo "FAIL: new token does not resolve"; FAIL=1; }

echo "== anon can read the share but CANNOT regenerate"
psql_db -c "GRANT USAGE ON SCHEMA public TO anon; GRANT SELECT ON public.valuation_results TO anon; GRANT EXECUTE ON FUNCTION public.get_valuation_by_share_token(text) TO anon; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;" >/dev/null
# anon get (extract just the integer; SET ROLE prints its own command tag)
AS_ANON_GET=$(psql_db -t -A -c "SET ROLE anon; SELECT count(*) FROM public.get_valuation_by_share_token('$NEW');" | grep -E '^[0-9]+$' || true)
test "$AS_ANON_GET" = "1" || { echo "FAIL: anon could not read share (got $AS_ANON_GET)"; FAIL=1; }
echo "  anon token read: ok (1 row)"
# anon must NOT be able to regenerate (EXECUTE not granted)
psql_db -c "SET ROLE anon; SELECT public.regenerate_valuation_share_token($RES_ID); RESET ROLE;" 2>/dev/null \
  && { echo "FAIL: anon was able to regenerate (should be denied)"; FAIL=1; } \
  || echo "  anon regenerate: denied as required"

echo "== unique constraint enforced"
# seed a second result (gets its own auto token), then try to hand it row1's token
psql_db <<'SQL' >/dev/null
INSERT INTO public.valuation_requests (card_query, user_id, status) VALUES ('Second card', 'Quez', 'done');
INSERT INTO public.valuation_results (request_id, card_identity)
SELECT id, '{"name":"Second"}' FROM public.valuation_requests WHERE card_query='Second card';
SQL
RES2=$(psql_db -t -A -c "SELECT r2.id FROM public.valuation_results r2 WHERE r2.id <> $RES_ID ORDER BY r2.id DESC LIMIT 1;")
psql_db -c "UPDATE public.valuation_results SET share_token = '$NEW' WHERE id = $RES2;" >/dev/null 2>&1 \
  && { echo "FAIL: duplicate token allowed (no unique index)"; FAIL=1; } \
  || echo "  duplicate token: rejected"

echo ""
if [ "$FAIL" = "0" ]; then echo "ALL CHECKS PASSED"; else echo "SOME CHECKS FAILED"; fi
psql_postgres -c "DROP DATABASE IF EXISTS $DB;" >/dev/null
exit $FAIL
