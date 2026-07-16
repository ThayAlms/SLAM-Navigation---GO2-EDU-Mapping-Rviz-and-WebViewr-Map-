const API_URL =
  (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/$/, "");
const DEFAULT_ROBOT_ID = "primary";

async function apiRequest(path, { accessToken, ...options } = {}) {
  const responseType = options.responseType || "json";
  delete options.responseType;
  const headers = new Headers(options.headers);
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...options, headers });
  } catch {
    throw new Error("API indisponível. Verifique se o backend está em execução.");
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.detail || "Não foi possível concluir a operação.");
  }

  if (response.status === 204) return null;
  if (responseType === "blob") return response.blob();
  return response.json();
}

export function recordLoginEvent(accessToken) {
  return apiRequest("/api/auth/login-events", {
    method: "POST",
    accessToken,
    body: JSON.stringify({ source: "web" }),
  });
}

export function getRobotStatus(accessToken) {
  return apiRequest("/api/robot/status", { accessToken });
}

export function sendRobotCommand(accessToken, command, payload = {}) {
  return apiRequest("/api/robot/commands", {
    method: "POST",
    accessToken,
    body: JSON.stringify({
      command,
      robot_id: DEFAULT_ROBOT_ID,
      payload,
    }),
  });
}

export function getRobotMap(accessToken) {
  return apiRequest("/api/robot/map/points", { accessToken });
}

export function getRobotCameraFrame(accessToken) {
  return apiRequest("/api/robot/camera/frame", {
    accessToken,
    responseType: "blob",
    cache: "no-store",
  });
}

export function requestOracleAnalysis(accessToken) {
  return apiRequest("/api/oracle/analyses", {
    method: "POST",
    accessToken,
    body: JSON.stringify({ robot_id: DEFAULT_ROBOT_ID }),
  });
}
