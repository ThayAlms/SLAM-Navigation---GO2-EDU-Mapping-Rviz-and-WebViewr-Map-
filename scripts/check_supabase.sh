#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_ENV="${FRONTEND_ENV:-$ROOT/frontend/.env.local}"
BACKEND_ENV="${BACKEND_ENV:-$ROOT/backend/.env}"

fail() {
  echo "[ERRO] $*" >&2
  exit 1
}

value_from() {
  local file="$1"
  local key="$2"
  awk -v key="$key" '
    index($0, key "=") == 1 {
      value = substr($0, length(key) + 2)
    }
    END {
      sub(/\r$/, "", value)
      gsub(/^['\"']|['\"']$/, "", value)
      print value
    }
  ' "$file"
}

[[ -f "$FRONTEND_ENV" ]] || fail "Falta frontend/.env.local. Copie frontend/.env.example e preencha o Supabase."
[[ -f "$BACKEND_ENV" ]] || fail "Falta backend/.env. Copie backend/.env.example e preencha o Supabase."

frontend_url="$(value_from "$FRONTEND_ENV" VITE_SUPABASE_URL)"
frontend_key="$(value_from "$FRONTEND_ENV" VITE_SUPABASE_PUBLISHABLE_KEY)"
backend_url="$(value_from "$BACKEND_ENV" SUPABASE_URL)"
backend_key="$(value_from "$BACKEND_ENV" SUPABASE_PUBLISHABLE_KEY)"
service_key="$(value_from "$BACKEND_ENV" SUPABASE_SERVICE_ROLE_KEY)"

[[ "$frontend_url" == https://*.supabase.co ]] || fail "VITE_SUPABASE_URL não contém uma URL real do Supabase."
[[ -n "$frontend_key" && "$frontend_key" != *SUBSTITUA* ]] || fail "VITE_SUPABASE_PUBLISHABLE_KEY não foi configurada."
[[ "$frontend_url" == "$backend_url" ]] || fail "Frontend e backend apontam para projetos Supabase diferentes."
[[ "$frontend_key" == "$backend_key" ]] || fail "Frontend e backend usam chaves públicas diferentes."
[[ -n "$service_key" && "$service_key" != *SUBSTITUA* ]] || fail "SUPABASE_SERVICE_ROLE_KEY não foi configurada no backend."

health_payload="$(
  curl --silent --show-error --fail --max-time 10 \
    -H "apikey: $frontend_key" \
    "$frontend_url/auth/v1/health"
)" || fail "Supabase Auth não respondeu. Verifique URL, chave e internet."
[[ -n "$health_payload" ]] || fail "Supabase Auth respondeu sem conteúdo."

database_headers=(
  -H "apikey: $service_key"
  -H "Accept: application/json"
)
if [[ "$service_key" != sb_secret_* ]]; then
  database_headers+=( -H "Authorization: Bearer $service_key" )
fi

status_payload="$(
  curl --silent --show-error --fail --max-time 10 \
    "${database_headers[@]}" \
    "$backend_url/rest/v1/robot_status?select=robot_id&robot_id=eq.primary&limit=1"
)" || fail "O banco não respondeu ou a service role é inválida."

[[ "$status_payload" == *'"robot_id":"primary"'* ]] ||
  fail "A tabela robot_status/origem primary não existe. Aplique as migrations de supabase/migrations."

for table in profiles login_logs robot_commands oracle_analyses; do
  curl --silent --show-error --fail --max-time 10 \
    "${database_headers[@]}" \
    "$backend_url/rest/v1/$table?select=*&limit=1" >/dev/null ||
    fail "A tabela $table não está acessível com a chave do backend."
done

echo "[OK] Supabase Auth acessível."
echo "[OK] Frontend e backend usam o mesmo projeto e a mesma chave pública."
echo "[OK] As cinco tabelas do banco estão acessíveis e as migrations do Go2 foram aplicadas."
