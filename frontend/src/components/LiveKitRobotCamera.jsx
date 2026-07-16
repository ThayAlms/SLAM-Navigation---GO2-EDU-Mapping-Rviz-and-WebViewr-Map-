import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";

import { getLiveKitConnection } from "../services/livekit";

const CONNECTION_LABELS = {
  connected: "Conectado ao LiveKit",
  disconnected: "LiveKit desconectado",
  error: "LiveKit indisponível",
};

function LiveKitRobotCamera({ accessToken }) {
  const videoRef = useRef(null);
  const [connectionState, setConnectionState] = useState("connecting");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!accessToken) return undefined;

    let active = true;
    let attachedTrack = null;
    const room = new Room({ adaptiveStream: true });

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
      setConnectionState("streaming");
    }

    function handleTrackUnsubscribed(track) {
      if (track !== attachedTrack) return;
      detachCurrentTrack();
      setConnectionState("connected");
    }

    room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);
    room.on(RoomEvent.Disconnected, () => {
      if (active) setConnectionState("disconnected");
    });

    async function connect() {
      try {
        const credentials = await getLiveKitConnection(accessToken);
        if (!active) return;
        await room.connect(credentials.serverUrl, credentials.participantToken);
        if (active && !attachedTrack) setConnectionState("connected");
      } catch (error) {
        if (active) {
          setErrorMessage(error.message);
          setConnectionState("error");
        }
      }
    }

    connect();
    return () => {
      active = false;
      detachCurrentTrack();
      room.removeAllListeners();
      room.disconnect();
    };
  }, [accessToken]);

  return (
    <div className="livekit-camera">
      <video
        ref={videoRef}
        className={
          connectionState === "streaming"
            ? "robot-camera-frame"
            : "robot-camera-frame is-waiting"
        }
        autoPlay
        muted
        playsInline
      />

      {connectionState !== "streaming" && (
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
