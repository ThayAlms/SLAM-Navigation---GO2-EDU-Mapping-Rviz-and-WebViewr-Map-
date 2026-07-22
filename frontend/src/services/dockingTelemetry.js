const ACTIVE_LABELS = {
  enabling_safety: "PREPARANDO",
  enabling_control: "PREPARANDO",
  navigating: "RETORNANDO",
  adjusting: "AJUSTANDO",
  verifying_charge: "ENCAIXANDO",
  waiting_marker: "BUSCANDO TAG",
};

export function readDockingPresentation(status = {}) {
  if (status.charging || status.docking_state === "charging") {
    return { label: "CARREGANDO", tone: "charging" };
  }
  if (status.docking_active) {
    return {
      label: ACTIVE_LABELS[status.docking_state] || "RETORNANDO",
      tone: "active",
    };
  }
  if (status.docking_state === "error") {
    return { label: "FALHA", tone: "error" };
  }
  if (status.docking_state === "ready_to_calibrate") {
    return { label: "CALIBRAR", tone: "warning" };
  }
  if (status.docking_station_calibrated) {
    return { label: "PRONTA", tone: "ready" };
  }
  return { label: "NÃO CALIBRADA", tone: "offline" };
}

export function dockingDistanceLabel(value) {
  if (value === null || value === undefined || value === "") return "";
  const distance = Number(value);
  if (!Number.isFinite(distance) || distance < 0) return "";
  return `${distance.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} M`;
}
