import { useCallback, useEffect, useRef, useState } from "react";

import AppHeader from "../components/AppHeader";
import OracleButton from "../components/OracleButton";
import PointCloudMap from "../components/PointCloudMap";
import RobotCamera from "../components/RobotCamera";
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
  speed_limit_percent: 55,
  speed_min_percent: 5,
  speed_max_percent: 100,
  speed_step_percent: 5,
  obstacle_avoidance_enabled: false,
  safety_mode: "unitree_native_obstacles_avoid",
  safety_ready: false,
  safety_blocked: false,
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

  const canMove = Boolean(
    robotStatus.sdk_connected &&
      robotStatus.control_armed &&
      robotStatus.posture === "standing" &&
      robotStatus.safety_ready,
  );

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
      if (!accessToken || !canMove) return;
      stopMotion(false);
      const motionSession = motionSessionRef.current + 1;
      motionSessionRef.current = motionSession;
      setStatusMessage("");
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
    [accessToken, canMove, dispatchRobotCommand, stopMotion],
  );

  const handleMotionPointerDown = useCallback(
    (event, command) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      motionPointerRef.current = event.pointerId;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      beginMotion(command);
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
    function normalizedKey(event) {
      return event.key.length === 1 ? event.key.toLowerCase() : event.key;
    }

    function handleKeyDown(event) {
      if (event.repeat || ["INPUT", "TEXTAREA"].includes(event.target.tagName)) return;
      const key = normalizedKey(event);
      if (key === " ") {
        event.preventDefault();
        stopMotion();
        return;
      }
      const command = KEY_COMMANDS[key];
      if (!command) return;
      event.preventDefault();
      beginMotion(command);
    }

    function handleKeyUp(event) {
      if (KEY_COMMANDS[normalizedKey(event)]) stopMotion();
    }

    function handleVisibility() {
      if (document.hidden) stopMotion();
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", stopMotion);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", stopMotion);
      document.removeEventListener("visibilitychange", handleVisibility);
      stopMotion();
    };
  }, [beginMotion, stopMotion]);

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

  function handleEmergencyStop() {
    stopMotion(false);
    handleAction("emergency_stop", {}, "Parada de emergência enviada e controle desarmado.");
  }

  const location = robotStatus.current_location;
  const speed = robotStatus.speed_limit_percent;
  const speedMin = robotStatus.speed_min_percent;
  const speedMax = robotStatus.speed_max_percent;
  const speedStep = robotStatus.speed_step_percent;
  const postureControlsDisabled =
    !robotStatus.sdk_connected || !robotStatus.control_armed || Boolean(pendingAction);
  const safetyState = robotStatus.safety_ready ? "protected" : "unavailable";
  const safetyLabel = robotStatus.safety_ready ? "Ativo" : "Aguardando";

  return (
    <div className="app-layout">
      <AppHeader showLogout />

      <main className="dashboard-page">
        <section className="dashboard-title">
          <h1>Painel de operação do Go2</h1>
          <p>Câmera, nuvem de pontos, localização e controle em tempo real.</p>
        </section>

        <section className="status-grid status-grid--extended">
          <article className="status-card">
            <span>Robô</span>
            <strong className={robotStatus.robot_online ? "status-online" : "status-offline"}>
              {robotStatus.robot_online ? "Online" : "Offline"}
            </strong>
          </article>
          <article className="status-card">
            <span>LIO + IMU</span>
            <strong className={robotStatus.lio_connected ? "status-online" : "status-offline"}>
              {robotStatus.lio_connected ? "Estável" : "Aguardando"}
            </strong>
          </article>
          <article className="status-card">
            <span>Câmera</span>
            <strong className={robotStatus.camera_connected ? "status-online" : "status-offline"}>
              {robotStatus.camera_connected ? "Ao vivo" : "Sem sinal"}
            </strong>
          </article>
          <article className="status-card">
            <span>Mapa</span>
            <strong>{Number(robotStatus.point_count || 0).toLocaleString("pt-BR")} pts</strong>
          </article>
        </section>

        <section className="dashboard-grid">
          <article className="panel video-panel">
            <div className="panel-header">
              <div>
                <h2>Câmera frontal</h2>
                <p>Quadros protegidos pela sessão do operador.</p>
              </div>
              <span className={`status-label ${robotStatus.camera_connected ? "is-online" : ""}`}>
                {robotStatus.camera_connected ? "AO VIVO" : "SEM SINAL"}
              </span>
            </div>
            <div className="video-placeholder video-placeholder--live">
              <RobotCamera
                accessToken={accessToken}
                connected={robotStatus.camera_connected}
                liveKitRoom={liveKit.room}
                liveKitConnectionState={liveKit.connectionState}
                liveKitErrorMessage={liveKit.errorMessage}
              />
              <span className="camera-resolution">GO2 FRONT CAM · 1280 × 720</span>
            </div>
            <OracleButton
              onClick={handleOracleAnalysis}
              isLoading={isRequestingAnalysis}
              disabled={!robotStatus.camera_connected}
            />
          </article>

          <article className="panel navigation-panel">
            <div className="panel-header">
              <div>
                <h2>Mapeamento 3D</h2>
                <p>Nuvem consolidada e localização relativa à origem.</p>
              </div>
              <span className={`status-label ${robotStatus.lio_connected ? "is-online" : ""}`}>
                {robotStatus.lio_connected ? "LIO + IMU" : "AGUARDANDO"}
              </span>
            </div>
            <div className="map-placeholder map-placeholder--live">
              <PointCloudMap
                points={isLiveKitEnabled ? liveKit.points : points}
                pose={robotStatus.current_pose}
              />
            </div>
            <div className="map-location">
              <div><span>X</span><strong>{coordinate(location?.x)}</strong></div>
              <div><span>Y</span><strong>{coordinate(location?.y)}</strong></div>
              <div><span>Z</span><strong>{coordinate(location?.z)}</strong></div>
              <div><span>YAW</span><strong>{Number.isFinite(location?.yaw_deg) ? `${location.yaw_deg.toFixed(1)}°` : "--"}</strong></div>
            </div>
            <div className="map-actions">
              <button
                className="ui-button ui-button--secondary"
                type="button"
                onClick={() => handleAction("reset_map", {}, "Novo mapa iniciado.")}
                disabled={!robotStatus.lio_connected || Boolean(pendingAction)}
              >
                Novo mapa
              </button>
              <button
                className="ui-button ui-button--primary map-save-button"
                type="button"
                onClick={() => handleAction("save_map", {}, "Mapa salvo.")}
                disabled={!robotStatus.lio_connected || Boolean(pendingAction)}
              >
                Salvar mapa
              </button>
            </div>
          </article>
        </section>

        <section className="panel teleoperation-panel">
          <div className="panel-header teleoperation-heading">
            <div>
              <h2>Teleoperação</h2>
              <p>Movimento contínuo, postura e resposta em tempo real.</p>
            </div>
            <span className={`status-label ${robotStatus.control_armed ? "is-armed" : ""}`}>
              {robotStatus.control_armed ? "CONTROLE HABILITADO" : "CONTROLE BLOQUEADO"}
            </span>
          </div>

          <div className={`native-safety-status native-safety-status--${safetyState}`} role="status">
            <span aria-hidden="true" />
            <strong>Proteção Unitree</strong>
            <small>{safetyLabel}</small>
          </div>

          <div className="teleoperation-grid">
            <section className="teleoperation-card teleoperation-card--system">
              <div className="teleoperation-card__header">
                <div>
                  <strong>Sistema</strong>
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
                    robotStatus.control_armed ? "Controle bloqueado." : "Controle habilitado com segurança.",
                  )
                }
              >
                <strong>{robotStatus.control_armed ? "Bloquear controle" : "Habilitar controle"}</strong>
                <small>{robotStatus.control_armed ? "Canal ativo · toque para bloquear" : "Toque para ativar o canal"}</small>
              </button>

              <div className="teleoperation-posture">
                <button
                  className="ui-button ui-button--secondary"
                  type="button"
                  disabled={postureControlsDisabled}
                  onClick={() => handleAction("stand_up", {}, "Comando para levantar enviado.")}
                >
                  <span>↑</span> Levantar
                </button>
                <button
                  className="ui-button ui-button--secondary"
                  type="button"
                  disabled={postureControlsDisabled}
                  onClick={() => handleAction("stand_down", {}, "Comando para deitar enviado.")}
                >
                  <span>↓</span> Deitar
                </button>
              </div>
            </section>

            <section className="teleoperation-card teleoperation-card--direction">
              <div className="teleoperation-card__header">
                <div>
                  <strong>Direção</strong>
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
                  <strong>Resposta</strong>
                  <small>Intensidade do comando nativo</small>
                </div>
              </div>
              <div className="teleoperation-speed">
                <button
                  className="teleoperation-speed__button"
                  type="button"
                  aria-label="Diminuir velocidade"
                  disabled={!robotStatus.sdk_connected || speed <= speedMin || Boolean(pendingAction)}
                  onClick={() => handleAction("set_speed", { percent: speed - speedStep }, `Velocidade ajustada para ${speed - speedStep}%.`)}
                >−</button>
                <strong>{speed}%</strong>
                <button
                  className="teleoperation-speed__button"
                  type="button"
                  aria-label="Aumentar velocidade"
                  disabled={!robotStatus.sdk_connected || speed >= speedMax || Boolean(pendingAction)}
                  onClick={() => handleAction("set_speed", { percent: speed + speedStep }, `Velocidade ajustada para ${speed + speedStep}%.`)}
                >+</button>
              </div>
              <small>Nível operacional · {speedMin}%–{speedMax}%</small>
            </section>
          </div>

          <div className="teleoperation-footer">
            <button
              className="ui-button ui-button--danger teleoperation-emergency"
              type="button"
              onClick={handleEmergencyStop}
              disabled={!accessToken || pendingAction === "emergency_stop"}
            >
              <span aria-hidden="true">■</span> Parada de emergência
            </button>
          </div>
          {statusMessage && <p className="operation-message" role="status">{statusMessage}</p>}
        </section>
      </main>
    </div>
  );
}

export default DashboardPage;
