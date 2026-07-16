#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

: "${LIVEKIT_INGRESS_URL:?Defina LIVEKIT_INGRESS_URL com a URL RTMP do Ingress}"
: "${LIVEKIT_STREAM_KEY:?Defina LIVEKIT_STREAM_KEY com a chave do Ingress}"
: "${VERCEL_APP_URL:?Defina VERCEL_APP_URL com a URL pública do frontend}"
: "${ROBOT_PUBLISHER_KEY:?Defina ROBOT_PUBLISHER_KEY com a mesma chave da Vercel}"

CAMERA_GROUP="${GO2_CAMERA_GROUP:-230.1.1.1}"
CAMERA_PORT="${GO2_CAMERA_PORT:-1720}"
CAMERA_INTERFACE="${GO2_CAMERA_INTERFACE:-eth0}"
PUBLISH_URL="${LIVEKIT_INGRESS_URL%/}/${LIVEKIT_STREAM_KEY}"
data_pid=""

if gst-inspect-1.0 rtmp2sink >/dev/null 2>&1; then
  RTMP_SINK="rtmp2sink"
elif gst-inspect-1.0 rtmpsink >/dev/null 2>&1; then
  RTMP_SINK="rtmpsink"
else
  echo "[ERRO] Instale um plugin GStreamer com rtmp2sink ou rtmpsink." >&2
  exit 1
fi

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
echo "Nuvem: gateway local → Vercel → sala go2-primary"

gst-launch-1.0 -e \
  udpsrc address="$CAMERA_GROUP" port="$CAMERA_PORT" multicast-iface="$CAMERA_INTERFACE" \
    caps="application/x-rtp,media=video,encoding-name=H264,clock-rate=90000" \
  ! rtph264depay \
  ! h264parse config-interval=-1 \
  ! "video/x-h264,stream-format=avc,alignment=au" \
  ! flvmux streamable=true \
  ! "$RTMP_SINK" location="$PUBLISH_URL" sync=false
