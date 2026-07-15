#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$ROOT/.." && pwd)"

set +u
source "$PROJECT_ROOT/go2_native_ws/setup_go2.sh"
set -u

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8080}"
dashboard_pid=""

stop_process() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null || return 0
  kill -INT "$pid" 2>/dev/null || true
  for _ in {1..30}; do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.1
  done
  kill -TERM "$pid" 2>/dev/null || true
}

cleanup() {
  trap - EXIT INT TERM
  # O painel desarma e envia StopMove durante o encerramento.
  stop_process "$dashboard_pid"
  [[ -n "$dashboard_pid" ]] && wait "$dashboard_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Painel operacional: http://$HOST:$PORT"
echo "O controle começa bloqueado e precisa ser habilitado na página."
echo "SLAM: LIO nativo usando /utlidar/cloud_deskewed + /utlidar/robot_odom + /utlidar/imu."

python3 "$ROOT/server.py" --host "$HOST" --port "$PORT" &
dashboard_pid=$!

wait "$dashboard_pid"
