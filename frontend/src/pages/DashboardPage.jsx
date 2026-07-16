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

const OFFLINE_STATUS = {
  robot_online: false,
  network_online: false,
  sdk_connected: false,
  gateway_connected: false,
  camera_connected: false,
  lio_connected: false,
  battery_percent: null,
  control_armed: false,
  posture: "unknown",
  point_count: 0,
  current_location: null,
  current_pose: null,
  speed_limit_percent: 30,
  speed_min_percent: 10,
  speed_max_percent: 50,
  speed_step_percent: 5,
};

const STATUS_REFRESH_INTERVAL_MS = 1_000;
const MAP_REFRESH_INTERVAL_MS = 850;
const MOTION_HEARTBEAT_MS = 140;

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
  const [robotStatus, setRobotStatus] = useState(OFFLINE_STATUS);
  const [points, setPoints] = useState([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [activeCommand, setActiveCommand] = useState(null);
  const [pendingAction, setPendingAction] = useState("");
  const [isRequestingAnalysis, setIsRequestingAnalysis] = useState(false);
  const motionTimerRef = useRef(null);

  const canMove = Boolean(
    robotStatus.sdk_connected &&
      robotStatus.control_armed &&
      robotStatus.posture === "standing",
  );
  useEffect(() => {
    if (!accessToken) return undefined;
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
    if (!accessToken) return undefined;
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
      window.clearInterval(motionTimerRef.current);
      motionTimerRef.current = null;
      setActiveCommand(null);
      if (sendStop && accessToken) {
        sendRobotCommand(accessToken, "stop").catch((error) => {
          setStatusMessage(error.message);
        });
      }
    },
    [accessToken],
  );

  const beginMotion = useCallback(
    (command) => {
      if (!accessToken || !canMove) return;
      stopMotion(false);
      setStatusMessage("");
      setActiveCommand(command);

      async function pulse() {
        try {
          await sendRobotCommand(accessToken, command, { duration_ms: 250 });
        } catch (error) {
          window.clearInterval(motionTimerRef.current);
          motionTimerRef.current = null;
          setActiveCommand(null);
          setStatusMessage(error.message);
        }
      }

      pulse();
      motionTimerRef.current = window.setInterval(pulse, MOTION_HEARTBEAT_MS);
    },
    [accessToken, canMove, stopMotion],
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
      const result = await sendRobotCommand(accessToken, command, payload);
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

  return (
    <div className="app-layout">
      <AppHeader showLogout />

      <main className="dashboard-page">
        <section className="dashboard-title">
          <span className="project-badge">SLAM · OPERAÇÃO 4G</span>
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
            <span>Gateway Jetson</span>
            <strong className={robotStatus.gateway_connected ? "status-online" : "status-offline"}>
              {robotStatus.gateway_connected ? "Conectado" : "Desconectado"}
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
          <article className="status-card">
            <span>Bateria</span>
            <strong>{robotStatus.battery_percent == null ? "--%" : `${robotStatus.battery_percent}%`}</strong>
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
              <RobotCamera accessToken={accessToken} connected={robotStatus.camera_connected} />
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
              <PointCloudMap points={points} pose={robotStatus.current_pose} />
            </div>
            <div className="map-location">
              <div><span>X</span><strong>{coordinate(location?.x)}</strong></div>
              <div><span>Y</span><strong>{coordinate(location?.y)}</strong></div>
              <div><span>Z</span><strong>{coordinate(location?.z)}</strong></div>
              <div><span>YAW</span><strong>{Number.isFinite(location?.yaw_deg) ? `${location.yaw_deg.toFixed(1)}°` : "--"}</strong></div>
            </div>
            <div className="map-actions">
              <button
                type="button"
                onClick={() => handleAction("reset_map", {}, "Novo mapa iniciado.")}
                disabled={!robotStatus.lio_connected || Boolean(pendingAction)}
              >
                Novo mapa
              </button>
              <button
                className="map-save-button"
                type="button"
                onClick={() => handleAction("save_map", {}, "Mapa salvo.")}
                disabled={!robotStatus.lio_connected || Boolean(pendingAction)}
              >
                Salvar mapa
              </button>
            </div>
          </article>
        </section>

        <section className="panel control-panel control-panel--wide">
          <div className="panel-header">
            <div>
              <h2>Teleoperação</h2>
              <p>Segure WASD ou as setas. Soltar a tecla envia parada.</p>
            </div>
            <span className={`status-label ${robotStatus.control_armed ? "is-armed" : ""}`}>
              {robotStatus.control_armed ? "CONTROLE HABILITADO" : "CONTROLE BLOQUEADO"}
            </span>
          </div>

          <div className="control-layout">
            <div className="arm-and-posture">
              <button
                className={`arm-toggle ${robotStatus.control_armed ? "is-armed" : ""}`}
                type="button"
                disabled={!robotStatus.sdk_connected || Boolean(pendingAction)}
                onClick={() =>
                  handleAction(
                    robotStatus.control_armed ? "disarm" : "arm",
                    {},
                    robotStatus.control_armed ? "Controle bloqueado." : "Controle habilitado com segurança.",
                  )
                }
              >
                <strong>{robotStatus.control_armed ? "Bloquear controle" : "Habilitar controle"}</strong>
                <small>{robotStatus.control_armed ? "Interrompe e desarma" : "Exige área livre ao redor"}</small>
              </button>

              <div className="posture-control">
                <button
                  type="button"
                  disabled={postureControlsDisabled}
                  onClick={() => handleAction("stand_up", {}, "Comando para levantar enviado.")}
                >
                  <span>↑</span> Levantar
                </button>
                <button
                  type="button"
                  disabled={postureControlsDisabled}
                  onClick={() => handleAction("stand_down", {}, "Comando para deitar enviado.")}
                >
                  <span>↓</span> Deitar
                </button>
              </div>
            </div>

            <div className="wasd-control" aria-label="Controle de movimentação">
              <button
                className={activeCommand === "forward" ? "is-active" : ""}
                type="button"
                disabled={!canMove}
                onPointerDown={() => beginMotion("forward")}
                onPointerUp={() => stopMotion()}
                onPointerCancel={() => stopMotion()}
                onPointerLeave={() => activeCommand === "forward" && stopMotion()}
              >W<span>↑</span></button>
              <div>
                <button
                  className={activeCommand === "rotate_left" ? "is-active" : ""}
                  type="button"
                  disabled={!canMove}
                  onPointerDown={() => beginMotion("rotate_left")}
                  onPointerUp={() => stopMotion()}
                  onPointerCancel={() => stopMotion()}
                  onPointerLeave={() => activeCommand === "rotate_left" && stopMotion()}
                >A<span>↶</span></button>
                <button
                  className={activeCommand === "backward" ? "is-active" : ""}
                  type="button"
                  disabled={!canMove}
                  onPointerDown={() => beginMotion("backward")}
                  onPointerUp={() => stopMotion()}
                  onPointerCancel={() => stopMotion()}
                  onPointerLeave={() => activeCommand === "backward" && stopMotion()}
                >S<span>↓</span></button>
                <button
                  className={activeCommand === "rotate_right" ? "is-active" : ""}
                  type="button"
                  disabled={!canMove}
                  onPointerDown={() => beginMotion("rotate_right")}
                  onPointerUp={() => stopMotion()}
                  onPointerCancel={() => stopMotion()}
                  onPointerLeave={() => activeCommand === "rotate_right" && stopMotion()}
                >D<span>↷</span></button>
              </div>
              <small>{activeCommand ? MOVEMENT_LABELS[activeCommand] : canMove ? "PRONTO" : "BLOQUEADO"}</small>
            </div>

            <div className="speed-control-card">
              <span>Velocidade</span>
              <div>
                <button
                  type="button"
                  aria-label="Diminuir velocidade"
                  disabled={!robotStatus.sdk_connected || speed <= speedMin || Boolean(pendingAction)}
                  onClick={() => handleAction("set_speed", { percent: speed - speedStep }, `Velocidade ajustada para ${speed - speedStep}%.`)}
                >−</button>
                <strong>{speed}%</strong>
                <button
                  type="button"
                  aria-label="Aumentar velocidade"
                  disabled={!robotStatus.sdk_connected || speed >= speedMax || Boolean(pendingAction)}
                  onClick={() => handleAction("set_speed", { percent: speed + speedStep }, `Velocidade ajustada para ${speed + speedStep}%.`)}
                >+</button>
              </div>
              <small>Faixa segura: {speedMin}%–{speedMax}%</small>
            </div>
          </div>

          <button
            className="emergency-button"
            type="button"
            onClick={handleEmergencyStop}
            disabled={!accessToken || pendingAction === "emergency_stop"}
          >
            Parada de emergência
          </button>

          <p className="watchdog-note">Watchdog ativo · parada automática em 0,35 s sem comando</p>
          {statusMessage && <p className="operation-message" role="status">{statusMessage}</p>}
        </section>
      </main>
    </div>
  );
}

export default DashboardPage;
