#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

: "${LIVEKIT_INGRESS_URL:?Defina LIVEKIT_INGRESS_URL com a URL RTMP do Ingress}"
: "${LIVEKIT_STREAM_KEY:?Defina LIVEKIT_STREAM_KEY com a chave do Ingress}"

CAMERA_GROUP="${GO2_CAMERA_GROUP:-230.1.1.1}"
CAMERA_PORT="${GO2_CAMERA_PORT:-1720}"
CAMERA_INTERFACE="${GO2_CAMERA_INTERFACE:-eth0}"
PUBLISH_URL="${LIVEKIT_INGRESS_URL%/}/${LIVEKIT_STREAM_KEY}"
data_pid=""

FFMPEG_BIN="${FFMPEG_BIN:-$(command -v ffmpeg || true)}"
if [[ -z "$FFMPEG_BIN" && -x /home/unitree/.local/bin/ffmpeg ]]; then
  FFMPEG_BIN=/home/unitree/.local/bin/ffmpeg
fi
if [[ -z "$FFMPEG_BIN" ]]; then
  echo "[ERRO] FFmpeg não encontrado. Instale com: sudo apt install -y ffmpeg" >&2
  exit 1
fi
command -v lk >/dev/null || {
  echo "[ERRO] LiveKit CLI (lk) não encontrado." >&2
  exit 1
}

cleanup() {
  trap - EXIT INT TERM
  if [[ -n "$data_pid" ]] && kill -0 "$data_pid" 2>/dev/null; then
    kill -TERM "$data_pid" 2>/dev/null || true
    wait "$data_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

python3 "$ROOT/livekit_data_publisher.py" &
data_pid=$!

echo "Câmera: RTP/H264 $CAMERA_GROUP:$CAMERA_PORT ($CAMERA_INTERFACE) → LiveKit"
echo "Nuvem: gateway local → LiveKit CLI → sala go2-primary"

gst-launch-1.0 -q -e \
  udpsrc address="$CAMERA_GROUP" port="$CAMERA_PORT" multicast-iface="$CAMERA_INTERFACE" \
    caps="application/x-rtp,media=video,encoding-name=H264,clock-rate=90000" \
  ! rtph264depay \
  ! h264parse config-interval=-1 \
  ! "video/x-h264,stream-format=avc,alignment=au" \
  ! flvmux streamable=true \
  ! fdsink fd=1 \
  | "$FFMPEG_BIN" -hide_banner -loglevel warning -fflags nobuffer \
      -f flv -i pipe:0 -map 0:v:0 -c:v copy -an -f flv "$PUBLISH_URL"
