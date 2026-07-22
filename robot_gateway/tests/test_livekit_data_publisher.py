import unittest

from robot_gateway.livekit_data_publisher import normalized_status


class LiveKitDockingStatusTest(unittest.TestCase):
    def test_forwards_docking_state_to_dashboard(self):
        payload = normalized_status(
            {
                "robot_connected": True,
                "docking_station_calibrated": True,
                "docking_active": True,
                "docking_state": "navigating",
                "docking_distance_m": 1.25,
                "docking_adjustment_count": 2,
                "docking_next_adjustment_seconds": 8.0,
                "docking_marker_visible": True,
            }
        )

        self.assertTrue(payload["robot_online"])
        self.assertTrue(payload["docking_station_calibrated"])
        self.assertEqual(payload["docking_state"], "navigating")
        self.assertEqual(payload["docking_distance_m"], 1.25)
        self.assertTrue(payload["docking_marker_visible"])


if __name__ == "__main__":
    unittest.main()
