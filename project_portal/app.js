const state = {
  armed: false,
  holding: null,
  commandTimer: null,
  points: [],
  pose: null,
  poseHeading: 0,
  nextPosture: "stand_up",
  posture: "unknown",
  yaw: -0.65,
  pitch: -0.55,
  zoom: 1,
  dragging: false,
  lastPointer: null,
  apiOnline: false,
  speedPercent: 30,
  speedMin: 10,
  speedMax: 50,
  speedStep: 5,
};

const $ = (selector) => document.querySelector(selector);
const canvas = $("#mapCanvas");
const ctx = canvas.getContext("2d", { alpha: true });
const driveButtons = [...document.querySelectorAll(".drive")];
const postureButtons = [...document.querySelectorAll(".posture")];
const postureToggle = $("#postureToggle");
let canvasWidth = 0;
let canvasHeight = 0;
let toastTimer = null;

function toast(message, error = false) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.toggle("error", error);
  element.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("show"), 2800);
}

async function api(path, options = {}) {
  const config = { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } };
  const response = await fetch(path, config);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || `Falha HTTP ${response.status}`);
  return data;
}

function setArmed(armed) {
  state.armed = armed;
  refreshControlAvailability();
  if (!armed) stopMotion();
}

function refreshControlAvailability() {
  const button = $("#armControl");
  const canDrive = state.armed && state.posture === "standing";
  button.classList.toggle("armed", state.armed);
  button.setAttribute("aria-pressed", String(state.armed));
  button.querySelector("strong").textContent = state.armed ? "CONTROLE HABILITADO" : "CONTROLE BLOQUEADO";
  button.querySelector("small").textContent = !state.armed
    ? "Clique para habilitar o teclado"
    : canDrive ? "W/S para andar · A/D para girar" : "Robô deitado · use LEVANTAR";
  driveButtons.filter((item) => item.dataset.command !== "stop").forEach((item) => { item.disabled = !canDrive; });
  postureButtons.forEach((item) => { item.disabled = !state.armed; });
}

async function toggleArm() {
  const desired = !state.armed;
  try {
    await api("/api/control/arm", { method: "POST", body: JSON.stringify({ armed: desired }) });
    setArmed(desired);
    toast(desired ? "Controle habilitado. Mantenha a área livre." : "Controle bloqueado.");
  } catch (error) {
    toast(error.message, true);
  }
}

const labels = {
  forward: "AVANÇANDO",
  backward: "RECUANDO DEVAGAR",
  rotate_left: "GIRANDO À ESQUERDA",
  rotate_right: "GIRANDO À DIREITA",
  stop: "PARADO",
};

async function sendCommand(command) {
  if (command !== "stop" && !state.armed) return;
  try {
    await api("/api/control/move", { method: "POST", body: JSON.stringify({ command }) });
    $("#activeCommand").textContent = labels[command] || command.toUpperCase();
    $("#activeCommand").classList.toggle("moving", command !== "stop");
  } catch (error) {
    toast(error.message, true);
    stopMotion(false);
  }
}

function beginMotion(command, button) {
  if (!state.armed && command !== "stop") return;
  stopMotion(false);
  state.holding = command;
  button?.classList.add("active");
  sendCommand(command);
  if (command !== "stop") state.commandTimer = setInterval(() => sendCommand(command), 140);
}

function stopMotion(send = true) {
  clearInterval(state.commandTimer);
  state.commandTimer = null;
  state.holding = null;
  driveButtons.forEach((button) => button.classList.remove("active"));
  $("#activeCommand").textContent = "PARADO";
  $("#activeCommand").classList.remove("moving");
  if (send) sendCommand("stop");
}

driveButtons.forEach((button) => {
  const command = button.dataset.command;
  button.addEventListener("pointerdown", (event) => { event.preventDefault(); beginMotion(command, button); });
  button.addEventListener("pointerup", () => stopMotion());
  button.addEventListener("pointercancel", () => stopMotion());
  button.addEventListener("pointerleave", () => { if (state.holding === command) stopMotion(); });
});

async function sendPosture(command, button) {
  if (!state.armed || button.disabled) return;
  stopMotion(false);
  postureButtons.forEach((item) => { item.disabled = true; });
  button.classList.add("active");
  const requested = command === "toggle" ? state.nextPosture : command;
  const standingUp = requested === "stand_up";
  $("#activeCommand").textContent = standingUp ? "LEVANTANDO" : "DEITANDO";
  $("#activeCommand").classList.add("moving");
  try {
    const result = await api("/api/control/posture", {
      method: "POST",
      body: JSON.stringify({ command }),
    });
    const actual = result.command || requested;
    state.nextPosture = actual === "stand_up" ? "stand_down" : "stand_up";
    toast(actual === "stand_up" ? "Comando para levantar enviado." : "Comando para deitar enviado.");
  } catch (error) {
    toast(error.message, true);
    refreshControlAvailability();
  } finally {
    setTimeout(() => {
      button.classList.remove("active");
      if (state.armed) postureButtons.forEach((item) => { item.disabled = false; });
      $("#activeCommand").textContent = "PARADO";
      $("#activeCommand").classList.remove("moving");
      refreshControlAvailability();
    }, 4000);
  }
}

postureButtons.forEach((button) => {
  if (button.dataset.posture) {
    button.addEventListener("click", () => sendPosture(button.dataset.posture, button));
  }
});
postureToggle.addEventListener("click", () => sendPosture("toggle", postureToggle));

const keyCommands = {
  ArrowUp: "forward", w: "forward",
  ArrowDown: "backward", s: "backward",
  ArrowLeft: "rotate_left", a: "rotate_left",
  ArrowRight: "rotate_right", d: "rotate_right",
  " ": "stop",
};

function normalizedKey(event) {
  return event.key.length === 1 ? event.key.toLowerCase() : event.key;
}

window.addEventListener("keydown", (event) => {
  if (event.repeat) return;
  const key = normalizedKey(event);
  const command = keyCommands[key];
  if (!command) return;
  event.preventDefault();
  beginMotion(command, document.querySelector(`[data-command="${command}"]`));
});
window.addEventListener("keyup", (event) => { if (keyCommands[normalizedKey(event)]) stopMotion(); });
window.addEventListener("blur", () => stopMotion());
document.addEventListener("visibilitychange", () => { if (document.hidden) stopMotion(); });

$("#armControl").addEventListener("click", toggleArm);
$("#emergencyStop").addEventListener("click", async () => {
  stopMotion(false);
  try { await api("/api/control/stop", { method: "POST", body: "{}" }); } catch (_) { /* watchdog remains active */ }
  setArmed(false);
  toast("PARADA DE EMERGÊNCIA ENVIADA", true);
});

$("#newMap").addEventListener("click", async () => {
  if (!confirm("Limpar o mapa atual e iniciar um novo mapeamento?")) return;
  try {
    await api("/api/map/reset", { method: "POST", body: "{}" });
    state.points = [];
    toast("Novo mapa iniciado.");
  } catch (error) { toast(error.message, true); }
});

$("#saveMap").addEventListener("click", async () => {
  const button = $("#saveMap");
  button.disabled = true;
  button.textContent = "SALVANDO…";
  try {
    const result = await api("/api/map/save", { method: "POST", body: "{}" });
    toast(`Mapa salvo · ${Number(result.point_count).toLocaleString("pt-BR")} pontos`);
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; button.textContent = "SALVAR MAPA"; }
});

function formatDuration(seconds) {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function quaternionYaw(pose) {
  if (!pose) return 0;
  const siny = 2 * (pose.qw * pose.qz + pose.qx * pose.qy);
  const cosy = 1 - 2 * (pose.qy * pose.qy + pose.qz * pose.qz);
  return Math.atan2(siny, cosy);
}

function formatCoordinate(value) {
  return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(2)} m` : "--";
}

function decimal(value) {
  return Number(value || 0).toFixed(2).replace(".", ",");
}

function renderSpeed(status = {}) {
  state.speedPercent = Number(status.speed_limit_percent ?? state.speedPercent);
  state.speedMin = Number(status.speed_min_percent ?? state.speedMin);
  state.speedMax = Number(status.speed_max_percent ?? state.speedMax);
  state.speedStep = Number(status.speed_step_percent ?? state.speedStep);
  $("#speedValue").textContent = `${state.speedPercent}%`;
  $("#speedLimit").textContent = `LIMITE · ${state.speedPercent}%`;
  $("#speedDown").disabled = state.speedPercent <= state.speedMin;
  $("#speedUp").disabled = state.speedPercent >= state.speedMax;
  if (Number.isFinite(Number(status.linear_speed_mps))) {
    $("#speedReadout").textContent = `W ${decimal(status.linear_speed_mps)} · S ${decimal(status.reverse_speed_mps)} m/s`;
    $("#yawReadout").textContent = `${decimal(status.yaw_speed_radps)} rad/s`;
  }
}

async function changeSpeed(direction) {
  const desired = Math.max(
    state.speedMin,
    Math.min(state.speedMax, state.speedPercent + direction * state.speedStep),
  );
  if (desired === state.speedPercent) return;
  stopMotion();
  $("#speedDown").disabled = true;
  $("#speedUp").disabled = true;
  try {
    const result = await api("/api/control/speed", {
      method: "POST",
      body: JSON.stringify({ percent: desired }),
    });
    renderSpeed({ speed_limit_percent: result.speed_percent });
    toast(`Velocidade ajustada para ${result.speed_percent}%.`);
  } catch (error) {
    toast(error.message, true);
  } finally {
    renderSpeed();
  }
}

$("#speedDown").addEventListener("click", () => changeSpeed(-1));
$("#speedUp").addEventListener("click", () => changeSpeed(1));

async function updateStatus() {
  try {
    const status = await api("/api/status");
    state.apiOnline = true;
    const connected = status.robot_connected && status.lio_connected;
    const connection = $("#connectionState");
    connection.classList.toggle("online", connected);
    connection.querySelector("span").textContent = connected ? "Go2 conectado · DDS ativo" : "Aguardando sensores…";
    $("#lidarState").classList.toggle("online", status.lio_connected);
    $("#cameraState").classList.toggle("online", status.camera_connected);
    $("#pointCount").textContent = Number(status.point_count || 0).toLocaleString("pt-BR");
    $("#mappingTime").textContent = formatDuration(status.elapsed_seconds);
    renderSpeed(status);
    state.pose = status.current_pose || null;
    state.poseHeading = quaternionYaw(state.pose);
    const location = status.current_location;
    $("#poseX").textContent = formatCoordinate(location?.x);
    $("#poseY").textContent = formatCoordinate(location?.y);
    $("#poseZ").textContent = formatCoordinate(location?.z);
    $("#poseYaw").textContent = Number.isFinite(location?.yaw_deg) ? `${location.yaw_deg.toFixed(1)}°` : "--";
    state.posture = status.posture || "unknown";
    if (status.posture === "standing" || status.posture === "transitioning_up") state.nextPosture = "stand_down";
    if (status.posture === "lying" || status.posture === "transitioning_down") state.nextPosture = "stand_up";
    if (state.armed !== status.control_armed) setArmed(Boolean(status.control_armed));
    else refreshControlAvailability();
  } catch (_) {
    state.apiOnline = false;
    $("#connectionState").classList.remove("online");
    $("#connectionState span").textContent = "Backend desconectado";
    setArmed(false);
    state.pose = null;
    ["#poseX", "#poseY", "#poseZ", "#poseYaw"].forEach((selector) => { $(selector).textContent = "--"; });
  }
}

async function updatePoints() {
  try {
    const payload = await api("/api/map/points");
    state.points = payload.points || [];
    $("#mapEmpty").classList.toggle("hidden", state.points.length > 0);
  } catch (_) { /* status loop reports disconnect */ }
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvasWidth = rect.width;
  canvasHeight = rect.height;
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function drawMap() {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  const flat = state.points;
  if (flat.length >= 3) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < flat.length; i += 3) {
      minX = Math.min(minX, flat[i]); maxX = Math.max(maxX, flat[i]);
      minY = Math.min(minY, flat[i + 1]); maxY = Math.max(maxY, flat[i + 1]);
    }
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const extent = Math.max(maxX - minX, maxY - minY, 2);
    const baseScale = Math.min(canvasWidth, canvasHeight) * 0.78 / extent * state.zoom;
    const cosY = Math.cos(state.yaw), sinY = Math.sin(state.yaw);
    const cosP = Math.cos(state.pitch), sinP = Math.sin(state.pitch);
    const projected = [];

    const project = (worldX, worldY, worldZ) => {
      const x = worldX - centerX, y = worldY - centerY, z = worldZ;
      const rx = x * cosY - y * sinY;
      const ry = x * sinY + y * cosY;
      const py = ry * cosP - z * sinP;
      const depth = ry * sinP + z * cosP;
      return { x: canvasWidth / 2 + rx * baseScale, y: canvasHeight / 2 - py * baseScale, z, depth };
    };

    for (let i = 0; i < flat.length; i += 3) {
      projected.push(project(flat[i], flat[i + 1], flat[i + 2]));
    }
    projected.sort((a, b) => a.depth - b.depth);
    for (const point of projected) {
      const heightMix = Math.max(0, Math.min(1, (point.z + .4) / 2.4));
      const r = Math.round(56 + heightMix * 183), g = Math.round(181 + heightMix * 67), b = Math.round(229 - heightMix * 135);
      ctx.fillStyle = `rgba(${r},${g},${b},.82)`;
      ctx.fillRect(point.x, point.y, 1.7, 1.7);
    }
    if (state.pose) {
      const robot = project(state.pose.x, state.pose.y, state.pose.z);
      const heading = project(
        state.pose.x + Math.cos(state.poseHeading) * 0.35,
        state.pose.y + Math.sin(state.poseHeading) * 0.35,
        state.pose.z,
      );
      ctx.strokeStyle = "#eaff4f";
      ctx.fillStyle = "#eaff4f";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(robot.x, robot.y);
      ctx.lineTo(heading.x, heading.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(robot.x, robot.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "700 8px SFMono-Regular, Consolas, monospace";
      ctx.fillText("GO2", robot.x + 8, robot.y - 7);
    }
  }
  requestAnimationFrame(drawMap);
}

const mapView = $("#mapView");
mapView.addEventListener("pointerdown", (event) => { state.dragging = true; state.lastPointer = { x: event.clientX, y: event.clientY }; mapView.setPointerCapture(event.pointerId); });
mapView.addEventListener("pointermove", (event) => {
  if (!state.dragging) return;
  state.yaw += (event.clientX - state.lastPointer.x) * .008;
  state.pitch = Math.max(-1.35, Math.min(.1, state.pitch + (event.clientY - state.lastPointer.y) * .006));
  state.lastPointer = { x: event.clientX, y: event.clientY };
});
mapView.addEventListener("pointerup", () => { state.dragging = false; });
mapView.addEventListener("pointercancel", () => { state.dragging = false; });
mapView.addEventListener("wheel", (event) => { event.preventDefault(); state.zoom = Math.max(.35, Math.min(4, state.zoom * Math.exp(-event.deltaY * .001))); }, { passive: false });

$("#cameraFeed").addEventListener("error", () => $("#cameraState").classList.remove("online"));

setArmed(false);
resizeCanvas();
window.addEventListener("resize", resizeCanvas);
requestAnimationFrame(drawMap);
updateStatus();
updatePoints();
setInterval(updateStatus, 1000);
setInterval(updatePoints, 850);
