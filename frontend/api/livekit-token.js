import { randomUUID } from "node:crypto";

import { AccessToken } from "livekit-server-sdk";

const DEFAULT_ROOM_NAME = "go2-primary";
const TOKEN_TTL = "10m";

function sendError(response, status, message) {
  response.status(status).json({ error: message });
}

function getBearerToken(request) {
  const authorization = request.headers.authorization || "";
  if (!authorization.startsWith("Bearer ")) return "";
  return authorization.slice("Bearer ".length).trim();
}

async function getSupabaseUser(accessToken) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const publishableKey =
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !publishableKey) {
    throw new Error("Supabase não configurado na Function da Vercel.");
  }

  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) return null;
  return response.json();
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendError(response, 405, "Método não permitido.");
    return;
  }

  response.setHeader("Cache-Control", "no-store");

  const livekitUrl = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!livekitUrl || !apiKey || !apiSecret) {
    sendError(response, 503, "LiveKit ainda não foi configurado na Vercel.");
    return;
  }

  const accessToken = getBearerToken(request);
  if (!accessToken) {
    sendError(response, 401, "Sessão necessária.");
    return;
  }

  try {
    const user = await getSupabaseUser(accessToken);
    if (!user?.id) {
      sendError(response, 401, "Sessão inválida.");
      return;
    }

    const roomName = process.env.LIVEKIT_ROOM_NAME || DEFAULT_ROOM_NAME;
    const participantIdentity = `${user.id}-${randomUUID().slice(0, 8)}`;
    const token = new AccessToken(apiKey, apiSecret, {
      identity: participantIdentity,
      name: user.email || "Operador XD4",
      metadata: JSON.stringify({ user_id: user.id }),
      ttl: TOKEN_TTL,
    });
    token.addGrant({
      roomJoin: true,
      room: roomName,
      canSubscribe: true,
      canPublish: false,
      canPublishData: false,
    });

    response.status(201).json({
      server_url: livekitUrl,
      participant_token: await token.toJwt(),
    });
  } catch (error) {
    console.error("Falha ao emitir token do LiveKit.", error);
    sendError(response, 500, "Não foi possível conectar ao LiveKit.");
  }
}
