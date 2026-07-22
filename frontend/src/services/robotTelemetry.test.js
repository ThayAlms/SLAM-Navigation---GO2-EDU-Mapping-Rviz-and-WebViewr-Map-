import assert from "node:assert/strict";
import test from "node:test";

import {
  formatAutonomy,
  formatBatteryPercent,
  formatCurrentSpeed,
  readCurrentSpeed,
  readRobotActivity,
} from "./robotTelemetry.js";

test("lê a velocidade linear real do sport state", () => {
  assert.equal(readCurrentSpeed({ sport_state: { velocity: [0.3, 0.4, 0] } }), 0.5);
  assert.equal(readCurrentSpeed({ current_speed_mps: 0.8 }), 0.8);
});

test("prioriza carregamento nos três estados do robô", () => {
  assert.deepEqual(readRobotActivity({ charging: true, current_speed_mps: 1 }), {
    key: "charging",
    label: "CARREGANDO",
  });
  assert.equal(readRobotActivity({ current_speed_mps: 0.2 }).label, "ANDANDO");
  assert.equal(readRobotActivity({ current_speed_mps: 0 }).label, "PARADO");
});

test("formata bateria, autonomia e velocidade para o dashboard", () => {
  assert.equal(formatBatteryPercent(46.4), "46%");
  assert.equal(formatBatteryPercent(null), "--");
  assert.equal(formatAutonomy(91), "1H 31MIN");
  assert.equal(formatAutonomy(null), "CALCULANDO");
  assert.equal(formatAutonomy(20, true), "CARREGANDO");
  assert.equal(formatCurrentSpeed(0.456), "0,46");
});
