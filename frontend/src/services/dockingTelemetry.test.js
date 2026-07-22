import assert from "node:assert/strict";
import test from "node:test";

import {
  dockingDistanceLabel,
  readDockingPresentation,
} from "./dockingTelemetry.js";

test("resume os estados da estação para a faixa operacional", () => {
  assert.equal(readDockingPresentation({}).label, "NÃO CALIBRADA");
  assert.equal(
    readDockingPresentation({ docking_station_calibrated: true }).label,
    "PRONTA",
  );
  assert.equal(
    readDockingPresentation({ docking_active: true, docking_state: "adjusting" })
      .label,
    "AJUSTANDO",
  );
  assert.equal(readDockingPresentation({ charging: true }).label, "CARREGANDO");
});

test("formata a distância restante em metros", () => {
  assert.equal(dockingDistanceLabel(1.234), "1,23 M");
  assert.equal(dockingDistanceLabel(null), "");
});
