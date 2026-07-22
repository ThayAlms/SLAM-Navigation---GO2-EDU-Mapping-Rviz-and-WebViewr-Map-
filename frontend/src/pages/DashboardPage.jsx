import { useCallback, useEffect, useRef, useState } from "react";

import AppHeader from "../components/AppHeader";
import MobileJoystick from "../components/MobileJoystick";
import OnlineUsersPresence from "../components/OnlineUsersPresence";
import OracleButton from "../components/OracleButton";
import PointCloudMap from "../components/PointCloudMap";
import RobotCamera from "../components/RobotCamera";
import SlamBackground from "../components/SlamBackground";
import { useAuth } from "../context/useAuth";
import { useToast } from "../context/useToast";
import {
  getRobotMap,
  getRobotStatus,
  requestOracleAnalysis,
  sendRobotCommand,
} from "../services/api";
import { isLiveKitEnabled } from "../services/livekit";
import { publishLiveKitCommand } from "../services/livekitCommands";
import {
  dockingDistanceLabel,
  readDockingPresentation,
} from "../services/dockingTelemetry";
import {
  formatAutonomy,
  formatBatteryPercent,
  formatCurrentSpeed,
  readCurrentSpeed,
  readRobotActivity,
} from "../services/robotTelemetry";
import { forwardSpeedMps } from "../services/speedProfile";
import { useGamepadControl } from "../services/useGamepadControl";
import { useHidGamepadControl } from "../services/useHidGamepadControl";
import { useLiveKitRobot } from "../services/useLiveKitRobot";

const OBSTACLE_AVOIDANCE_ADMIN_ONLY_MESSAGE =
  "Somente administradores podem alterar o anticolisão.";

const OFFLINE_STATUS = {
  robot_online: false,
  network_online: false,
  sdk_connected: false,
  gateway_connected: false,
  camera_connected: false,
  lio_connected: false,
  battery_connected: false,
  battery_percent: null,
  charging: false,
  autonomy_minutes: null,
  current_speed_mps: 0,
  robot_activity_status: "stopped",
  aruco_available: false,
  docking_station_calibrated: false,
  docking_station_marker_calibrated: false,
  docking_calibration_ready: false,
  docking_marker_visible: false,
  docking_marker: null,
  docking_marker_matches_station: false,
  docking_active: false,
  docking_state: "unavailable",
  docking_message: null,
  docking_error: null,
  docking_distance_m: null,
  docking_adjustment_count: 0,
  docking_next_adjustment_seconds: null,
  sport_state: null,
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

const STATUS_REFRESH_INTERVAL_MS = 1_000;
const STATUS_RETRY_INTERVAL_MS = 4_000;
const STATUS_FAILURES_BEFORE_BACKOFF = 3;
const MAP_REFRESH_INTERVAL_MS = 850;
const MAP_FAILURES_BEFORE_CLEAR = 4;
const MOTION_HEARTBEAT_MS = 80;
const SESSION_EXPIRED_MESSAGE = "Sessão expirada. Entre novamente para continuar.";
const STOP_FAILURE_MESSAGE =
  "Falha ao enviar o comando de parada. Se o robô continuar em movimento, use a Parada de emergência.";

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

function ControlModeSelector({
  mode,
  gamepadConnected,
  gamepadAvailable,
  mobile = false,
  hud = false,
  onSelect,
}) {
  return (
    <div
      className={`control-mode-selector ${mobile ? "control-mode-selector--mobile" : ""} ${hud ? "control-mode-selector--hud" : ""}`}
      role="group"
      aria-label="Fonte do controle de movimento"
    >
      <button
        className={mode === "manual" ? "is-active" : ""}
        type="button"
        aria-pressed={mode === "manual"}
        onClick={() => onSelect("manual")}
      >
        <span aria-hidden="true">⌨</span>
        <strong>Botões</strong>
      </button>
      <button
        className={mode === "gamepad" ? "is-active" : ""}
        type="button"
        aria-label={gamepadConnected ? "Controle USB conectado" : "Controle USB"}
        aria-pressed={mode === "gamepad"}
        disabled={!gamepadAvailable}
        onClick={() => onSelect("gamepad")}
      >
        <span aria-hidden="true">🎮</span>
        <strong>Controle USB</strong>
        {gamepadConnected && <i aria-hidden="true" />}
      </button>
    </div>
  );
}

function DashboardPage() {
  const { session, user } = useAuth();
  const { notifyError, notifySuccess } = useToast();
  const accessToken = session?.access_token;
  const canManageObstacleAvoidance = user?.role === "admin";
  const [polledRobotStatus, setRobotStatus] = useState(OFFLINE_STATUS);
  const [points, setPoints] = useState([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [activeCommand, setActiveCommand] = useState(null);
  const [pendingAction, setPendingAction] = useState("");
  const [requestedSpeed, setRequestedSpeed] = useState(null);
  const [isRequestingAnalysis, setIsRequestingAnalysis] = useState(false);
  const [isMapOpen, setIsMapOpen] = useState(false);
  const [showOrientationHint, setShowOrientationHint] = useState(true);
  const [controlMode, setControlMode] = useState("manual");
  const [backendUnreachable, setBackendUnreachable] = useState(false);
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
  const analogVectorRef = useRef(null);
  const controlModeRef = useRef("manual");
  const controllerWasConnectedRef = useRef(false);
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

  const reportError = useCallback(
    (error, fallbackMessage = "Ocorreu um erro inesperado.") => {
      const message =
        error?.status === 401
          ? SESSION_EXPIRED_MESSAGE
          : error?.message || fallbackMessage;
      setStatusMessage(message);
      notifyError(message);
    },
    [notifyError],
  );

  useEffect(() => {
    canMoveRef.current = canMove;
  }, [canMove]);

  useEffect(() => {
    controlModeRef.current = controlMode;
  }, [controlMode]);

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
    let timerId = null;
    let consecutiveFailures = 0;

    // Cadeia de setTimeout: a próxima consulta só sai depois da anterior
    // terminar, evitando requisições acumuladas quando o backend está lento.
    async function loadStatus() {
      try {
        const nextStatus = await getRobotStatus(accessToken);
        if (!active) return;
        setRobotStatus({ ...OFFLINE_STATUS, ...nextStatus });
        if (consecutiveFailures > 0) {
          notifySuccess("Conexão com o backend restabelecida.");
        }
        consecutiveFailures = 0;
        setBackendUnreachable(false);
      } catch (error) {
        if (!active) return;
        consecutiveFailures += 1;
        setRobotStatus(OFFLINE_STATUS);
        setBackendUnreachable(true);
        // Avisa uma vez na queda; o banner cobre o restante do período.
        if (consecutiveFailures === 1) {
          notifyError(
            error?.status === 401 ? SESSION_EXPIRED_MESSAGE : error.message,
          );
        }
      } finally {
        if (active) {
          const delay =
            consecutiveFailures >= STATUS_FAILURES_BEFORE_BACKOFF
              ? STATUS_RETRY_INTERVAL_MS
              : STATUS_REFRESH_INTERVAL_MS;
          timerId = window.setTimeout(loadStatus, delay);
        }
      }
    }

    loadStatus();
    return () => {
      active = false;
      window.clearTimeout(timerId);
    };
  }, [accessToken, notifyError, notifySuccess]);

  useEffect(() => {
    if (!accessToken || isLiveKitEnabled) return undefined;
    let active = true;
    let timerId = null;
    let consecutiveFailures = 0;

    async function loadMap() {
      try {
        const payload = await getRobotMap(accessToken);
        if (!active) return;
        consecutiveFailures = 0;
        setPoints(payload.points || []);
      } catch {
        if (!active) return;
        // Falha isolada não apaga o mapa; só limpa em queda prolongada.
        consecutiveFailures += 1;
        if (consecutiveFailures >= MAP_FAILURES_BEFORE_CLEAR) setPoints([]);
      } finally {
        if (active) timerId = window.setTimeout(loadMap, MAP_REFRESH_INTERVAL_MS);
      }
    }

    loadMap();
    return () => {
      active = false;
      window.clearTimeout(timerId);
    };
  }, [accessToken]);

  useEffect(() => {
    if (!isLiveKitEnabled) return;
    if (liveKit.connectionState === "error" && liveKit.errorMessage) {
      notifyError(liveKit.errorMessage);
    } else if (liveKit.connectionState === "disconnected") {
      notifyError("Conexão em tempo real perdida. Tentando reconectar...");
    }
  }, [liveKit.connectionState, liveKit.errorMessage, notifyError]);

  const stopMotion = useCallback(
    (sendStop = true) => {
      motionSessionRef.current += 1;
      motionPointerRef.current = null;
      analogVectorRef.current = null;
      window.clearTimeout(motionTimerRef.current);
      motionTimerRef.current = null;
      activeCommandRef.current = null;
      setActiveCommand(null);
      if (sendStop && accessToken) {
        dispatchRobotCommand("stop").catch(() => {
          // Perder o "stop" é grave: o watchdog do gateway ainda para o robô,
          // mas o operador precisa saber imediatamente.
          setStatusMessage(STOP_FAILURE_MESSAGE);
          notifyError(STOP_FAILURE_MESSAGE, { duration: 10_000 });
        });
      }
    },
    [accessToken, dispatchRobotCommand, notifyError],
  );

  const beginMotion = useCallback(
    (command) => {
      if (
        controlModeRef.current !== "manual" ||
        !accessToken ||
        !canMoveRef.current
      ) return;
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
            reportError(error, "Falha ao enviar o comando de movimento.");
          }
        }
      }

      pulse();
    },
    [accessToken, dispatchRobotCommand, reportError, stopMotion],
  );

  const beginAnalogMotion = useCallback(
    (vector) => {
      if (
        controlModeRef.current !== "gamepad" ||
        !accessToken ||
        !canMoveRef.current
      ) return;
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
            reportError(error, "Falha ao enviar o comando analógico.");
          }
        }
      }

      pulse();
    },
    [accessToken, dispatchRobotCommand, reportError, stopMotion],
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
    if (command === "set_obstacle_avoidance" && !canManageObstacleAvoidance) {
      setStatusMessage(OBSTACLE_AVOIDANCE_ADMIN_ONLY_MESSAGE);
      notifyError(OBSTACLE_AVOIDANCE_ADMIN_ONLY_MESSAGE);
      return false;
    }
    if (!accessToken || pendingActionRef.current) return false;
    pendingActionRef.current = command;
    stopMotion(false);
    setPendingAction(command);
    setStatusMessage("");
    try {
      const result = await dispatchRobotCommand(command, payload);
      let finalMessage = successMessage;
      if (command === "save_map" && result?.result?.point_count) {
        finalMessage = `Mapa salvo com ${result.result.point_count.toLocaleString("pt-BR")} pontos.`;
      }
      setStatusMessage(finalMessage);
      notifySuccess(finalMessage);
      return true;
    } catch (error) {
      reportError(error, "Não foi possível concluir a operação.");
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
    if (!accessToken) return;
    setIsRequestingAnalysis(true);
    setStatusMessage("");
    try {
      await requestOracleAnalysis(accessToken);
      const message = "Captura adicionada à fila de análise da Oracle.";
      setStatusMessage(message);
      notifySuccess(message);
    } catch (error) {
      reportError(error, "Não foi possível solicitar a análise da Oracle.");
    } finally {
      setIsRequestingAnalysis(false);
    }
  }

  function handleDamping() {
    stopMotion(false);
    handleAction(
      "damping",
      {},
      "Parada de emergência acionada; o robô amorteceu e o controle continua disponível.",
    );
  }

  const connectionIssue = isLiveKitEnabled
      ? liveKit.connectionState === "error" || liveKit.connectionState === "disconnected"
        ? "Conexão em tempo real indisponível · tentando reconectar..."
        : ""
      : backendUnreachable
        ? "Sem resposta do backend · tentando reconectar..."
        : "";

  const location = robotStatus.current_location;
  const telemetrySpeed = robotStatus.speed_limit_percent;
  const speed = requestedSpeed ?? telemetrySpeed;
  const speedMin = robotStatus.speed_min_percent;
  const speedMax = robotStatus.speed_max_percent;
  const speedStep = robotStatus.speed_step_percent;
  const lowerSpeed = Math.max(speedMin, speed - speedStep);
  const higherSpeed = Math.min(speedMax, speed + speedStep);
  const selectedForwardSpeed = forwardSpeedMps(speed);
  const currentSpeed = readCurrentSpeed(robotStatus);
  const batteryPercent = Number(robotStatus.battery_percent);
  const batteryLabel = formatBatteryPercent(robotStatus.battery_percent);
  const autonomyLabel = formatAutonomy(
    robotStatus.autonomy_minutes,
    robotStatus.charging,
  );
  const activity = readRobotActivity(robotStatus);
  const dockingPresentation = readDockingPresentation(robotStatus);
  const dockingDistance = dockingDistanceLabel(
    robotStatus.docking_distance_m,
  );
  const dockingActive = Boolean(robotStatus.docking_active);
  const dockingCalibrated = Boolean(
    robotStatus.docking_station_calibrated,
  );
  const calibrationReady = Boolean(robotStatus.docking_calibration_ready);
  const dockingActionPending = [
    "start_docking",
    "cancel_docking",
  ].includes(pendingAction);
  const dockingActionDisabled = dockingActive
    ? dockingActionPending
    : !robotStatus.sdk_connected ||
      !dockingCalibrated ||
      robotStatus.charging ||
      Boolean(pendingAction);
  const calibrationDisabled =
    !calibrationReady || dockingActive || Boolean(pendingAction);
  const batteryTone = !robotStatus.battery_connected
    ? "is-offline"
    : robotStatus.charging
      ? "is-charging"
      : batteryPercent <= 15
        ? "is-offline"
        : batteryPercent <= 30
          ? "is-warning"
          : "is-online";

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
        ? "Proteção confirmada"
        : "Comando enviado · aguardando confirmação";
  const safetyTitle = !avoidanceRequested
    ? "Anticolisão desativada"
    : avoidanceConfirmed
      ? "Anticolisão confirmado"
      : "Anticolisão solicitada";
  const controlLabel = robotStatus.safety_blocked
    ? "LIMITE DE SEGURANÇA"
    : robotStatus.control_armed
      ? robotStatus.safety_ready
        ? "CONTROLE HABILITADO"
        : "CONFIRMANDO PROTEÇÃO"
      : "CONTROLE BLOQUEADO";
  const gamepad = useGamepadControl({
    enabled: controlMode === "gamepad",
    canMove,
    onMotion: beginAnalogMotion,
    onStop: stopMotion,
    onAction(action) {
      if (!accessToken || pendingAction) return;
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
  const hidGamepad = useHidGamepadControl({
    enabled: controlMode === "gamepad" && !gamepad.connected,
    canMove,
    onMotion: beginAnalogMotion,
    onStop: stopMotion,
  });
  const controller = gamepad.connected ? gamepad : hidGamepad;
  const controllerConnected = gamepad.connected || hidGamepad.connected;
  const controllerSupported = gamepad.supported || hidGamepad.supported;
  const controllerName = controllerConnected ? controller.name : "";

  useEffect(() => {
    const wasConnected = controllerWasConnectedRef.current;
    controllerWasConnectedRef.current = controllerConnected;

    if (!wasConnected && controllerConnected) {
      controlModeRef.current = "gamepad";
      pressedMotionKeysRef.current.clear();
      stopMotion();
      setControlMode("gamepad");
      setStatusMessage(
        `${controllerName} detectado automaticamente. Centralize os manches e use o controle.`,
      );
      return;
    }

    if (wasConnected && !controllerConnected && controlModeRef.current === "gamepad") {
      controlModeRef.current = "manual";
      pressedMotionKeysRef.current.clear();
      stopMotion();
      setControlMode("manual");
      setStatusMessage("Controle USB desconectado. Botões e teclado reativados automaticamente.");
    }
  }, [controllerConnected, controllerName, stopMotion]);

  const gamepadTitle = !controllerSupported
    ? "Navegador sem suporte a controles USB"
    : !gamepad.secureContext
      ? "Controle USB exige conexão segura"
      : controllerConnected
        ? `${controllerName} conectado`
        : "Nenhum controle USB detectado";
  const gamepadDescription = !controllerSupported
    ? "Use um navegador atualizado; alguns controles podem não ser reconhecidos."
    : !gamepad.secureContext
      ? "Abra o painel pelo endereço oficial (https) para usar o controle."
      : controllerConnected
        ? controlMode === "gamepad"
          ? controller.waitingForNeutral
            ? "Centralize os manches para liberar o movimento"
            : controller.error
              ? controller.error
              : controller.motionDetected
              ? "Entrada analógica reconhecida pelo navegador"
              : hidGamepad.connected && !gamepad.connected
                ? "Controle autorizado · mova um manche para testar"
                : "Modo USB ativo · mova um manche para testar"
          : "Conectado · Botões foi selecionado manualmente"
        : hidGamepad.error
          ? hidGamepad.error
          : hidGamepad.supported
            ? "Conecte e pressione um botão; se não detectar, clique em Controle USB para identificar."
            : "Conecte o cabo e pressione qualquer botão ou manche.";

  async function selectControlMode(nextMode) {
    const needsHidIdentification =
      nextMode === "gamepad" && !controllerConnected && hidGamepad.supported;
    if (nextMode !== controlMode) {
      controlModeRef.current = nextMode;
      pressedMotionKeysRef.current.clear();
      stopMotion();
      setControlMode(nextMode);
      setStatusMessage(
        nextMode === "gamepad"
          ? controllerConnected
            ? "Controle USB selecionado. Centralize os manches para liberar o movimento."
            : needsHidIdentification
              ? "Selecione seu controle USB na janela do navegador."
              : "Modo USB selecionado. Conecte o controle e pressione qualquer botão."
          : "Botões e teclado selecionados para o movimento.",
      );
    } else if (!needsHidIdentification) {
      return;
    }

    if (needsHidIdentification) {
      const device = await hidGamepad.requestDevice();
      if (device) {
        setStatusMessage(
          `${device.productName || "Controle genérico"} identificado. Nas próximas conexões ele será automático.`,
        );
      } else if (!controllerWasConnectedRef.current) {
        controlModeRef.current = "manual";
        setControlMode("manual");
        setStatusMessage("Nenhum controle foi selecionado. Botões e teclado continuam ativos.");
      }
    }
  }

  return (
    <div className="app-layout">
      <AppHeader showLogout />
      <SlamBackground className="dashboard-slam-background" />

      <main className="dashboard-page">
        {connectionIssue && (
          <p className="connection-banner" role="alert">
            {connectionIssue}
          </p>
        )}
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
              <span><i /> OPERAÇÃO AO VIVO</span>
              <span>ROBÔ · <strong className={robotStatus.robot_online ? "is-online" : "is-offline"}>{robotStatus.robot_online ? "ONLINE" : "OFFLINE"}</strong></span>
              <span>SENSORES · <strong className={robotStatus.lio_connected ? "is-online" : "is-offline"}>{robotStatus.lio_connected ? "ESTÁVEL" : "AGUARDANDO"}</strong></span>
              <span>CÂMERA · <strong className={robotStatus.camera_connected ? "is-online" : "is-offline"}>{robotStatus.camera_connected ? "AO VIVO" : "SEM SINAL"}</strong></span>
              <span>MAPA · <strong>{Number(robotStatus.point_count || 0).toLocaleString("pt-BR")} PTS</strong></span>
              <OnlineUsersPresence enabled />
              <ControlModeSelector
                mode={controlMode}
                gamepadConnected={controllerConnected}
                gamepadAvailable={controllerSupported && gamepad.secureContext}
                hud
                onSelect={selectControlMode}
              />
            </div>
          </div>
          <article className="panel video-panel" aria-label="Câmera frontal">
            <div className="video-placeholder video-placeholder--live">
              <RobotCamera
                accessToken={accessToken}
                connected={robotStatus.camera_connected}
                liveKitRoom={liveKit.room}
                liveKitConnectionState={liveKit.connectionState}
                liveKitErrorMessage={liveKit.errorMessage}
                arucoMarker={robotStatus.docking_marker}
                arucoMarkerVisible={robotStatus.docking_marker_visible}
              />
              <div className="viewport-controls viewport-controls--camera">
                <OracleButton
                  onClick={handleOracleAnalysis}
                  isLoading={isRequestingAnalysis}
                  disabled={!robotStatus.camera_connected}
                />
                <button
                  className="viewport-action viewport-action--map-toggle"
                  type="button"
                  onClick={() => setIsMapOpen(true)}
                >
                  MAPA 3D
                </button>
              </div>
            </div>

            <div className="mobile-camera-controls" aria-label="Controles de teleoperação">
                <ControlModeSelector
                  mode={controlMode}
                  gamepadConnected={controllerConnected}
                  gamepadAvailable={controllerSupported && gamepad.secureContext}
                  mobile
                  onSelect={selectControlMode}
                />
                <MobileJoystick
                  disabled={!canMove || controlMode !== "manual"}
                  disabledLabel={
                    controlMode === "gamepad"
                      ? controller.waitingForNeutral
                        ? "CENTRALIZE"
                        : controller.motionDetected ? "USB DETECTADO" : "MODO USB"
                      : "BLOQUEADO"
                  }
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
                    className={`mobile-avoidance-button ${avoidanceRequested ? "is-active" : ""} ${!canManageObstacleAvoidance ? "is-role-locked" : ""}`}
                    type="button"
                    aria-pressed={avoidanceRequested}
                    aria-label={
                      canManageObstacleAvoidance
                        ? `Anticolisão ${avoidanceRequested ? "ativado" : "desativado"}`
                        : `${avoidanceRequested ? "Anticolisão ativado" : "Anticolisão desativado"}. Alteração restrita a administradores.`
                    }
                    title={
                      canManageObstacleAvoidance
                        ? undefined
                        : OBSTACLE_AVOIDANCE_ADMIN_ONLY_MESSAGE
                    }
                    disabled={
                      !canManageObstacleAvoidance ||
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
                    Anticolisão {avoidanceRequested ? "ON" : "OFF"}
                    {!canManageObstacleAvoidance && " · ADM"}
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
                    <strong>
                      <span className="mobile-speed__percent">{speed}%</span>
                      <span className="mobile-speed__metric">
                        {" · "}{selectedForwardSpeed.toFixed(2)} m/s
                      </span>
                    </strong>
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
                    disabled={!accessToken || pendingAction === "damping"}
                  >
                    <span aria-hidden="true">■</span> Parada de emergência
                  </button>
                </div>
            </div>
          </article>

          <section className="panel teleoperation-panel">
          <div className="panel-header teleoperation-heading">
            <div>
              <h2>Central de comandos</h2>
              <p>Comando e resposta do robô em tempo real.</p>
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
                          ? "Controle habilitado; proteção solicitada, sem confirmação do robô."
                          : "Controle habilitado em modo livre.",
                  )
                }
              >
                <strong>{robotStatus.control_armed ? "Bloquear controle" : "Habilitar controle"}</strong>
                <small>
                  {robotStatus.control_armed
                    ? robotStatus.safety_ready
                      ? "Canal ativo · toque para bloquear"
                      : "Aguardando confirmação do robô"
                    : "Toque para ativar o canal"}
                </small>
              </button>

              <button
                className={`ui-button teleoperation-avoidance-button ${avoidanceRequested ? "is-enabled" : "is-disabled"} ${!canManageObstacleAvoidance ? "is-role-locked" : ""}`}
                type="button"
                aria-pressed={avoidanceRequested}
                aria-label={
                  canManageObstacleAvoidance
                    ? `${avoidanceRequested ? "Desativar" : "Ativar"} anticolisão`
                    : `${avoidanceRequested ? "Anticolisão ativa" : "Anticolisão inativa"}. Alteração restrita a administradores.`
                }
                title={
                  canManageObstacleAvoidance
                    ? undefined
                    : OBSTACLE_AVOIDANCE_ADMIN_ONLY_MESSAGE
                }
                disabled={
                  !canManageObstacleAvoidance ||
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
                  {!canManageObstacleAvoidance
                    ? `Anticolisão ${avoidanceRequested ? "ativa" : "inativa"}`
                    : avoidanceChanging
                    ? "Confirmando anticolisão..."
                    : avoidanceRequested
                      ? "Desativar anticolisão"
                      : "Ativar anticolisão"}
                </strong>
                <small>
                  {!canManageObstacleAvoidance
                    ? "Somente administradores podem alterar esta função"
                    : avoidanceRequested
                    ? avoidanceConfirmed
                      ? "Proteção confirmada e ativa"
                      : "Solicitado · sem confirmação do robô"
                    : avoidanceStateConfirmed
                      ? "Proteção confirmada como desativada"
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
                  <small>Escolha botões ou controle USB</small>
                </div>
              </div>
              <ControlModeSelector
                mode={controlMode}
                gamepadConnected={controllerConnected}
                gamepadAvailable={controllerSupported && gamepad.secureContext}
                onSelect={selectControlMode}
              />
              <div
                className={`gamepad-status ${controllerConnected ? "is-connected" : ""} ${controlMode === "gamepad" ? "is-selected" : ""}`}
                role="status"
              >
                <span className="gamepad-status__icon" aria-hidden="true">🎮</span>
                <div>
                  <strong>{gamepadTitle}</strong>
                  <small>{gamepadDescription}</small>
                </div>
                {controllerConnected && (
                  <b>
                    {controlMode === "gamepad"
                      ? "ATIVO"
                      : hidGamepad.connected && !gamepad.connected
                        ? "USB"
                        : gamepad.standardMapping ? "PRONTO" : "COMPATÍVEL"}
                  </b>
                )}
              </div>
              <div className="teleoperation-pad" aria-label="Controle de movimentação">
                <button
                  className={`teleoperation-key ${activeCommand === "forward" ? "is-active" : ""}`}
                  type="button"
                  disabled={!canMove || controlMode !== "manual"}
                  onPointerDown={(event) => handleMotionPointerDown(event, "forward")}
                  onPointerUp={handleMotionPointerEnd}
                  onPointerCancel={handleMotionPointerEnd}
                  onLostPointerCapture={handleMotionPointerEnd}
                >W<span>↑</span></button>
                <div className="teleoperation-pad__row">
                  <button
                    className={`teleoperation-key ${activeCommand === "rotate_left" ? "is-active" : ""}`}
                    type="button"
                    disabled={!canMove || controlMode !== "manual"}
                    onPointerDown={(event) => handleMotionPointerDown(event, "rotate_left")}
                    onPointerUp={handleMotionPointerEnd}
                    onPointerCancel={handleMotionPointerEnd}
                    onLostPointerCapture={handleMotionPointerEnd}
                  >A<span>↶</span></button>
                  <button
                    className={`teleoperation-key ${activeCommand === "backward" ? "is-active" : ""}`}
                    type="button"
                    disabled={!canMove || controlMode !== "manual"}
                    onPointerDown={(event) => handleMotionPointerDown(event, "backward")}
                    onPointerUp={handleMotionPointerEnd}
                    onPointerCancel={handleMotionPointerEnd}
                    onLostPointerCapture={handleMotionPointerEnd}
                  >S<span>↓</span></button>
                  <button
                    className={`teleoperation-key ${activeCommand === "rotate_right" ? "is-active" : ""}`}
                    type="button"
                    disabled={!canMove || controlMode !== "manual"}
                    onPointerDown={(event) => handleMotionPointerDown(event, "rotate_right")}
                    onPointerUp={handleMotionPointerEnd}
                    onPointerCancel={handleMotionPointerEnd}
                    onLostPointerCapture={handleMotionPointerEnd}
                  >D<span>↷</span></button>
                </div>
                <small>
                  {activeCommand
                    ? MOVEMENT_LABELS[activeCommand]
                    : controlMode === "gamepad"
                      ? controller.waitingForNeutral
                        ? "CENTRALIZE OS MANCHES"
                        : controller.motionDetected
                          ? "EIXOS DETECTADOS"
                          : controllerConnected ? "USB PRONTO" : "AGUARDANDO USB"
                      : canMove ? "BOTÕES PRONTOS" : "BLOQUEADO"}
                </small>
              </div>

              <div className="teleoperation-speed-row" aria-label={`Velocidade ${speed}%`}>
                <div className="teleoperation-speed-row__label">
                  <strong>Velocidade</strong>
                  <small>{selectedForwardSpeed.toFixed(2)} m/s frontal</small>
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
              </div>
            </section>
          </div>

          <div className="teleoperation-footer">
            <button
              className="ui-button ui-button--danger teleoperation-emergency"
              type="button"
              onClick={handleDamping}
              disabled={!accessToken || pendingAction === "damping"}
            >
              <span aria-hidden="true">■</span> Parada de emergência
            </button>
          </div>
          {statusMessage && <p className="operation-message" role="status">{statusMessage}</p>}
          </section>

          <div className="telemetry-hud">
            <div
              className="operation-statuses telemetry-statuses"
              aria-label="Telemetria do robô"
            >
              <span>
                BATERIA · <strong className={batteryTone}>{batteryLabel}</strong>
              </span>
              <span>
                AUTONOMIA · <strong className={robotStatus.charging ? "is-charging" : ""}>{autonomyLabel}</strong>
              </span>
              <span>
                VELOCIDADE · <strong>{formatCurrentSpeed(currentSpeed)} M/S</strong>
              </span>
              <span>
                STATUS · <strong className={`is-${activity.key}`}>{activity.label}</strong>
              </span>
              <span className={`docking-status is-${dockingPresentation.tone}`}>
                BASE · <strong>{dockingPresentation.label}</strong>
                {dockingDistance && <small>{dockingDistance}</small>}
              </span>
              <button
                className={`docking-action-button docking-action-button--send ${dockingActive ? "is-active" : ""}`}
                type="button"
                disabled={dockingActionDisabled}
                title={
                  dockingActive
                    ? "Interromper o retorno autônomo à base"
                    : !dockingCalibrated
                      ? "Calibre a estação antes do primeiro retorno"
                      : robotStatus.charging
                        ? "O robô já está carregando"
                        : robotStatus.docking_error || robotStatus.docking_message || undefined
                }
                onClick={() =>
                  handleAction(
                    dockingActive ? "cancel_docking" : "start_docking",
                    {},
                    dockingActive
                      ? "Retorno à base cancelado."
                      : "Retorno à base iniciado com anticolisão automático.",
                  )
                }
              >
                <span aria-hidden="true">⌂</span>
                <strong>
                  {dockingActionPending
                    ? "AGUARDE..."
                    : dockingActive
                      ? "CANCELAR RETORNO"
                      : "ENVIAR À BASE"}
                </strong>
              </button>
              <button
                className="docking-action-button docking-action-button--calibrate"
                type="button"
                disabled={calibrationDisabled}
                title={
                  calibrationReady
                    ? "Salvar a pose atual, os pontos locais e a tag da estação"
                    : "Disponível quando o BMS confirmar que o robô está carregando"
                }
                onClick={() =>
                  handleAction(
                    "calibrate_docking_station",
                    {},
                    robotStatus.docking_marker_visible
                      ? "Estação calibrada com pose, pontos e tag visual."
                      : "Estação calibrada com pose e pontos do mapa.",
                  )
                }
              >
                <span aria-hidden="true">◎</span>
                <strong>
                  {pendingAction === "calibrate_docking_station"
                    ? "CALIBRANDO..."
                    : "CALIBRAR ESTAÇÃO"}
                </strong>
              </button>
            </div>
          </div>
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
            </article>
          </section>
        )}
      </main>
    </div>
  );
}

export default DashboardPage;
