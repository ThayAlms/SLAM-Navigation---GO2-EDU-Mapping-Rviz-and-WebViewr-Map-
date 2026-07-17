import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent } from "livekit-client";

import { getLiveKitConnection, isLiveKitEnabled } from "./livekit";
import {
  decodeLiveKitPointCloud,
  decodeLiveKitTelemetry,
  POINT_CLOUD_TOPIC,
  TELEMETRY_TOPIC,
} from "./livekitPointCloud";

const CLOUD_VOXEL_SIZE_METERS = 0.035;
const MAX_ACCUMULATED_POINTS = 18_000;

function mergePointCloud(voxels, nextPoints) {
  for (let index = 0; index + 2 < nextPoints.length; index += 3) {
    const x = Number(nextPoints[index]);
    const y = Number(nextPoints[index + 1]);
    const z = Number(nextPoints[index + 2]);
    if (![x, y, z].every(Number.isFinite)) continue;
    const key = `${Math.round(x / CLOUD_VOXEL_SIZE_METERS)}:${Math.round(
      y / CLOUD_VOXEL_SIZE_METERS,
    )}:${Math.round(z / CLOUD_VOXEL_SIZE_METERS)}`;
    voxels.set(key, [x, y, z]);
  }

  while (voxels.size > MAX_ACCUMULATED_POINTS) {
    voxels.delete(voxels.keys().next().value);
  }

  return [...voxels.values()].flat();
}

export function useLiveKitRobot(accessToken) {
  const [room, setRoom] = useState(null);
  const [connectionState, setConnectionState] = useState(
    isLiveKitEnabled ? "connecting" : "disabled",
  );
  const [errorMessage, setErrorMessage] = useState("");
  const [points, setPoints] = useState([]);
  const [telemetry, setTelemetry] = useState(null);
  const latestTelemetryAtRef = useRef(0);
  const previousMapPointCountRef = useRef(0);
  const pointCloudVoxelsRef = useRef(new Map());

  useEffect(() => {
    if (!isLiveKitEnabled || !accessToken) return undefined;

    let active = true;
    const nextRoom = new Room({ adaptiveStream: false });
    const pointCloudVoxels = pointCloudVoxelsRef.current;

    function handleData(payload, _participant, _kind, topic) {
      if (!active) return;

      const decodedPoints = decodeLiveKitPointCloud(payload);
      if (topic === POINT_CLOUD_TOPIC || decodedPoints) {
        if (decodedPoints) {
          setPoints(mergePointCloud(pointCloudVoxels, decodedPoints));
        }
        return;
      }

      const decodedTelemetry = decodeLiveKitTelemetry(payload);
      if (topic === TELEMETRY_TOPIC || decodedTelemetry?.robot_id === "primary") {
        if (!decodedTelemetry) return;
        const capturedAt = Number(decodedTelemetry.captured_at_ms || 0);
        if (latestTelemetryAtRef.current && capturedAt < latestTelemetryAtRef.current) {
          return;
        }
        const nextMapPointCount = Number(decodedTelemetry.point_count || 0);
        const previousMapPointCount = previousMapPointCountRef.current;
        if (
          nextMapPointCount === 0 ||
          (previousMapPointCount > 500 && nextMapPointCount < previousMapPointCount * 0.35)
        ) {
          pointCloudVoxels.clear();
          setPoints([]);
        }
        previousMapPointCountRef.current = nextMapPointCount;
        if (capturedAt) latestTelemetryAtRef.current = capturedAt;
        setTelemetry(decodedTelemetry);
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
        await nextRoom.connect(credentials.serverUrl, credentials.participantToken, {
          autoSubscribe: true,
        });
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
      latestTelemetryAtRef.current = 0;
      previousMapPointCountRef.current = 0;
      pointCloudVoxels.clear();
      nextRoom.removeAllListeners();
      nextRoom.disconnect();
      setRoom(null);
    };
  }, [accessToken]);

  return { room, connectionState, errorMessage, points, telemetry };
}
