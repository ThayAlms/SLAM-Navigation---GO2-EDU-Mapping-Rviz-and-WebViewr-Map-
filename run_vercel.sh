#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_ENV="$ROOT/backend/.env"
ROOM_NAME="${LIVEKIT_ROOM_NAME:-go2-primary}"
INGRESS_NAME="${GO2_LIVEKIT_INGRESS_NAME:-go2-front-camera}"
VIDEO_TRANSPORT="${LIVEKIT_VIDEO_TRANSPORT:-direct}"
gateway_pid=""
streams_pid=""

value_from() {
  local file="$1"
  local key="$2"
  [[ -f "$file" ]] || return 0
  awk -v key="$key" '
    index($0, key "=") == 1 { value = substr($0, length(key) + 2) }
    END {
      sub(/\r$/, "", value)
      gsub(/^[\047\042]|[\047\042]$/, "", value)
      print value
    }
  ' "$file"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "[ERRO] Comando obrigatório não encontrado: $1" >&2
    exit 1
  }
}

discover_ingress() {
  lk ingress list --room "$ROOM_NAME" --json 2>/dev/null | python3 -c '
import json
import sys

room, name = sys.argv[1:3]
payload = json.load(sys.stdin)
items = payload.get("items", []) if isinstance(payload, dict) else payload
matches = [item for item in items if item.get("roomName") == room]
preferred = next((item for item in matches if item.get("name") == name), None)
selected = preferred or (matches[0] if matches else None)
if not selected or not selected.get("url") or not selected.get("streamKey"):
    raise SystemExit(1)
print(selected["url"], selected["streamKey"])
' "$ROOM_NAME" "$INGRESS_NAME"
}

discover_vercel_url() {
  local remote_url
  remote_url="$(git -C "$ROOT" remote get-url origin 2>/dev/null || true)"
  [[ -n "$remote_url" ]] || return 0

  python3 -c '
import json
import re
import sys
from urllib.request import Request, urlopen

remote = sys.argv[1]
match = re.search(r"github\.com[/:]([^/]+)/([^/]+?)(?:\.git)?$", remote)
if not match:
    raise SystemExit(0)
owner, repository = match.groups()
base = "https://api.github.com/repos/%s/%s" % (owner, repository)
headers = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "go2-vercel-launcher",
}
try:
    request = Request(base + "/deployments?environment=Production&per_page=10", headers=headers)
    with urlopen(request, timeout=8) as response:
        deployments = json.load(response)
    for deployment in deployments:
        request = Request(
            base + "/deployments/%s/statuses?per_page=10" % deployment["id"],
            headers=headers,
        )
        with urlopen(request, timeout=8) as response:
            statuses = json.load(response)
        for status in statuses:
            url = status.get("environment_url")
            if status.get("state") == "success" and url:
                print(url.rstrip("/"))
                raise SystemExit(0)
except Exception:
    pass
' "$remote_url"
}

stop_process() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null || return 0
  kill -INT "$pid" 2>/dev/null || true
  for _ in {1..50}; do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.1
  done
  kill -TERM "$pid" 2>/dev/null || true
}

cleanup() {
  trap - EXIT INT TERM
  if [[ -z "$streams_pid" && -z "$gateway_pid" ]]; then
    return 0
  fi
  echo
  echo "Encerrando conexão do Go2 com a Vercel..."
  stop_process "$streams_pid"
  stop_process "$gateway_pid"
  [[ -n "$streams_pid" ]] && wait "$streams_pid" 2>/dev/null || true
  [[ -n "$gateway_pid" ]] && wait "$gateway_pid" 2>/dev/null || true
}

trap cleanup EXIT
trap 'exit 130' INT TERM

require_command python3
require_command curl
require_command lk
require_command gst-launch-1.0
require_command flock

exec 9>"${XDG_RUNTIME_DIR:-/tmp}/go2-vercel-${UID}.lock"
flock -n 9 || {
  echo "[ERRO] O Go2 já está conectado à Vercel por outro processo." >&2
  exit 1
}

if [[ "$VIDEO_TRANSPORT" == "rtmp" ]] &&
  [[ -z "${LIVEKIT_INGRESS_URL:-}" || -z "${LIVEKIT_STREAM_KEY:-}" ]]; then
  echo "Localizando o Ingress da câmera no LiveKit..."
  ingress_credentials="$(discover_ingress)" || {
    echo "[ERRO] Ingress '$INGRESS_NAME' da sala '$ROOM_NAME' não encontrado." >&2
    echo "       Confirme a autenticação com: lk project list" >&2
    exit 1
  }
  read -r LIVEKIT_INGRESS_URL LIVEKIT_STREAM_KEY <<<"$ingress_credentials"
fi
export LIVEKIT_INGRESS_URL LIVEKIT_STREAM_KEY LIVEKIT_ROOM_NAME="$ROOM_NAME"
export LIVEKIT_VIDEO_TRANSPORT="$VIDEO_TRANSPORT"

if [[ -z "${ROBOT_GATEWAY_API_KEY:-}" ]]; then
  ROBOT_GATEWAY_API_KEY="$(value_from "$BACKEND_ENV" ROBOT_GATEWAY_API_KEY)"
fi
export ROBOT_GATEWAY_API_KEY

if [[ -z "${VERCEL_APP_URL:-}" ]]; then
  VERCEL_APP_URL="$(discover_vercel_url)"
fi
export VERCEL_APP_URL

echo "Iniciando gateway ROS/SLAM e LiDAR..."
"$ROOT/robot_gateway/run_gateway.sh" &
gateway_pid=$!

for _ in {1..80}; do
  if curl --silent --fail http://127.0.0.1:8081/health >/dev/null; then
    break
  fi
  kill -0 "$gateway_pid" 2>/dev/null || {
    echo "[ERRO] O gateway ROS encerrou durante a inicialização." >&2
    exit 1
  }
  sleep 0.25
done
curl --silent --fail http://127.0.0.1:8081/health >/dev/null || {
  echo "[ERRO] O gateway ROS não ficou pronto na porta 8081." >&2
  exit 1
}

echo "Conectando câmera, LiDAR e controles ao LiveKit..."
"$ROOT/robot_gateway/run_livekit_streams.sh" &
streams_pid=$!

sleep 1
kill -0 "$streams_pid" 2>/dev/null || {
  wait "$streams_pid" || true
  echo "[ERRO] Os fluxos LiveKit não iniciaram." >&2
  exit 1
}

echo
echo "============================================================"
echo " Go2 conectado à Vercel"
echo " LiveKit: sala $ROOM_NAME"
if [[ -n "$VERCEL_APP_URL" ]]; then
  echo " Painel:  $VERCEL_APP_URL"
else
  echo " Painel:  informe VERCEL_APP_URL para abrir automaticamente"
fi
echo " LiDAR, câmera e controle remoto estão em execução"
echo " Para parar: Ctrl+C"
echo "============================================================"
echo

if [[ -n "$VERCEL_APP_URL" && "${OPEN_BROWSER:-1}" != "0" ]] &&
   command -v xdg-open >/dev/null 2>&1 &&
   [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
  xdg-open "$VERCEL_APP_URL" >/dev/null 2>&1 &
fi

while kill -0 "$gateway_pid" 2>/dev/null && kill -0 "$streams_pid" 2>/dev/null; do
  sleep 1
done

echo "[ERRO] Um dos serviços encerrou inesperadamente." >&2
exit 1
