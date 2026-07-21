#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

CAMERA_GROUP="${GO2_CAMERA_GROUP:-230.1.1.1}"
CAMERA_PORT="${GO2_CAMERA_PORT:-1720}"
CAMERA_INTERFACE="${GO2_CAMERA_INTERFACE:-eth0}"
ROOM_NAME="${LIVEKIT_ROOM_NAME:-go2-primary}"
VIDEO_TRANSPORT="${LIVEKIT_VIDEO_TRANSPORT:-direct}"
VIDEO_BITRATE="${LIVEKIT_VIDEO_BITRATE:-900000}"
VIDEO_WIDTH="${LIVEKIT_VIDEO_WIDTH:-960}"
VIDEO_HEIGHT="${LIVEKIT_VIDEO_HEIGHT:-540}"
VIDEO_FPS="${LIVEKIT_VIDEO_FPS:-30}"
VIDEO_IDR_INTERVAL="${LIVEKIT_VIDEO_IDR_INTERVAL:-15}"
VIDEO_VBV_SIZE="${LIVEKIT_VIDEO_VBV_SIZE:-$((VIDEO_BITRATE / VIDEO_FPS))}"
VIDEO_TCP_HOST="${LIVEKIT_VIDEO_TCP_HOST:-127.0.0.1}"
VIDEO_TCP_PORT="${LIVEKIT_VIDEO_TCP_PORT:-5010}"
data_pid=""
command_pid=""
video_pipeline_pid=""
video_publisher_pid=""

command -v lk >/dev/null || {
  echo "[ERRO] LiveKit CLI (lk) não encontrado." >&2
  exit 1
}

cleanup() {
  trap - EXIT INT TERM
  if [[ -n "$video_publisher_pid" ]] && kill -0 "$video_publisher_pid" 2>/dev/null; then
    kill -TERM "$video_publisher_pid" 2>/dev/null || true
    wait "$video_publisher_pid" 2>/dev/null || true
  fi
  if [[ -n "$video_pipeline_pid" ]] && kill -0 "$video_pipeline_pid" 2>/dev/null; then
    kill -TERM "$video_pipeline_pid" 2>/dev/null || true
    wait "$video_pipeline_pid" 2>/dev/null || true
  fi
  if [[ -n "$data_pid" ]] && kill -0 "$data_pid" 2>/dev/null; then
    kill -TERM "$data_pid" 2>/dev/null || true
    wait "$data_pid" 2>/dev/null || true
  fi
  if [[ -n "$command_pid" ]] && kill -0 "$command_pid" 2>/dev/null; then
    kill -TERM "$command_pid" 2>/dev/null || true
    wait "$command_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

python3 "$ROOT/livekit_data_publisher.py" \
  --max-points "${LIVEKIT_MAX_POINTS:-1500}" &
data_pid=$!
python3 "$ROOT/livekit_command_receiver.py" &
command_pid=$!

echo "Câmera: RTP/H264 $CAMERA_GROUP:$CAMERA_PORT ($CAMERA_INTERFACE) → LiveKit"
echo "Nuvem: gateway local → LiveKit CLI → sala go2-primary"
echo "Controle: painel Vercel → LiveKit → gateway local"

if [[ "$VIDEO_TRANSPORT" == "direct" ]]; then
  echo "Vídeo: WebRTC direto, ${VIDEO_WIDTH}x${VIDEO_HEIGHT}, ${VIDEO_BITRATE} bps"
  gst-launch-1.0 -q -e \
    udpsrc address="$CAMERA_GROUP" port="$CAMERA_PORT" multicast-iface="$CAMERA_INTERFACE" \
      caps="application/x-rtp,media=video,encoding-name=H264,clock-rate=90000" \
    ! rtph264depay \
    ! h264parse \
    ! nvv4l2decoder \
    ! nvvidconv \
    ! "video/x-raw(memory:NVMM),format=NV12,width=$VIDEO_WIDTH,height=$VIDEO_HEIGHT" \
    ! nvv4l2h264enc bitrate="$VIDEO_BITRATE" control-rate=1 \
        iframeinterval="$VIDEO_IDR_INTERVAL" idrinterval="$VIDEO_IDR_INTERVAL" \
        insert-sps-pps=true maxperf-enable=true num-B-Frames=0 \
        vbv-size="$VIDEO_VBV_SIZE" \
    ! h264parse config-interval=-1 \
    ! "video/x-h264,stream-format=byte-stream,alignment=au" \
    ! tcpserversink host="$VIDEO_TCP_HOST" port="$VIDEO_TCP_PORT" \
        sync=false async=false sync-method=latest-keyframe \
        unit-format=buffers units-max=30 units-soft-max=15 recover-policy=keyframe &
  video_pipeline_pid=$!

  sleep 1
  kill -0 "$video_pipeline_pid" 2>/dev/null || {
    wait "$video_pipeline_pid" || true
    echo "[ERRO] O pipeline H.264 direto não iniciou." >&2
    exit 1
  }

  lk --quiet room join \
    --identity go2-camera \
    --publish "h264://$VIDEO_TCP_HOST:$VIDEO_TCP_PORT" \
    --fps "$VIDEO_FPS" \
    --exit-after-publish \
    "$ROOM_NAME" >/dev/null 2>&1 &
  video_publisher_pid=$!

  while kill -0 "$video_pipeline_pid" 2>/dev/null &&
    kill -0 "$video_publisher_pid" 2>/dev/null; do
    sleep 1
  done
  echo "[ERRO] A publicação WebRTC direta da câmera foi interrompida." >&2
  exit 1
fi

if [[ "$VIDEO_TRANSPORT" != "rtmp" ]]; then
  echo "[ERRO] LIVEKIT_VIDEO_TRANSPORT deve ser 'direct' ou 'rtmp'." >&2
  exit 1
fi

: "${LIVEKIT_INGRESS_URL:?Defina LIVEKIT_INGRESS_URL com a URL RTMP do Ingress}"
: "${LIVEKIT_STREAM_KEY:?Defina LIVEKIT_STREAM_KEY com a chave do Ingress}"
FFMPEG_BIN="${FFMPEG_BIN:-$(command -v ffmpeg || true)}"
if [[ -z "$FFMPEG_BIN" && -x /home/unitree/.local/bin/ffmpeg ]]; then
  FFMPEG_BIN=/home/unitree/.local/bin/ffmpeg
fi
if [[ -z "$FFMPEG_BIN" ]]; then
  echo "[ERRO] FFmpeg não encontrado. Instale com: sudo apt install -y ffmpeg" >&2
  exit 1
fi
PUBLISH_URL="${LIVEKIT_INGRESS_URL%/}/${LIVEKIT_STREAM_KEY}"
echo "Vídeo: fallback RTMP/TCP para $ROOM_NAME"

gst-launch-1.0 -q -e \
  udpsrc address="$CAMERA_GROUP" port="$CAMERA_PORT" multicast-iface="$CAMERA_INTERFACE" \
    caps="application/x-rtp,media=video,encoding-name=H264,clock-rate=90000" \
  ! rtph264depay \
  ! h264parse \
  ! nvv4l2decoder \
  ! nvvidconv \
  ! "video/x-raw(memory:NVMM),format=NV12,width=$VIDEO_WIDTH,height=$VIDEO_HEIGHT" \
  ! nvv4l2h264enc bitrate="$VIDEO_BITRATE" control-rate=1 \
      iframeinterval="$VIDEO_IDR_INTERVAL" idrinterval="$VIDEO_IDR_INTERVAL" \
      insert-sps-pps=true maxperf-enable=true num-B-Frames=0 \
      vbv-size="$VIDEO_VBV_SIZE" \
  ! h264parse config-interval=-1 \
  ! "video/x-h264,stream-format=avc,alignment=au" \
  ! flvmux streamable=true \
  ! fdsink fd=1 \
  | "$FFMPEG_BIN" -hide_banner -loglevel warning -fflags nobuffer \
      -f flv -i pipe:0 -map 0:v:0 -c:v copy -an \
      -rw_timeout "${LIVEKIT_RTMP_TIMEOUT_US:-15000000}" \
      -f flv "$PUBLISH_URL"
