import { useEffect, useRef, useState } from "react";
import { RoomEvent, Track } from "livekit-client";

const CONNECTION_LABELS = {
  connected: "Conectado ao LiveKit",
  disconnected: "LiveKit desconectado",
  error: "LiveKit indisponível",
};

function LiveKitRobotCamera({ room, connectionState, errorMessage }) {
  const videoRef = useRef(null);
  const [isStreaming, setIsStreaming] = useState(false);

  useEffect(() => {
    if (!room) return undefined;

    let attachedTrack = null;

    function detachCurrentTrack() {
      if (attachedTrack && videoRef.current) {
        attachedTrack.detach(videoRef.current);
      }
      attachedTrack = null;
    }

    function handleTrackSubscribed(track) {
      if (track.kind !== Track.Kind.Video || !videoRef.current) return;
      detachCurrentTrack();
      attachedTrack = track;
      track.attach(videoRef.current);
      setIsStreaming(true);
    }

    function handleTrackUnsubscribed(track) {
      if (track !== attachedTrack) return;
      detachCurrentTrack();
      setIsStreaming(false);
    }

    room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);

    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        if (publication.track) {
          handleTrackSubscribed(publication.track);
          if (attachedTrack) break;
        }
      }
      if (attachedTrack) break;
    }

    return () => {
      detachCurrentTrack();
      setIsStreaming(false);
      room.off(RoomEvent.TrackSubscribed, handleTrackSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);
    };
  }, [room]);

  return (
    <div className="livekit-camera">
      <video
        ref={videoRef}
        className={
          isStreaming
            ? "robot-camera-frame"
            : "robot-camera-frame is-waiting"
        }
        autoPlay
        muted
        playsInline
      />

      {!isStreaming && (
        <div className="stream-empty">
          <span className="stream-empty-icon">◉</span>
          <strong>
            {CONNECTION_LABELS[connectionState] || "Conectando ao LiveKit"}
          </strong>
          <small>
            {errorMessage ||
              "Aguardando a Jetson publicar a câmera na sala go2-primary."}
          </small>
        </div>
      )}
    </div>
  );
}

export default LiveKitRobotCamera;
