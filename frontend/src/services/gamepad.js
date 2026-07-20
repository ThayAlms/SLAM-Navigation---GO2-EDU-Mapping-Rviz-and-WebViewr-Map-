export const GAMEPAD_DEAD_ZONE = 0.14;

function rawAxis(gamepad, index) {
  const value = Number(gamepad?.axes?.[index] || 0);
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}

export function shapeGamepadAxis(value, deadZone = GAMEPAD_DEAD_ZONE) {
  const magnitude = Math.abs(Number(value) || 0);
  if (magnitude <= deadZone) return 0;
  const normalized = Math.min(1, (magnitude - deadZone) / (1 - deadZone));
  const progressive = normalized * (0.35 + 0.65 * normalized * normalized);
  return Math.sign(value) * progressive;
}

export function readGamepadMotion(gamepad) {
  return {
    // O sistema de coordenadas nativo do Go2 usa +x para frente,
    // +y para a esquerda e +yaw no sentido anti-horário.
    forward: shapeGamepadAxis(-rawAxis(gamepad, 1)),
    lateral: shapeGamepadAxis(-rawAxis(gamepad, 0)),
    yaw: shapeGamepadAxis(-rawAxis(gamepad, 2)),
  };
}

export function hasGamepadMotion(vector) {
  return [vector.forward, vector.lateral, vector.yaw]
    .some((value) => Math.abs(value) > 0.0001);
}

export function isGamepadButtonPressed(buttons, index) {
  const button = buttons?.[index];
  return Boolean(button?.pressed || button?.value > 0.5);
}

export function gamepadDisplayName(id = "") {
  const normalized = id.toLowerCase();
  if (normalized.includes("dualsense") || normalized.includes("054c-0ce6")) {
    return "Controle PS5";
  }
  if (normalized.includes("dualshock") || normalized.includes("054c-05c4")) {
    return "Controle PS4";
  }
  if (normalized.includes("xbox") || normalized.includes("xinput")) {
    return "Controle Xbox";
  }
  return id ? "Controle USB" : "Gamepad";
}
