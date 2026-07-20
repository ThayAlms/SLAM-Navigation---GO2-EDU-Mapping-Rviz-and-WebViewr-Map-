import assert from "node:assert/strict";
import test from "node:test";

import {
  gamepadDisplayName,
  hasGamepadMotion,
  readGamepadMotion,
  shapeGamepadAxis,
} from "./gamepad.js";

test("ignora deriva dentro da zona morta", () => {
  assert.equal(shapeGamepadAxis(0.1), 0);
  assert.equal(shapeGamepadAxis(-0.14), 0);
});

test("mantém curso total e resposta progressiva", () => {
  assert.equal(shapeGamepadAxis(1), 1);
  assert.equal(shapeGamepadAxis(-1), -1);
  assert.ok(shapeGamepadAxis(0.5) > 0);
  assert.ok(shapeGamepadAxis(0.5) < 0.5);
});

test("mapeia os manches no mesmo sistema de coordenadas do RC Unitree", () => {
  const vector = readGamepadMotion({ axes: [-1, -1, 1, 0] });

  assert.deepEqual(vector, { forward: 1, lateral: 1, yaw: -1 });
  assert.equal(hasGamepadMotion(vector), true);
  assert.equal(hasGamepadMotion({ forward: 0, lateral: 0, yaw: 0 }), false);
});

test("identifica controles comuns", () => {
  assert.equal(gamepadDisplayName("DualSense Wireless Controller"), "Controle PS5");
  assert.equal(gamepadDisplayName("DualShock 4"), "Controle PS4");
  assert.equal(gamepadDisplayName("Xbox 360 Controller (XInput)"), "Controle Xbox");
});
