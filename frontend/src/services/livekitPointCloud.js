const POINT_CLOUD_MAGIC = [0x47, 0x4f, 0x32, 0x50];
const HEADER_SIZE = 32;

export const POINT_CLOUD_TOPIC = "go2.pointcloud";
export const TELEMETRY_TOPIC = "go2.telemetry";

export function decodeLiveKitPointCloud(payload) {
  if (!(payload instanceof Uint8Array) || payload.byteLength < HEADER_SIZE) {
    return null;
  }
  for (let index = 0; index < POINT_CLOUD_MAGIC.length; index += 1) {
    if (payload[index] !== POINT_CLOUD_MAGIC[index]) return null;
  }

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  if (view.getUint8(4) !== 1) return null;
  const pointCount = view.getUint16(6, true);
  if (HEADER_SIZE + pointCount * 6 !== payload.byteLength) return null;

  const minimum = [0, 1, 2].map((axis) => view.getFloat32(8 + axis * 4, true));
  const scale = [0, 1, 2].map((axis) => view.getFloat32(20 + axis * 4, true));
  const points = new Array(pointCount * 3);
  let offset = HEADER_SIZE;
  for (let index = 0; index < points.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      points[index + axis] =
        minimum[axis] + view.getUint16(offset, true) * scale[axis];
      offset += 2;
    }
  }
  return points;
}

export function decodeLiveKitTelemetry(payload) {
  try {
    return JSON.parse(new TextDecoder().decode(payload));
  } catch {
    return null;
  }
}
