import { useCallback, useEffect, useRef, useState } from "react";
import { RoomEvent, Track } from "livekit-client";

const CONNECTION_LABELS = {
  connected: "Conectado ao LiveKit",
  disconnected: "LiveKit desconectado",
  error: "LiveKit indisponível",
};

function LiveKitRobotCamera({ room, connectionState, errorMessage }) {
  const videoRef = useRef(null);
  const attachedTrackRef = useRef(null);
  const [hasVideoTrack, setHasVideoTrack] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [playbackError, setPlaybackError] = useState("");

  const startPlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = true;
    const result = video.play();
    if (result?.catch) {
      result.catch(() => {
        setPlaybackError("Toque para iniciar a imagem da câmera.");
      });
    }
  }, []);

  useEffect(() => {
    if (!room) return undefined;

    function detachCurrentTrack() {
      if (attachedTrackRef.current && videoRef.current) {
        attachedTrackRef.current.detach(videoRef.current);
      }
      attachedTrackRef.current = null;
      setHasVideoTrack(false);
      setIsStreaming(false);
    }

    function handleTrackSubscribed(track) {
      if (track.kind !== Track.Kind.Video || !videoRef.current) return;
      detachCurrentTrack();
      attachedTrackRef.current = track;
      track.attach(videoRef.current);
      setHasVideoTrack(true);
      setPlaybackError("");
      startPlayback();
    }

    function handleTrackUnsubscribed(track) {
      if (track !== attachedTrackRef.current) return;
      detachCurrentTrack();
    }

    function subscribePublication(publication) {
      if (publication.kind !== Track.Kind.Video) return;
      publication.setSubscribed?.(true);
      if (publication.track) handleTrackSubscribed(publication.track);
    }

    function subscribeAvailableCamera() {
      const participants = [...room.remoteParticipants.values()].sort((first) =>
        first.identity === "go2-camera" ? -1 : 0,
      );
      for (const participant of participants) {
        for (const publication of participant.trackPublications.values()) {
          if (publication.kind !== Track.Kind.Video) continue;
          subscribePublication(publication);
          return;
        }
      }
    }

    room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);
    room.on(RoomEvent.TrackPublished, subscribePublication);
    room.on(RoomEvent.ParticipantConnected, subscribeAvailableCamera);
    subscribeAvailableCamera();

    return () => {
      detachCurrentTrack();
      room.off(RoomEvent.TrackSubscribed, handleTrackSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);
      room.off(RoomEvent.TrackPublished, subscribePublication);
      room.off(RoomEvent.ParticipantConnected, subscribeAvailableCamera);
    };
  }, [room, startPlayback]);

  return (
    <div className="livekit-camera" onClick={playbackError ? startPlayback : undefined}>
      <video
        ref={videoRef}
        className={
          hasVideoTrack
            ? "robot-camera-frame"
            : "robot-camera-frame is-waiting"
        }
        autoPlay
        muted
        playsInline
        onCanPlay={startPlayback}
        onPlaying={() => {
          setIsStreaming(true);
          setPlaybackError("");
        }}
        onWaiting={() => setIsStreaming(false)}
        onError={() => {
          setIsStreaming(false);
          setPlaybackError("O navegador não conseguiu reproduzir o vídeo.");
        }}
      />

      {(!hasVideoTrack || playbackError) && (
        <div className="stream-empty">
          <span className="stream-empty-icon">◉</span>
          <strong>
            {playbackError ||
              CONNECTION_LABELS[connectionState] ||
              "Conectando ao LiveKit"}
          </strong>
          <small>
            {playbackError
              ? "Clique nesta área para tentar novamente."
              : errorMessage ||
              "Aguardando a Jetson publicar a câmera na sala go2-primary."}
          </small>
        </div>
      )}

      {hasVideoTrack && !isStreaming && !playbackError && (
        <span className="camera-buffering">Carregando vídeo...</span>
      )}
    </div>
  );
}

export default LiveKitRobotCamera;
