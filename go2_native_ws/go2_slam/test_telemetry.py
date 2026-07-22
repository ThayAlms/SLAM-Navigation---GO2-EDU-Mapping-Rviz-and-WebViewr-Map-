import unittest

from go2_native_ws.go2_slam.telemetry import (
    activity_status,
    current_speed_mps,
    discharge_power_w,
    estimate_autonomy_minutes,
)


class TelemetryTest(unittest.TestCase):
    def test_reads_actual_planar_speed(self):
        self.assertAlmostEqual(
            current_speed_mps({"velocity": [0.3, 0.4, 1.2]}), 0.5
        )
        self.assertEqual(current_speed_mps(None), 0.0)

    def test_estimates_remaining_minutes_from_measured_power(self):
        power = discharge_power_w(29.6, 2.0)
        self.assertAlmostEqual(power, 59.2)
        self.assertEqual(estimate_autonomy_minutes(50, 236.8, power), 120)

    def test_rejects_idle_noise_as_power_estimate(self):
        self.assertIsNone(discharge_power_w(29.6, 0.1))
        self.assertIsNone(estimate_autonomy_minutes(50, 236.8, None))

    def test_charging_has_priority_over_movement(self):
        self.assertEqual(activity_status(True, 0.4, True), "charging")
        self.assertEqual(activity_status(False, 0.4), "moving")
        self.assertEqual(activity_status(False, 0.0), "stopped")


if __name__ == "__main__":
    unittest.main()
