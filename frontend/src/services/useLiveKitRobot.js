import { useEffect, useState } from "react";
import { Room, RoomEvent } from "livekit-client";

import { getLiveKitConnection, isLiveKitEnabled } from "./livekit";
import {
  decodeLiveKitPointCloud,
  decodeLiveKitTelemetry,
  POINT_CLOUD_TOPIC,
  TELEMETRY_TOPIC,
} from "./livekitPointCloud";

export function useLiveKitRobot(accessToken) {
  const [room, setRoom] = useState(null);
  const [connectionState, setConnectionState] = useState(
    isLiveKitEnabled ? "connecting" : "disabled",
  );
  const [errorMessage, setErrorMessage] = useState("");
  const [points, setPoints] = useState([]);
  const [telemetry, setTelemetry] = useState(null);

  useEffect(() => {
    if (!isLiveKitEnabled || !accessToken) return undefined;

    let active = true;
    const nextRoom = new Room({ adaptiveStream: true });

    function handleData(payload, _participant, _kind, topic) {
      if (!active) return;

      const decodedPoints = decodeLiveKitPointCloud(payload);
      if (topic === POINT_CLOUD_TOPIC || decodedPoints) {
        if (decodedPoints) setPoints(decodedPoints);
        return;
      }

      const decodedTelemetry = decodeLiveKitTelemetry(payload);
      if (topic === TELEMETRY_TOPIC || decodedTelemetry?.robot_id === "primary") {
        if (decodedTelemetry) setTelemetry(decodedTelemetry);
      }
    }

    nextRoom.on(RoomEvent.DataReceived, handleData);
    nextRoom.on(RoomEvent.Disconnected, () => {
      if (active) setConnectionState("disconnected");
    });
    nextRoom.on(RoomEvent.Reconnecting, () => {
      if (active) setConnectionState("connecting");
    });
    nextRoom.on(RoomEvent.Reconnected, () => {
      if (active) setConnectionState("connected");
    });

    async function connect() {
      try {
        const credentials = await getLiveKitConnection(accessToken);
        if (!active) return;
        setConnectionState("connecting");
        setErrorMessage("");
        await nextRoom.connect(credentials.serverUrl, credentials.participantToken);
        if (active) {
          setRoom(nextRoom);
          setConnectionState("connected");
        }
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
      nextRoom.removeAllListeners();
      nextRoom.disconnect();
      setRoom(null);
    };
  }, [accessToken]);

  return { room, connectionState, errorMessage, points, telemetry };
}
