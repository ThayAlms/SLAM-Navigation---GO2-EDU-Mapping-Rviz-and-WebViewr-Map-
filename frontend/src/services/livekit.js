const TOKEN_ENDPOINT =
  import.meta.env.VITE_LIVEKIT_TOKEN_ENDPOINT || "/api/livekit-token";

export const isLiveKitEnabled =
  import.meta.env.VITE_LIVEKIT_ENABLED === "true";

export async function getLiveKitConnection(accessToken) {
  let response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ room_name: "go2-primary" }),
    });
  } catch {
    throw new Error("O servidor de conexão do LiveKit está indisponível.");
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || "Não foi possível obter acesso ao LiveKit.");
  }
  if (!payload?.server_url || !payload?.participant_token) {
    throw new Error("O servidor retornou credenciais LiveKit inválidas.");
  }

  return {
    serverUrl: payload.server_url,
    participantToken: payload.participant_token,
  };
}
