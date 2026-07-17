import { useCallback, useEffect, useRef, useState } from "react";

import AppHeader from "../components/AppHeader";
import OracleButton from "../components/OracleButton";
import PointCloudMap from "../components/PointCloudMap";
import RobotCamera from "../components/RobotCamera";
import SlamBackground from "../components/SlamBackground";
import { useAuth } from "../context/useAuth";
import {
  getRobotMap,
  getRobotStatus,
  requestOracleAnalysis,
  sendRobotCommand,
} from "../services/api";
import { isLiveKitEnabled } from "../services/livekit";
import { publishLiveKitCommand } from "../services/livekitCommands";
import { useLiveKitRobot } from "../services/useLiveKitRobot";

const OFFLINE_STATUS = {
  robot_online: false,
  network_online: false,
  sdk_connected: false,
  gateway_connected: false,
  camera_connected: false,
  lio_connected: false,
  control_armed: false,
  posture: "unknown",
  point_count: 0,
  current_location: null,
  current_pose: null,
  speed_limit_percent: 100,
  speed_min_percent: 10,
  speed_max_percent: 100,
  speed_step_percent: 10,
  obstacle_avoidance_enabled: false,
  obstacle_avoidance_requested: false,
  obstacle_avoidance_state_confirmed: false,
  native_avoidance_confirmed: false,
  safety_mode: "unitree_native_obstacles_avoid",
  safety_ready: false,
  safety_blocked: false,
  safety_block_reason: null,
  remote_source_confirmed: false,
};

const STATUS_REFRESH_INTERVAL_MS = 1_000;
const MAP_REFRESH_INTERVAL_MS = 850;
const MOTION_HEARTBEAT_MS = 80;

const MOVEMENT_LABELS = {
  forward: "AVANÇANDO",
  backward: "RECUANDO",
  rotate_left: "GIRANDO À ESQUERDA",
  rotate_right: "GIRANDO À DIREITA",
};

const KEY_COMMANDS = {
  w: "forward",
  ArrowUp: "forward",
  s: "backward",
  ArrowDown: "backward",
  a: "rotate_left",
  ArrowLeft: "rotate_left",
  d: "rotate_right",
  ArrowRight: "rotate_right",
};

function coordinate(value) {
  return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(2)} m` : "--";
}

function DashboardPage() {
  const { session } = useAuth();
  const accessToken = session?.access_token;
  const [polledRobotStatus, setRobotStatus] = useState(OFFLINE_STATUS);
  const [points, setPoints] = useState([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [activeCommand, setActiveCommand] = useState(null);
  const [pendingAction, setPendingAction] = useState("");
  const [isRequestingAnalysis, setIsRequestingAnalysis] = useState(false);
  const liveKit = useLiveKitRobot(accessToken);
  const liveKitRoom = liveKit.room;
  const userId = session?.user?.id;
  const robotStatus =
    isLiveKitEnabled && liveKit.telemetry
      ? { ...OFFLINE_STATUS, ...liveKit.telemetry }
      : polledRobotStatus;
  const motionTimerRef = useRef(null);
  const motionSessionRef = useRef(0);
  const motionPointerRef = useRef(null);
  const activeCommandRef = useRef(null);
  const pressedMotionKeysRef = useRef(new Map());
  const canMoveRef = useRef(false);
  const stopMotionRef = useRef(null);

  const canMove = Boolean(
    robotStatus.sdk_connected &&
      robotStatus.control_armed &&
      robotStatus.posture === "standing" &&
      robotStatus.safety_ready &&
      !robotStatus.safety_blocked,
  );

  useEffect(() => {
    canMoveRef.current = canMove;
  }, [canMove]);

  const dispatchRobotCommand = useCallback(
    (command, payload = {}) => {
      if (isLiveKitEnabled) {
        return publishLiveKitCommand(liveKitRoom, userId, command, payload);
      }
      return sendRobotCommand(accessToken, command, payload);
    },
    [accessToken, liveKitRoom, userId],
  );
  useEffect(() => {
    if (!accessToken || isLiveKitEnabled) return undefined;
    let active = true;

    async function loadStatus() {
      try {
        const nextStatus = await getRobotStatus(accessToken);
        if (active) setRobotStatus({ ...OFFLINE_STATUS, ...nextStatus });
      } catch (error) {
        if (active) {
          setRobotStatus(OFFLINE_STATUS);
          setStatusMessage(error.message);
        }
      }
    }

    loadStatus();
    const intervalId = window.setInterval(loadStatus, STATUS_REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken || isLiveKitEnabled) return undefined;
    let active = true;

    async function loadMap() {
      try {
        const payload = await getRobotMap(accessToken);
        if (active) setPoints(payload.points || []);
      } catch {
        if (active) setPoints([]);
      }
    }

    loadMap();
    const intervalId = window.setInterval(loadMap, MAP_REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [accessToken]);

  const stopMotion = useCallback(
    (sendStop = true) => {
      motionSessionRef.current += 1;
      motionPointerRef.current = null;
      window.clearTimeout(motionTimerRef.current);
      motionTimerRef.current = null;
      activeCommandRef.current = null;
      setActiveCommand(null);
      if (sendStop && accessToken) {
        dispatchRobotCommand("stop").catch((error) => {
          setStatusMessage(error.message);
        });
      }
    },
    [accessToken, dispatchRobotCommand],
  );

  const beginMotion = useCallback(
    (command) => {
      if (!accessToken || !canMoveRef.current) return;
      stopMotion(false);
      const motionSession = motionSessionRef.current + 1;
      motionSessionRef.current = motionSession;
      setStatusMessage("");
      activeCommandRef.current = command;
      setActiveCommand(command);

      async function pulse() {
        if (motionSessionRef.current !== motionSession) return;
        try {
          await dispatchRobotCommand(command, { duration_ms: 250 });
          if (motionSessionRef.current === motionSession) {
            motionTimerRef.current = window.setTimeout(pulse, MOTION_HEARTBEAT_MS);
          }
        } catch (error) {
          if (motionSessionRef.current === motionSession) {
            stopMotion();
            setStatusMessage(error.message);
          }
        }
      }

      pulse();
    },
    [accessToken, dispatchRobotCommand, stopMotion],
  );

  useEffect(() => {
    stopMotionRef.current = stopMotion;
  }, [stopMotion]);

  const handleMotionPointerDown = useCallback(
    (event, command) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      pressedMotionKeysRef.current.clear();
      beginMotion(command);
      if (activeCommandRef.current !== command) return;
      motionPointerRef.current = event.pointerId;
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [beginMotion],
  );

  const handleMotionPointerEnd = useCallback(
    (event) => {
      event.preventDefault();
      if (motionPointerRef.current !== event.pointerId) return;
      motionPointerRef.current = null;
      stopMotion();
    },
    [stopMotion],
  );

  useEffect(() => {
    function handleGlobalPointerEnd(event) {
      if (motionPointerRef.current === event.pointerId) {
        motionPointerRef.current = null;
        stopMotion();
      }
    }

    window.addEventListener("pointerup", handleGlobalPointerEnd);
    window.addEventListener("pointercancel", handleGlobalPointerEnd);
    return () => {
      window.removeEventListener("pointerup", handleGlobalPointerEnd);
      window.removeEventListener("pointercancel", handleGlobalPointerEnd);
    };
  }, [stopMotion]);

  useEffect(() => {
    function normalizedKey(event) {
      return event.key.length === 1 ? event.key.toLowerCase() : event.key;
    }

    function handleKeyDown(event) {
      if (["INPUT", "TEXTAREA"].includes(event.target.tagName)) return;
      const key = normalizedKey(event);
      if (key === " ") {
        event.preventDefault();
        pressedMotionKeysRef.current.clear();
        stopMotion();
        return;
      }
      const command = KEY_COMMANDS[key];
      if (!command) return;
      event.preventDefault();
      if (event.repeat) return;
      pressedMotionKeysRef.current.delete(key);
      pressedMotionKeysRef.current.set(key, command);
      beginMotion(command);
    }

    function handleKeyUp(event) {
      const key = normalizedKey(event);
      const command = KEY_COMMANDS[key];
      if (!command) return;
      event.preventDefault();
      pressedMotionKeysRef.current.delete(key);
      if (activeCommandRef.current !== command) return;
      const remainingCommands = [...pressedMotionKeysRef.current.values()];
      const remainingCommand = remainingCommands.at(-1);
      if (remainingCommand) beginMotion(remainingCommand);
      else stopMotion();
    }

    function handleVisibility() {
      if (document.hidden) {
        pressedMotionKeysRef.current.clear();
        stopMotion();
      }
    }

    function handleWindowBlur() {
      pressedMotionKeysRef.current.clear();
      stopMotion();
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleWindowBlur);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleWindowBlur);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [beginMotion, stopMotion]);

  useEffect(() => () => {
    pressedMotionKeysRef.current.clear();
    stopMotionRef.current?.();
  }, []);

  useEffect(() => {
    if (
      !activeCommandRef.current ||
      (canMove && !robotStatus.safety_blocked)
    ) return;
    pressedMotionKeysRef.current.clear();
    stopMotion();
  }, [canMove, robotStatus.safety_blocked, stopMotion]);

  async function handleAction(command, payload, successMessage) {
    if (!accessToken || pendingAction) return;
    stopMotion(false);
    setPendingAction(command);
    setStatusMessage("");
    try {
      const result = await dispatchRobotCommand(command, payload);
      setStatusMessage(successMessage);
      if (command === "save_map" && result?.result?.point_count) {
        setStatusMessage(`Mapa salvo com ${result.result.point_count.toLocaleString("pt-BR")} pontos.`);
      }
    } catch (error) {
      setStatusMessage(error.message);
    } finally {
      setPendingAction("");
    }
  }

  async function handleOracleAnalysis() {
    if (!accessToken) return;
    setIsRequestingAnalysis(true);
    setStatusMessage("");
    try {
      await requestOracleAnalysis(accessToken);
      setStatusMessage("Captura adicionada à fila de análise da Oracle.");
    } catch (error) {
      setStatusMessage(error.message);
    } finally {
      setIsRequestingAnalysis(false);
    }
  }

  function handleDamping() {
    stopMotion(false);
    handleAction(
      "damping",
      {},
      "Damping oficial da Unitree enviado; o controle permanece disponível.",
    );
  }

  const location = robotStatus.current_location;
  const speed = robotStatus.speed_limit_percent;
  const speedMin = robotStatus.speed_min_percent;
  const speedMax = robotStatus.speed_max_percent;
  const speedStep = robotStatus.speed_step_percent;
  const lowerSpeed = Math.max(speedMin, speed - speedStep);
  const higherSpeed = Math.min(speedMax, speed + speedStep);
  const postureControlsDisabled =
    !robotStatus.sdk_connected || !robotStatus.control_armed || Boolean(pendingAction);
  const postureTransitioning = robotStatus.posture?.startsWith("transitioning_");
  const standUpDisabled =
    postureControlsDisabled || postureTransitioning || robotStatus.posture === "standing";
  const standDownDisabled =
    postureControlsDisabled || postureTransitioning || robotStatus.posture === "lying";
  const avoidanceEnabled = Boolean(robotStatus.obstacle_avoidance_enabled);
  const avoidanceStateConfirmed = Boolean(
    robotStatus.obstacle_avoidance_state_confirmed,
  );
  const nativeAvoidanceConfirmed = Boolean(
    robotStatus.native_avoidance_confirmed,
  );
  const avoidanceConfirmed = avoidanceEnabled
    ? avoidanceStateConfirmed && nativeAvoidanceConfirmed
    : avoidanceStateConfirmed;
  const avoidanceChanging =
    pendingAction === "set_obstacle_avoidance" || !avoidanceConfirmed;
  const safetyState = robotStatus.safety_blocked
    ? "blocked"
    : avoidanceConfirmed && !avoidanceEnabled
      ? "unprotected"
      : robotStatus.safety_ready
      ? "protected"
      : "unavailable";
  const safetyLabel = robotStatus.safety_blocked
    ? "Limite detectado · robô parado"
    : avoidanceConfirmed && !avoidanceEnabled
      ? "Modo livre confirmado · sem barreira de obstáculos"
      : robotStatus.safety_ready
      ? "API confirmada"
      : robotStatus.control_armed && robotStatus.native_avoidance_confirmed
        ? "Confirmando canal de controle"
        : "Aguardando confirmação";
  const safetyTitle = avoidanceEnabled
    ? "Proteção Unitree"
    : avoidanceConfirmed
      ? "Anticolisão desabilitada"
      : "Confirmando anticolisão";
  const controlLabel = robotStatus.safety_blocked
    ? "LIMITE DE SEGURANÇA"
    : robotStatus.control_armed
      ? robotStatus.safety_ready
        ? "CONTROLE HABILITADO"
        : "CONFIRMANDO PROTEÇÃO"
      : "CONTROLE BLOQUEADO";

  return (
    <div className="app-layout">
      <AppHeader showLogout />
      <SlamBackground className="dashboard-slam-background" />

      <main className="dashboard-page">
        <section className="dashboard-grid">
          <div className="operation-hud">
            <div className="operation-statuses" aria-label="Status da operação">
              <span><i /> DADOS REAIS · LIDAR 3D</span>
              <span>ROBÔ · <strong className={robotStatus.robot_online ? "is-online" : "is-offline"}>{robotStatus.robot_online ? "ONLINE" : "OFFLINE"}</strong></span>
              <span>LIO + IMU · <strong className={robotStatus.lio_connected ? "is-online" : "is-offline"}>{robotStatus.lio_connected ? "ESTÁVEL" : "AGUARDANDO"}</strong></span>
              <span>CÂMERA · <strong className={robotStatus.camera_connected ? "is-online" : "is-offline"}>{robotStatus.camera_connected ? "AO VIVO" : "SEM SINAL"}</strong></span>
              <span>MAPA · <strong>{Number(robotStatus.point_count || 0).toLocaleString("pt-BR")} PTS</strong></span>
            </div>
            <b>ARRASTE PARA GIRAR · ROLE PARA DAR ZOOM</b>
          </div>
          <article className="panel video-panel" aria-label="Câmera frontal">
            <div className="video-placeholder video-placeholder--live">
              <RobotCamera
                accessToken={accessToken}
                connected={robotStatus.camera_connected}
                liveKitRoom={liveKit.room}
                liveKitConnectionState={liveKit.connectionState}
                liveKitErrorMessage={liveKit.errorMessage}
              />
              <div className="viewport-controls viewport-controls--camera">
                <OracleButton
                  onClick={handleOracleAnalysis}
                  isLoading={isRequestingAnalysis}
                  disabled={!robotStatus.camera_connected}
                />
              </div>
            </div>
          </article>

          <article className="panel navigation-panel" aria-label="Mapeamento tridimensional">
            <div className="map-placeholder map-placeholder--live">
              <PointCloudMap
                points={isLiveKitEnabled ? liveKit.points : points}
                pose={robotStatus.current_pose}
              />
              <div className="viewport-controls viewport-controls--map">
                <button
                  className="viewport-action"
                  type="button"
                  onClick={() => handleAction("reset_map", {}, "Novo mapa iniciado.")}
                  disabled={!robotStatus.lio_connected || Boolean(pendingAction)}
                >
                  NOVO MAPA
                </button>
                <button
                  className="viewport-action viewport-action--primary"
                  type="button"
                  onClick={() => handleAction("save_map", {}, "Mapa salvo.")}
                  disabled={!robotStatus.lio_connected || Boolean(pendingAction)}
                >
                  SALVAR
                </button>
              </div>
            </div>
            <div className="map-location">
              <div><span>X</span><strong>{coordinate(location?.x)}</strong></div>
              <div><span>Y</span><strong>{coordinate(location?.y)}</strong></div>
              <div><span>Z</span><strong>{coordinate(location?.z)}</strong></div>
              <div><span>YAW</span><strong>{Number.isFinite(location?.yaw_deg) ? `${location.yaw_deg.toFixed(1)}°` : "--"}</strong></div>
            </div>
          </article>
        </section>

        <section className="panel teleoperation-panel">
          <div className="panel-header teleoperation-heading">
            <div>
              <h2>Central de comandos</h2>
              <p>Movimento contínuo, postura e resposta em tempo real.</p>
            </div>
            <span className={`status-label ${robotStatus.control_armed ? "is-armed" : ""}`}>
              {controlLabel}
            </span>
          </div>

          <div className={`native-safety-status native-safety-status--${safetyState}`} role="status">
            <span aria-hidden="true" />
            <strong>{safetyTitle}</strong>
            <small>{safetyLabel}</small>
          </div>

          <div className="teleoperation-grid">
            <section className="teleoperation-card teleoperation-card--system">
              <div className="teleoperation-card__header">
                <div>
                  <strong>Segurança e postura</strong>
                  <small>Canal de controle e postura</small>
                </div>
              </div>
              <button
                className={`ui-button teleoperation-arm-button ${robotStatus.control_armed ? "is-armed" : ""}`}
                type="button"
                disabled={
                  !robotStatus.sdk_connected ||
                  Boolean(pendingAction) ||
                  (!robotStatus.control_armed && !robotStatus.safety_ready)
                }
                onClick={() =>
                  handleAction(
                    robotStatus.control_armed ? "disarm" : "arm",
                    {},
                    robotStatus.control_armed
                      ? "Controle bloqueado."
                      : avoidanceEnabled
                        ? "Controle habilitado com anticolisão."
                        : "Controle habilitado em modo livre.",
                  )
                }
              >
                <strong>{robotStatus.control_armed ? "Bloquear controle" : "Habilitar controle"}</strong>
                <small>
                  {robotStatus.control_armed
                    ? robotStatus.safety_ready
                      ? "Canal ativo · toque para bloquear"
                      : "Aguardando confirmação da Unitree"
                    : "Toque para ativar o canal"}
                </small>
              </button>

              <button
                className={`ui-button teleoperation-avoidance-button ${avoidanceEnabled ? "is-enabled" : "is-disabled"}`}
                type="button"
                aria-pressed={avoidanceEnabled}
                disabled={
                  !robotStatus.sdk_connected ||
                  Boolean(pendingAction) ||
                  !avoidanceConfirmed
                }
                onClick={() =>
                  handleAction(
                    "set_obstacle_avoidance",
                    { enabled: !avoidanceEnabled },
                    avoidanceEnabled
                      ? "Desativação do anticolisão enviada."
                      : "Ativação do anticolisão enviada.",
                  )
                }
              >
                <strong>
                  {avoidanceChanging
                    ? "Confirmando Obstacle Avoidance..."
                    : avoidanceEnabled
                      ? "Desativar Obstacle Avoidance"
                      : "Ativar Obstacle Avoidance"}
                </strong>
                <small>
                  {avoidanceEnabled
                    ? nativeAvoidanceConfirmed
                      ? "Proteção nativa confirmada e ativa"
                      : "Aguardando confirmação nativa"
                    : avoidanceStateConfirmed
                      ? "Estado nativo confirmado como desativado"
                      : "Aguardando estado real do robô"}
                </small>
              </button>

              <div className="teleoperation-posture">
                <button
                  className="ui-button ui-button--secondary"
                  type="button"
                  disabled={standUpDisabled}
                  onClick={() => handleAction("stand_up", {}, "Comando para levantar enviado.")}
                >
                  <span>↑</span> {robotStatus.posture === "transitioning_up" ? "Levantando..." : "Levantar"}
                </button>
                <button
                  className="ui-button ui-button--secondary"
                  type="button"
                  disabled={standDownDisabled}
                  onClick={() => handleAction("stand_down", {}, "Comando para deitar enviado.")}
                >
                  <span>↓</span> {robotStatus.posture === "transitioning_down" ? "Deitando..." : "Deitar"}
                </button>
              </div>
            </section>

            <section className="teleoperation-card teleoperation-card--direction">
              <div className="teleoperation-card__header">
                <div>
                  <strong>Movimento</strong>
                  <small>WASD · mantenha pressionado</small>
                </div>
              </div>
              <div className="teleoperation-pad" aria-label="Controle de movimentação">
                <button
                  className={`teleoperation-key ${activeCommand === "forward" ? "is-active" : ""}`}
                  type="button"
                  disabled={!canMove}
                  onPointerDown={(event) => handleMotionPointerDown(event, "forward")}
                  onPointerUp={handleMotionPointerEnd}
                  onPointerCancel={handleMotionPointerEnd}
                  onLostPointerCapture={handleMotionPointerEnd}
                >W<span>↑</span></button>
                <div className="teleoperation-pad__row">
                  <button
                    className={`teleoperation-key ${activeCommand === "rotate_left" ? "is-active" : ""}`}
                    type="button"
                    disabled={!canMove}
                    onPointerDown={(event) => handleMotionPointerDown(event, "rotate_left")}
                    onPointerUp={handleMotionPointerEnd}
                    onPointerCancel={handleMotionPointerEnd}
                    onLostPointerCapture={handleMotionPointerEnd}
                  >A<span>↶</span></button>
                  <button
                    className={`teleoperation-key ${activeCommand === "backward" ? "is-active" : ""}`}
                    type="button"
                    disabled={!canMove}
                    onPointerDown={(event) => handleMotionPointerDown(event, "backward")}
                    onPointerUp={handleMotionPointerEnd}
                    onPointerCancel={handleMotionPointerEnd}
                    onLostPointerCapture={handleMotionPointerEnd}
                  >S<span>↓</span></button>
                  <button
                    className={`teleoperation-key ${activeCommand === "rotate_right" ? "is-active" : ""}`}
                    type="button"
                    disabled={!canMove}
                    onPointerDown={(event) => handleMotionPointerDown(event, "rotate_right")}
                    onPointerUp={handleMotionPointerEnd}
                    onPointerCancel={handleMotionPointerEnd}
                    onLostPointerCapture={handleMotionPointerEnd}
                  >D<span>↷</span></button>
                </div>
                <small>{activeCommand ? MOVEMENT_LABELS[activeCommand] : canMove ? "PRONTO" : "BLOQUEADO"}</small>
              </div>
            </section>

            <section className="teleoperation-card teleoperation-card--response">
              <div className="teleoperation-card__header">
                <div>
                  <strong>Velocidade</strong>
                  <small>Intensidade do comando nativo</small>
                </div>
              </div>
              <div className="teleoperation-speed">
                <button
                  className="teleoperation-speed__button"
                  type="button"
                  aria-label="Diminuir velocidade"
                  disabled={!robotStatus.sdk_connected || speed <= speedMin || Boolean(pendingAction)}
                  onClick={() => handleAction("set_speed", { percent: lowerSpeed }, `Velocidade ajustada para ${lowerSpeed}%.`)}
                >−</button>
                <strong>{speed}%</strong>
                <button
                  className="teleoperation-speed__button"
                  type="button"
                  aria-label="Aumentar velocidade"
                  disabled={!robotStatus.sdk_connected || speed >= speedMax || Boolean(pendingAction)}
                  onClick={() => handleAction("set_speed", { percent: higherSpeed }, `Velocidade ajustada para ${higherSpeed}%.`)}
                >+</button>
              </div>
              <small>Nível operacional · {speedMin}%–{speedMax}%</small>
            </section>
          </div>

          <div className="teleoperation-footer">
            <button
              className="ui-button ui-button--danger teleoperation-emergency"
              type="button"
              onClick={handleDamping}
              disabled={!accessToken || pendingAction === "damping"}
            >
              <span aria-hidden="true">■</span> Damping
            </button>
          </div>
          {statusMessage && <p className="operation-message" role="status">{statusMessage}</p>}
        </section>
      </main>
    </div>
  );
}

export default DashboardPage;
