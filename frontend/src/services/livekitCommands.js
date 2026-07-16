export const ROBOT_COMMAND_TOPIC = "go2.command";

const COMMAND_TTL_MS = 5_000;

function requestId() {
  if (typeof window.crypto?.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export async function publishLiveKitCommand(room, userId, command, payload = {}) {
  if (!room || room.state !== "connected") {
    throw new Error("Canal de controle indisponível. Aguarde a conexão com o LiveKit.");
  }
  if (!userId) {
    throw new Error("Sessão do operador inválida.");
  }

  const issuedAt = Date.now();
  const message = {
    type: "go2.command",
    version: 1,
    request_id: requestId(),
    robot_id: "primary",
    user_id: userId,
    command,
    payload,
    issued_at: issuedAt,
    expires_at: issuedAt + COMMAND_TTL_MS,
  };

  await room.localParticipant.publishData(
    new TextEncoder().encode(JSON.stringify(message)),
    { reliable: true, topic: ROBOT_COMMAND_TOPIC },
  );

  return {
    id: message.request_id,
    command,
    status: "accepted",
    transport: "livekit",
  };
}
