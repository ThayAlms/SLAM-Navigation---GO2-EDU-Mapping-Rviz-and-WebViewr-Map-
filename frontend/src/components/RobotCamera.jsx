import { useEffect, useState } from "react";

import { getRobotCameraFrame } from "../services/api";

const FRAME_INTERVAL_MS = 220;

function RobotCamera({ accessToken, connected }) {
  const [frameUrl, setFrameUrl] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!accessToken || !connected) {
      return undefined;
    }

    let active = true;
    let timerId = null;
    let currentUrl = "";

    async function loadFrame() {
      try {
        const blob = await getRobotCameraFrame(accessToken);
        if (!active) return;
        const nextUrl = URL.createObjectURL(blob);
        if (currentUrl) URL.revokeObjectURL(currentUrl);
        currentUrl = nextUrl;
        setFrameUrl(nextUrl);
        setFailed(false);
      } catch {
        if (active) setFailed(true);
      } finally {
        if (active) timerId = window.setTimeout(loadFrame, FRAME_INTERVAL_MS);
      }
    }

    loadFrame();
    return () => {
      active = false;
      window.clearTimeout(timerId);
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [accessToken, connected]);

  if (!connected || !frameUrl) {
    return (
      <div className="stream-empty">
        <span className="stream-empty-icon">◉</span>
        <strong>{failed ? "Câmera temporariamente indisponível" : "Aguardando câmera"}</strong>
        <small>O quadro aparecerá quando o gateway da Jetson responder.</small>
      </div>
    );
  }

  return (
    <img
      className="robot-camera-frame"
      src={frameUrl}
      alt="Transmissão atual da câmera frontal do Go2"
    />
  );
}

export default RobotCamera;
