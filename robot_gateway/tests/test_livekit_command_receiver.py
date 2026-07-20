import math
import unittest

from robot_gateway.livekit_command_receiver import gateway_action


class GatewayActionTest(unittest.TestCase):
    def test_maps_analog_move_to_joystick_route(self):
        path, body = gateway_action(
            "move_analog",
            {"forward": 1, "lateral": -0.5, "yaw": 0.25},
        )

        self.assertEqual(path, "/api/control/joystick")
        self.assertEqual(
            body,
            {"forward": 1.0, "lateral": -0.5, "yaw": 0.25},
        )

    def test_rejects_invalid_analog_axes(self):
        invalid_payloads = (
            {},
            {"forward": 1.1, "lateral": 0, "yaw": 0},
            {"forward": 0, "lateral": math.nan, "yaw": 0},
            {"forward": 0, "lateral": False, "yaw": 0},
        )

        for payload in invalid_payloads:
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                gateway_action("move_analog", payload)


if __name__ == "__main__":
    unittest.main()
