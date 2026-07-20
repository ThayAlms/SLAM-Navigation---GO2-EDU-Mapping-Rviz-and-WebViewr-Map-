import assert from "node:assert/strict";
import test from "node:test";

import { forwardSpeedMps, speedGain } from "./speedProfile.js";

test("mantém 100% no máximo e torna os níveis baixos progressivos", () => {
  assert.equal(forwardSpeedMps(100), 5);
  assert.equal(forwardSpeedMps(50), 1.25);
  assert.ok(Math.abs(forwardSpeedMps(20) - 0.2) < 1e-12);
  assert.ok(Math.abs(speedGain(20) - 0.04) < 1e-12);
});

test("cada botão de 10% corresponde a uma velocidade exata", () => {
  const expected = new Map([
    [10, 0.05],
    [20, 0.20],
    [30, 0.45],
    [40, 0.80],
    [50, 1.25],
    [60, 1.80],
    [70, 2.45],
    [80, 3.20],
    [90, 4.05],
    [100, 5.00],
  ]);

  for (const [percent, speed] of expected) {
    assert.ok(Math.abs(forwardSpeedMps(percent) - speed) < 1e-12);
  }
});

test("rejeita níveis fora da faixa", () => {
  assert.throws(() => speedGain(-1), RangeError);
  assert.throws(() => speedGain(101), RangeError);
  assert.throws(() => speedGain(Number.NaN), RangeError);
});
