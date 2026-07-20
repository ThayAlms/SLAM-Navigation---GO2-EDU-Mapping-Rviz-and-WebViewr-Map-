import { useCallback, useEffect, useRef, useState } from "react";

import AppHeader from "../components/AppHeader";
import MobileJoystick from "../components/MobileJoystick";
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
import { forwardSpeedMps } from "../services/speedProfile";
import { useGamepadControl } from "../services/useGamepadControl";
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
  obstacle_avoidance_command_ready: false,
  native_avoidance_confirmed: false,
  safety_mode: "unitree_native_obstacles_avoid",
  safety_ready: false,
  safety_blocked: false,
  safety_block_reason: null,
  remote_source_confirmed: false,
  remote_source_operational: false,
};

const DEMO_POINTS = Array.from({ length: 900 }, (_, index) => {
  const ring = index % 90;
  const layer = Math.floor(index / 90);
  const angle = (ring / 90) * Math.PI * 2;
  const radius = 2.1 + Math.sin(layer * 0.9 + angle * 3) * 0.34;
  return [
    Math.cos(angle) * radius,
    Math.sin(angle) * radius,
    layer * 0.12 + Math.sin(angle * 5) * 0.08,
  ];
}).flat();

const DEMO_STATUS = {
  ...OFFLINE_STATUS,
  robot_online: true,
  network_online: true,
  sdk_connected: true,
  gateway_connected: true,
  camera_connected: true,
  lio_connected: true,
  posture: "standing",
  point_count: DEMO_POINTS.length / 3,
  current_location: { x: 0, y: 0, z: 0, yaw_deg: 0 },
  current_pose: { x: 0, y: 0, z: 0.12, qx: 0, qy: 0, qz: 0, qw: 1 },
  safety_mode: "interactive_demo",
  safety_ready: true,
  remote_source_confirmed: true,
  remote_source_operational: true,
};

const STATUS_REFRESH_INTERVAL_MS = 1_000;
const MAP_REFRESH_INTERVAL_MS = 850;
const MOTION_HEARTBEAT_MS = 80;

const MOVEMENT_LABELS = {
  gamepad: "CONTROLE USB",
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

function speedMessage(percent) {
  const speed = forwardSpeedMps(percent).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `Nível ${percent}% selecionado: limite frontal de ${speed} m/s.`;
}

function DashboardPage({ demoMode = false }) {
  const { session } = useAuth();
  const accessToken = session?.access_token;
  const [polledRobotStatus, setRobotStatus] = useState(OFFLINE_STATUS);
  const [demoRobotStatus, setDemoRobotStatus] = useState(DEMO_STATUS);
  const [points, setPoints] = useState(() => demoMode ? DEMO_POINTS : []);
  const [statusMessage, setStatusMessage] = useState(
    demoMode ? "Demonstração interativa: nenhum comando será enviado ao robô." : "",
  );
  const [activeCommand, setActiveCommand] = useState(null);
  const [pendingAction, setPendingAction] = useState("");
  const [requestedSpeed, setRequestedSpeed] = useState(null);
  const [isRequestingAnalysis, setIsRequestingAnalysis] = useState(false);
  const [isMapOpen, setIsMapOpen] = useState(false);
  const [showOrientationHint, setShowOrientationHint] = useState(true);
  const liveKit = useLiveKitRobot(demoMode ? null : accessToken);
  const liveKitRoom = liveKit.room;
  const userId = session?.user?.id;
  const robotStatus = demoMode
    ? demoRobotStatus
    : isLiveKitEnabled && liveKit.telemetry
      ? { ...OFFLINE_STATUS, ...liveKit.telemetry }
      : polledRobotStatus;
  const motionTimerRef = useRef(null);
  const motionSessionRef = useRef(0);
  const motionPointerRef = useRef(null);
  const activeCommandRef = useRef(null);
  const pressedMotionKeysRef = useRef(new Map());
  const analogVectorRef = useRef(null);
  const canMoveRef = useRef(false);
  const stopMotionRef = useRef(null);
  const pendingActionRef = useRef("");
  const speedRequestTimerRef = useRef(null);

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
      if (demoMode) {
        return Promise.resolve({
          command,
          payload,
          status: "simulated",
          result: { point_count: points.length / 3 },
        });
      }
      if (isLiveKitEnabled) {
        return publishLiveKitCommand(liveKitRoom, userId, command, payload);
      }
      return sendRobotCommand(accessToken, command, payload);
    },
    [accessToken, demoMode, liveKitRoom, points.length, userId],
  );
  useEffect(() => {
    if (demoMode || !accessToken || isLiveKitEnabled) return undefined;
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
  }, [accessToken, demoMode]);

  useEffect(() => {
    if (demoMode || !accessToken || isLiveKitEnabled) return undefined;
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
  }, [accessToken, demoMode]);

  const stopMotion = useCallback(
    (sendStop = true) => {
      motionSessionRef.current += 1;
      motionPointerRef.current = null;
      analogVectorRef.current = null;
      window.clearTimeout(motionTimerRef.current);
      motionTimerRef.current = null;
      activeCommandRef.current = null;
      setActiveCommand(null);
      if (sendStop && (accessToken || demoMode)) {
        dispatchRobotCommand("stop").catch((error) => {
          setStatusMessage(error.message);
        });
      }
    },
    [accessToken, demoMode, dispatchRobotCommand],
  );

  const beginMotion = useCallback(
    (command) => {
      if ((!accessToken && !demoMode) || !canMoveRef.current) return;
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
    [accessToken, demoMode, dispatchRobotCommand, stopMotion],
  );

  const beginAnalogMotion = useCallback(
    (vector) => {
      if ((!accessToken && !demoMode) || !canMoveRef.current) return;
      if (activeCommandRef.current === "gamepad") {
        analogVectorRef.current = vector;
        return;
      }

      stopMotion(false);
      analogVectorRef.current = vector;
      const motionSession = motionSessionRef.current + 1;
      motionSessionRef.current = motionSession;
      setStatusMessage("");
      activeCommandRef.current = "gamepad";
      setActiveCommand("gamepad");

      async function pulse() {
        if (motionSessionRef.current !== motionSession) return;
        const currentVector = analogVectorRef.current;
        if (!currentVector) return;
        try {
          await dispatchRobotCommand("move_analog", {
            ...currentVector,
            duration_ms: 250,
          });
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
    [accessToken, demoMode, dispatchRobotCommand, stopMotion],
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
    if (speedRequestTimerRef.current) {
      window.clearTimeout(speedRequestTimerRef.current);
    }
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
    if ((!accessToken && !demoMode) || pendingActionRef.current) return false;
    pendingActionRef.current = command;
    stopMotion(false);
    setPendingAction(command);
    setStatusMessage("");
    try {
      const result = await dispatchRobotCommand(command, payload);
      if (demoMode) {
        setDemoRobotStatus((current) => {
          if (command === "arm") return { ...current, control_armed: true };
          if (command === "disarm") return { ...current, control_armed: false };
          if (command === "stand_up" || command === "recovery_stand") {
            return { ...current, posture: "standing" };
          }
          if (command === "stand_down") return { ...current, posture: "lying" };
          if (command === "set_speed") {
            return {
              ...current,
              speed_limit_percent: payload.percent,
              linear_speed_mps: forwardSpeedMps(payload.percent),
            };
          }
          if (command === "set_obstacle_avoidance") {
            return {
              ...current,
              obstacle_avoidance_enabled: payload.enabled,
              obstacle_avoidance_requested: payload.enabled,
              obstacle_avoidance_state_confirmed: true,
              native_avoidance_confirmed: payload.enabled,
            };
          }
          return current;
        });
        if (command === "reset_map") {
          setPoints([]);
          setDemoRobotStatus((current) => ({ ...current, point_count: 0 }));
        }
      }
      setStatusMessage(demoMode ? `Demonstração · ${successMessage}` : successMessage);
      if (command === "save_map" && result?.result?.point_count) {
        setStatusMessage(`Mapa salvo com ${result.result.point_count.toLocaleString("pt-BR")} pontos.`);
      }
      return true;
    } catch (error) {
      setStatusMessage(error.message);
      return false;
    } finally {
      pendingActionRef.current = "";
      setPendingAction("");
    }
  }

  async function handleSpeedChange(percent) {
    if (speedRequestTimerRef.current) {
      window.clearTimeout(speedRequestTimerRef.current);
    }
    setRequestedSpeed(percent);
    const accepted = await handleAction("set_speed", { percent }, speedMessage(percent));
    if (!accepted) {
      setRequestedSpeed(null);
      return;
    }
    speedRequestTimerRef.current = window.setTimeout(() => {
      speedRequestTimerRef.current = null;
      setRequestedSpeed(null);
    }, 2_500);
  }

  async function handleOracleAnalysis() {
    if (!accessToken && !demoMode) return;
    setIsRequestingAnalysis(true);
    setStatusMessage("");
    try {
      if (!demoMode) await requestOracleAnalysis(accessToken);
      setStatusMessage(
        demoMode
          ? "Demonstração · captura simulada para análise da Oracle."
          : "Captura adicionada à fila de análise da Oracle.",
      );
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
  const telemetrySpeed = robotStatus.speed_limit_percent;
  const speed = requestedSpeed ?? telemetrySpeed;
  const speedMin = robotStatus.speed_min_percent;
  const speedMax = robotStatus.speed_max_percent;
  const speedStep = robotStatus.speed_step_percent;
  const lowerSpeed = Math.max(speedMin, speed - speedStep);
  const higherSpeed = Math.min(speedMax, speed + speedStep);
  const selectedForwardSpeed = forwardSpeedMps(speed);

  const postureControlsDisabled =
    !robotStatus.sdk_connected || !robotStatus.control_armed || Boolean(pendingAction);
  const postureTransitioning = robotStatus.posture?.startsWith("transitioning_");
  const standUpDisabled =
    postureControlsDisabled || postureTransitioning || robotStatus.posture === "standing";
  const standDownDisabled =
    postureControlsDisabled || postureTransitioning || robotStatus.posture === "lying";
  const avoidanceEnabled = Boolean(robotStatus.obstacle_avoidance_enabled);
  const avoidanceRequested = Boolean(
    robotStatus.obstacle_avoidance_requested,
  );
  const avoidanceStateConfirmed = Boolean(
    robotStatus.obstacle_avoidance_state_confirmed,
  );
  const nativeAvoidanceConfirmed = Boolean(
    robotStatus.native_avoidance_confirmed,
  );
  const avoidanceConfirmed = avoidanceRequested
    ? avoidanceEnabled && avoidanceStateConfirmed && nativeAvoidanceConfirmed
    : avoidanceStateConfirmed && !avoidanceEnabled;
  const avoidanceChanging = pendingAction === "set_obstacle_avoidance";
  const safetyState = robotStatus.safety_blocked
    ? "blocked"
    : !avoidanceRequested
      ? "unprotected"
      : avoidanceConfirmed
      ? "protected"
      : "unavailable";
  const safetyLabel = robotStatus.safety_blocked
    ? "Limite detectado · robô parado"
    : !avoidanceRequested
      ? "Modo livre selecionado · sem proteção confirmada"
      : avoidanceConfirmed
        ? "API confirmada"
        : "Comando enviado · firmware sem confirmação";
  const safetyTitle = !avoidanceRequested
    ? "Obstacle Avoidance desativado"
    : avoidanceConfirmed
      ? "Proteção Unitree"
      : "Obstacle Avoidance solicitado";
  const controlLabel = robotStatus.safety_blocked
    ? "LIMITE DE SEGURANÇA"
    : robotStatus.control_armed
      ? robotStatus.safety_ready
        ? "CONTROLE HABILITADO"
        : "CONFIRMANDO PROTEÇÃO"
      : "CONTROLE BLOQUEADO";
  const gamepad = useGamepadControl({
    canMove,
    onMotion: beginAnalogMotion,
    onStop: stopMotion,
    onAction(action) {
      if ((!accessToken && !demoMode) || pendingAction) return;
      if (action === "arm" && !robotStatus.control_armed) {
        handleAction("arm", {}, "Controle habilitado pelo gamepad.");
      } else if (action === "damping") {
        handleDamping();
      } else if (action === "stand_up") {
        handleAction("stand_up", {}, "Comando para levantar enviado pelo gamepad.");
      } else if (action === "recovery_stand") {
        handleAction(
          "recovery_stand",
          {},
          "Comando de recuperação para levantar enviado pelo gamepad.",
        );
      } else if (action === "toggle_posture") {
        const command = robotStatus.posture === "standing" ? "stand_down" : "stand_up";
        handleAction(
          command,
          {},
          command === "stand_up"
            ? "Comando para levantar enviado pelo gamepad."
            : "Comando para deitar enviado pelo gamepad.",
        );
      } else if (action === "avoidance_on" && !avoidanceRequested) {
        handleAction(
          "set_obstacle_avoidance",
          { enabled: true },
          "Ativação do anticolisão enviada pelo gamepad.",
        );
      } else if (action === "avoidance_off" && avoidanceRequested) {
        handleAction(
          "set_obstacle_avoidance",
          { enabled: false },
          "Desativação do anticolisão enviada pelo gamepad.",
        );
      }
    },
  });

  const gamepadTitle = !gamepad.supported
    ? "Navegador sem suporte a gamepad"
    : !gamepad.secureContext
      ? "Controle USB exige acesso local seguro"
      : gamepad.connected
        ? `${gamepad.name} conectado`
        : "Controle USB detectado automaticamente";
  const gamepadDescription = !gamepad.supported
    ? "Use uma versão atual do Chrome, Edge ou Firefox."
    : !gamepad.secureContext
      ? "Abra o painel por http://localhost:5173 usando o túnel SSH."
      : gamepad.connected
        ? "Detectado automaticamente · START/Options habilita o robô"
        : "Conecte o cabo e use o controle; nenhum programa é necessário.";

  return (
    <div className="app-layout">
      <AppHeader showLogout={!demoMode} demoMode={demoMode} />
      <SlamBackground className="dashboard-slam-background" />

      <main className="dashboard-page">
        {showOrientationHint && (
          <aside className="orientation-hint" aria-label="Sugestão de orientação">
            <span aria-hidden="true">↻</span>
            <p><strong>Melhor em modo paisagem</strong> Gire o aparelho para ver a câmera e os comandos lado a lado.</p>
            <button
              className="orientation-hint__close"
              type="button"
              aria-label="Fechar sugestão de orientação"
              onClick={() => setShowOrientationHint(false)}
            >
              ×
            </button>
          </aside>
        )}
        <section className="dashboard-grid">
          <div className="operation-hud">
            <div className="operation-statuses" aria-label="Status da operação">
              <span><i /> {demoMode ? "DEMONSTRAÇÃO · LIDAR 3D" : "DADOS REAIS · LIDAR 3D"}</span>
              <span>ROBÔ · <strong className={robotStatus.robot_online ? "is-online" : "is-offline"}>{robotStatus.robot_online ? "ONLINE" : "OFFLINE"}</strong></span>
              <span>LIO + IMU · <strong className={robotStatus.lio_connected ? "is-online" : "is-offline"}>{robotStatus.lio_connected ? "ESTÁVEL" : "AGUARDANDO"}</strong></span>
              <span>CÂMERA · <strong className={robotStatus.camera_connected ? "is-online" : "is-offline"}>{robotStatus.camera_connected ? "AO VIVO" : "SEM SINAL"}</strong></span>
              <span>MAPA · <strong>{Number(robotStatus.point_count || 0).toLocaleString("pt-BR")} PTS</strong></span>
            </div>
          </div>
          <article className="panel video-panel" aria-label="Câmera frontal">
            <div className="video-placeholder video-placeholder--live">
              {demoMode ? (
                <div className="demo-empty-feed" aria-label="Câmera simulada">
                  <span>DEMONSTRAÇÃO INTERATIVA</span>
                  <strong>Câmera do GO2</strong>
                  <small>Entre como operador para visualizar a transmissão ao vivo.</small>
                </div>
              ) : (
                <RobotCamera
                  accessToken={accessToken}
                  connected={robotStatus.camera_connected}
                  liveKitRoom={liveKit.room}
                  liveKitConnectionState={liveKit.connectionState}
                  liveKitErrorMessage={liveKit.errorMessage}
                />
              )}
              <div className="viewport-controls viewport-controls--camera">
                <OracleButton
                  onClick={handleOracleAnalysis}
                  isLoading={isRequestingAnalysis}
                  disabled={!demoMode && !robotStatus.camera_connected}
                />
                <button
                  className="viewport-action viewport-action--map-toggle"
                  type="button"
                  onClick={() => setIsMapOpen(true)}
                >
                  MAPA LIDAR
                </button>
              </div>
            </div>

            <div className="mobile-camera-controls" aria-label="Controles de teleoperação">
                <MobileJoystick
                  disabled={!canMove}
                  activeCommand={activeCommand}
                  onCommandStart={beginMotion}
                  onCommandStop={stopMotion}
                />

                <div className="mobile-camera-actions">
                  <button
                    className={`mobile-arm-button ${robotStatus.control_armed ? "is-active" : ""}`}
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
                        robotStatus.control_armed ? "Controle bloqueado." : "Controle habilitado.",
                      )
                    }
                  >
                    {robotStatus.control_armed ? "Bloquear" : "Habilitar"}
                  </button>

                  <button
                    className={`mobile-avoidance-button ${avoidanceRequested ? "is-active" : ""}`}
                    type="button"
                    aria-pressed={avoidanceRequested}
                    disabled={!robotStatus.sdk_connected || Boolean(pendingAction)}
                    onClick={() =>
                      handleAction(
                        "set_obstacle_avoidance",
                        { enabled: !avoidanceRequested },
                        avoidanceRequested
                          ? "Desativação do anticolisão enviada."
                          : "Ativação do anticolisão enviada.",
                      )
                    }
                  >
                    Anticolisão {avoidanceRequested ? "ON" : "OFF"}
                  </button>

                  <div className="mobile-posture-actions" aria-label="Ações de postura">
                    <button
                      className="ui-button ui-button--secondary"
                      type="button"
                      disabled={standUpDisabled}
                      onClick={() => handleAction("stand_up", {}, "Comando para levantar enviado.")}
                    >
                      <span aria-hidden="true">↑</span> Levantar
                    </button>
                    <button
                      className="ui-button ui-button--secondary"
                      type="button"
                      disabled={standDownDisabled}
                      onClick={() => handleAction("stand_down", {}, "Comando para deitar enviado.")}
                    >
                      <span aria-hidden="true">↓</span> Deitar
                    </button>
                  </div>

                  <div className="mobile-speed" aria-label={`Velocidade ${speed}%`}>
                    <button
                      type="button"
                      aria-label="Diminuir velocidade"
                      disabled={!robotStatus.sdk_connected || speed <= speedMin || Boolean(pendingAction)}
                      onClick={() => handleSpeedChange(lowerSpeed)}
                    >−</button>
                    <strong>{speed}% · {selectedForwardSpeed.toFixed(2)} m/s</strong>
                    <button
                      type="button"
                      aria-label="Aumentar velocidade"
                      disabled={!robotStatus.sdk_connected || speed >= speedMax || Boolean(pendingAction)}
                      onClick={() => handleSpeedChange(higherSpeed)}
                    >+</button>
                  </div>

                  <button
                    className="ui-button ui-button--danger mobile-emergency"
                    type="button"
                    onClick={handleDamping}
                    disabled={(!accessToken && !demoMode) || pendingAction === "damping"}
                  >
                    <span aria-hidden="true">■</span> Damping
                  </button>
                </div>
            </div>
          </article>

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
                      : avoidanceConfirmed
                        ? "Controle habilitado com anticolisão confirmado."
                        : avoidanceRequested
                          ? "Controle habilitado; proteção solicitada sem confirmação nativa."
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
                className={`ui-button teleoperation-avoidance-button ${avoidanceRequested ? "is-enabled" : "is-disabled"}`}
                type="button"
                aria-pressed={avoidanceRequested}
                disabled={
                  !robotStatus.sdk_connected ||
                  Boolean(pendingAction)
                }
                onClick={() =>
                  handleAction(
                    "set_obstacle_avoidance",
                    { enabled: !avoidanceRequested },
                    avoidanceRequested
                      ? "Desativação do anticolisão enviada."
                      : "Ativação do anticolisão enviada.",
                  )
                }
              >
                <strong>
                  {avoidanceChanging
                    ? "Confirmando Obstacle Avoidance..."
                    : avoidanceRequested
                      ? "Desativar Obstacle Avoidance"
                      : "Ativar Obstacle Avoidance"}
                </strong>
                <small>
                  {avoidanceRequested
                    ? avoidanceConfirmed
                      ? "Proteção nativa confirmada e ativa"
                      : "Solicitado · confirmação nativa indisponível"
                    : avoidanceStateConfirmed
                      ? "Estado nativo confirmado como desativado"
                      : "Modo livre solicitado · sem proteção confirmada"}
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
                  <small>WASD · controle USB analógico</small>
                </div>
              </div>
              <div
                className={`gamepad-status ${gamepad.connected ? "is-connected" : ""}`}
                role="status"
              >
                <span className="gamepad-status__icon" aria-hidden="true">🎮</span>
                <div>
                  <strong>{gamepadTitle}</strong>
                  <small>{gamepadDescription}</small>
                </div>
                {gamepad.connected && (
                  <b>{gamepad.standardMapping ? "PADRÃO" : "COMPATÍVEL"}</b>
                )}
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
                  onClick={() => handleSpeedChange(lowerSpeed)}
                >−</button>
                <strong>{speed}%</strong>
                <button
                  className="teleoperation-speed__button"
                  type="button"
                  aria-label="Aumentar velocidade"
                  disabled={!robotStatus.sdk_connected || speed >= speedMax || Boolean(pendingAction)}
                  onClick={() => handleSpeedChange(higherSpeed)}
                >+</button>
              </div>
              <small>
                Nível operacional · {speedMin}%–{speedMax}% · comando frontal exato: {selectedForwardSpeed.toFixed(2)} m/s
              </small>
            </section>
          </div>

          <div className="teleoperation-footer">
            <button
              className="ui-button ui-button--danger teleoperation-emergency"
              type="button"
              onClick={handleDamping}
              disabled={(!accessToken && !demoMode) || pendingAction === "damping"}
            >
              <span aria-hidden="true">■</span> Damping
            </button>
          </div>
          {statusMessage && <p className="operation-message" role="status">{statusMessage}</p>}
          </section>
        </section>

        {isMapOpen && (
          <section className="map-drawer" role="dialog" aria-label="Mapeamento tridimensional">
            <article className="panel navigation-panel">
              <div className="panel-header">
                <div className="map-drawer-actions">
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
                <button className="viewport-action" type="button" onClick={() => setIsMapOpen(false)}>
                  FECHAR
                </button>
              </div>
              <div className="map-placeholder map-placeholder--live">
                <PointCloudMap
                  points={demoMode ? points : isLiveKitEnabled ? liveKit.points : points}
                  pose={robotStatus.current_pose}
                />
              </div>
              <div className="map-location">
                <div><span>X</span><strong>{coordinate(location?.x)}</strong></div>
                <div><span>Y</span><strong>{coordinate(location?.y)}</strong></div>
                <div><span>Z</span><strong>{coordinate(location?.z)}</strong></div>
                <div><span>YAW</span><strong>{Number.isFinite(location?.yaw_deg) ? `${location.yaw_deg.toFixed(1)}°` : "--"}</strong></div>
              </div>
            </article>
          </section>
        )}
      </main>
    </div>
  );
}

export default DashboardPage;
