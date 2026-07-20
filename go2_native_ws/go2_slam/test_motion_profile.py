import unittest

from motion_profile import analog_velocity


class MotionProfileTest(unittest.TestCase):
    def test_full_stick_matches_go2_edu_native_limits(self):
        self.assertEqual(analog_velocity(1, 1, 1, 100), (5.0, 1.0, 4.0))
        self.assertEqual(analog_velocity(-1, -1, -1, 100), (-2.5, -1.0, -4.0))

    def test_speed_percentage_scales_every_axis(self):
        self.assertEqual(analog_velocity(1, 1, 1, 50), (2.5, 0.5, 2.0))

    def test_invalid_axis_is_rejected(self):
        for value in (None, True, float("nan"), 1.01, -1.01):
            with self.subTest(value=value), self.assertRaises(ValueError):
                analog_velocity(value, 0, 0, 100)


if __name__ == "__main__":
    unittest.main()
