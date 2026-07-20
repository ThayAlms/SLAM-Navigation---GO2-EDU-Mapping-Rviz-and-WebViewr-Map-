#!/usr/bin/env python3
"""Mapa 3D deduplicado sobre o LIO nativo e estável do Unitree Go2."""

import fcntl
import json
import math
import os
import re
import select
import signal
import sys
import termios
import threading
import time
import tty
from datetime import datetime
from pathlib import Path

import numpy as np
import rclpy
from nav_msgs.msg import Odometry
from rclpy.callback_groups import MutuallyExclusiveCallbackGroup, ReentrantCallbackGroup
from rclpy.node import Node
from rclpy.qos import (
    DurabilityPolicy,
    HistoryPolicy,
    QoSProfile,
    ReliabilityPolicy,
    qos_profile_sensor_data,
)
from sensor_msgs.msg import Imu, PointCloud2, PointField
from std_msgs.msg import String
from std_srvs.srv import Trigger
from unitree_api.msg import Request, Response
from unitree_go.msg import SportModeState

from motion_profile import (
    DEFAULT_SPEED_PERCENT,
    MAX_FORWARD_SPEED_MPS,
    MAX_LATERAL_SPEED_MPS,
    MAX_REVERSE_SPEED_MPS,
    MAX_SPEED_PERCENT,
    MAX_YAW_SPEED_RADPS,
    MIN_SPEED_PERCENT,
    MOTION_PROFILES,
    SPEED_STEP_PERCENT,
    analog_velocity,
)

DAMP_API_ID = 1001
MOVE_API_ID = 1008
STOP_API_ID = 1003
STAND_UP_API_ID = 1004
STAND_DOWN_API_ID = 1005
REMOTE_MOVE_API_ID = 1003
REMOTE_SOURCE_API_ID = 1004
REMOTE_AVOIDANCE_SWITCH_SET_API_ID = 1001
REMOTE_AVOIDANCE_SWITCH_GET_API_ID = 1002
POSTURE_TRANSITION_SECONDS = 4.0
POSTURE_CONFIRMATION_SECONDS = 0.35
POSTURE_UNKNOWN_SECONDS = 1.5
MOTION_PUBLISH_PERIOD_SECONDS = 0.02
MOTION_WATCHDOG_SECONDS = 0.25
AVOIDANCE_CONFIRMATION_TIMEOUT_SECONDS = 8.0
REMOTE_SOURCE_REFRESH_SECONDS = 10.0
OBSTACLE_STOP_GRACE_SECONDS = 0.65
OBSTACLE_STOP_CONFIRM_SECONDS = 0.30
CLOUD_STATUS_TIMEOUT_SECONDS = 3.0
SENSOR_STATUS_TIMEOUT_SECONDS = 2.0
ROBOT_STATUS_TIMEOUT_SECONDS = 2.0
SPORT_STATE_STATUS_TIMEOUT_SECONDS = 2.0
SPORT_STATE_SAFETY_TIMEOUT_SECONDS = 1.0
SAFETY_REASON_MESSAGES = {
    "native_avoidance_unconfirmed": "anticolisão nativo ainda não confirmado",
    "avoidance_mode_unconfirmed": "modo do anticolisão ainda não confirmado",
    "remote_source_unconfirmed": "canal remoto seguro ainda não confirmado",
    "sport_state_unavailable": "estado de movimento do robô indisponível",
    "native_obstacle_limit": "limite de obstáculo detectado",
}


class Go2MappingNode(Node):
    def __init__(self):
        super().__init__("go2_slam_mapping")

        default_maps = str(Path(__file__).resolve().parent.parent / "maps")
        self.declare_parameter("voxel_size", 0.05)
        self.declare_parameter("min_voxel_hits", 2)
        self.declare_parameter("max_range", 20.0)
        self.declare_parameter("max_points", 600000)
        self.declare_parameter("publish_max_points", 150000)
        self.declare_parameter("cloud_topic", "/utlidar/cloud_deskewed")
        self.declare_parameter("odom_topic", "/utlidar/robot_odom")
        self.declare_parameter("imu_topic", "/utlidar/imu")
        self.declare_parameter("keyframe_distance", 0.04)
        self.declare_parameter("keyframe_rotation_deg", 2.5)
        self.declare_parameter("keyframe_max_interval", 0.8)
        self.declare_parameter("max_angular_velocity", 1.5)
        self.declare_parameter("max_acceleration_delta", 4.0)
        self.declare_parameter("max_odometry_jump", 0.20)
        self.declare_parameter("max_odometry_rotation_deg", 20.0)
        self.declare_parameter("maps_directory", default_maps)
        self.declare_parameter("interactive", True)

        self.voxel_size = float(self.get_parameter("voxel_size").value)
        self.min_voxel_hits = int(self.get_parameter("min_voxel_hits").value)
        self.max_range = float(self.get_parameter("max_range").value)
        self.max_points = int(self.get_parameter("max_points").value)
        self.publish_max_points = int(
            self.get_parameter("publish_max_points").value
        )
        self.cloud_topic = str(self.get_parameter("cloud_topic").value)
        self.odom_topic = str(self.get_parameter("odom_topic").value)
        self.imu_topic = str(self.get_parameter("imu_topic").value)
        self.keyframe_distance = float(
            self.get_parameter("keyframe_distance").value
        )
        self.keyframe_rotation = math.radians(
            float(self.get_parameter("keyframe_rotation_deg").value)
        )
        self.keyframe_max_interval = float(
            self.get_parameter("keyframe_max_interval").value
        )
        self.max_angular_velocity = float(
            self.get_parameter("max_angular_velocity").value
        )
        self.max_acceleration_delta = float(
            self.get_parameter("max_acceleration_delta").value
        )
        self.max_odometry_jump = float(
            self.get_parameter("max_odometry_jump").value
        )
        self.max_odometry_rotation = math.radians(
            float(self.get_parameter("max_odometry_rotation_deg").value)
        )
        self.maps_directory = Path(
            str(self.get_parameter("maps_directory").value)
        ).expanduser()
        self.maps_directory.mkdir(parents=True, exist_ok=True)

        self._lock = threading.Lock()
        self._voxels = {}
        self._voxel_hits = {}
        self._scan_count = 0
        self._received_scan_count = 0
        self._rejected_scan_count = 0
        self._merged_point_count = 0
        self._received_points = 0
        self._started_at = time.monotonic()
        self._last_publish = 0.0
        self._last_cloud_at = 0.0
        self._last_imu_at = 0.0
        self._last_odom_at = 0.0
        self._last_odom_jump_at = 0.0
        self._last_saved_count = -1
        self._latest_odom = None
        self._latest_imu = None
        self._latest_sport_state = None
        self._last_sport_state_at = 0.0
        self._posture_state = "unknown"
        self._posture_target = None
        self._posture_command_at = 0.0
        self._posture_candidate = None
        self._posture_candidate_since = 0.0
        self._origin_odom = None
        self._last_keyframe_pose = None
        self._last_keyframe_at = 0.0
        self._map_frame = "odom"
        self._control_armed = False
        self._control_lock = threading.RLock()
        self._last_motion_at = 0.0
        self._last_stop_sent_at = 0.0
        self._last_command = "stop"
        self._last_command_at = 0.0
        self._command_count = 0
        self._command_counts = {
            command: 0 for command in (*MOTION_PROFILES, "move_analog")
        }
        self._motion_publish_count = 0
        self._active_velocity = (0.0, 0.0, 0.0)
        self._speed_percent = DEFAULT_SPEED_PERCENT
        self._request_sequence = time.monotonic_ns()
        self._remote_commands_from_api = False
        self._obstacle_avoidance_requested = True
        self._native_avoidance_enabled = None
        self._native_avoidance_confirmed_at = 0.0
        self._remote_source_confirmed_at = 0.0
        self._last_remote_source_request_at = 0.0
        self._remote_source_requests = {}
        self._avoidance_requests = {}
        self._last_avoidance_request_at = 0.0
        self._last_sport_response = None
        self._last_sport_response_at = 0.0
        self._last_remote_response = None
        self._last_remote_response_at = 0.0
        self._last_avoidance_response = None
        self._last_remote_source_response = None
        self._moving = False
        self._motion_started_at = 0.0
        self._obstacle_stall_started_at = 0.0
        self._safety_blocked = False
        self._safety_block_reason = None
        self._safety_blocked_at = 0.0
        self._shutdown_started = False

        # A nuvem é custosa. Mantê-la em um grupo separado evita que sua
        # deduplicação atrase IMU, odometria, estado do robô e controle.
        self._cloud_callback_group = MutuallyExclusiveCallbackGroup()
        self._state_callback_group = ReentrantCallbackGroup()
        self._control_callback_group = MutuallyExclusiveCallbackGroup()

        map_qos = QoSProfile(
            history=HistoryPolicy.KEEP_LAST,
            depth=1,
            reliability=ReliabilityPolicy.RELIABLE,
            durability=DurabilityPolicy.TRANSIENT_LOCAL,
        )

        self.map_pub = self.create_publisher(
            PointCloud2, "/go2_slam/map_cloud", map_qos
        )
        self.status_pub = self.create_publisher(
            String, "/go2_slam/status", 10
        )
        self.sport_pub = self.create_publisher(
            Request, "/api/sport/request", 10
        )
        self.remote_control_pub = self.create_publisher(
            Request, "/api/obstacles_avoid/request", 10
        )

        self.cloud_sub = self.create_subscription(
            PointCloud2,
            self.cloud_topic,
            self._cloud_callback,
            qos_profile_sensor_data,
            callback_group=self._cloud_callback_group,
        )
        self.odom_sub = self.create_subscription(
            Odometry,
            self.odom_topic,
            self._odom_callback,
            qos_profile_sensor_data,
            callback_group=self._state_callback_group,
        )
        self.imu_sub = self.create_subscription(
            Imu,
            self.imu_topic,
            self._imu_callback,
            qos_profile_sensor_data,
            callback_group=self._state_callback_group,
        )
        self.sport_state_sub = self.create_subscription(
            SportModeState,
            "/sportmodestate",
            self._sport_state_callback,
            qos_profile_sensor_data,
            callback_group=self._state_callback_group,
        )
        self.sport_response_sub = self.create_subscription(
            Response,
            "/api/sport/response",
            self._sport_response_callback,
            10,
            callback_group=self._control_callback_group,
        )
        self.remote_control_response_sub = self.create_subscription(
            Response,
            "/api/obstacles_avoid/response",
            self._remote_control_response_callback,
            10,
            callback_group=self._control_callback_group,
        )

        self.save_service = self.create_service(
            Trigger, "/go2_slam/save_map", self._save_service
        )
        self.reset_service = self.create_service(
            Trigger, "/go2_slam/reset_map", self._reset_service
        )

        self.publish_timer = self.create_timer(
            0.8,
            self.publish_map,
            callback_group=self._cloud_callback_group,
        )
        self.status_timer = self.create_timer(
            1.0,
            self.publish_status,
            callback_group=self._state_callback_group,
        )
        self.watchdog_timer = self.create_timer(
            MOTION_PUBLISH_PERIOD_SECONDS,
            self._motion_watchdog,
            callback_group=self._control_callback_group,
        )
        self.avoidance_timer = self.create_timer(
            2.0,
            self._ensure_native_obstacle_avoidance,
            callback_group=self._control_callback_group,
        )

        self.get_logger().info(
            "SLAM robusto iniciado: %s + %s -> /go2_slam/map_cloud"
            % (self.cloud_topic, self.imu_topic)
        )
        self.get_logger().info(
            "LIO nativo + IMU + quadros-chave + voxels únicos de %.2f m; salvamento em %s"
            % (self.voxel_size, self.maps_directory)
        )
        self.get_logger().warning(
            "Anticolisão nativo do Go2 solicitado via obstacles_avoid."
        )

    def _odom_callback(self, msg):
        now = time.monotonic()
        pose = msg.pose.pose
        current = {
            "x": float(pose.position.x),
            "y": float(pose.position.y),
            "z": float(pose.position.z),
            "qx": float(pose.orientation.x),
            "qy": float(pose.orientation.y),
            "qz": float(pose.orientation.z),
            "qw": float(pose.orientation.w),
        }
        previous = self._latest_odom
        if previous is not None:
            translation = math.sqrt(
                (current["x"] - previous["x"]) ** 2
                + (current["y"] - previous["y"]) ** 2
                + (current["z"] - previous["z"]) ** 2
            )
            rotation = self._quaternion_distance(current, previous)
            if (
                translation > self.max_odometry_jump
                or rotation > self.max_odometry_rotation
            ):
                self._last_odom_jump_at = now
                self.get_logger().warning(
                    "Salto de odometria rejeitado: %.3f m / %.1f graus"
                    % (translation, math.degrees(rotation)),
                    throttle_duration_sec=2.0,
                )
                return
        self._latest_odom = current
        self._last_odom_at = now
        if self._origin_odom is None:
            self._origin_odom = dict(current)

    def _imu_callback(self, msg):
        gyro = np.array(
            [
                msg.angular_velocity.x,
                msg.angular_velocity.y,
                msg.angular_velocity.z,
            ],
            dtype=np.float64,
        )
        accel = np.array(
            [
                msg.linear_acceleration.x,
                msg.linear_acceleration.y,
                msg.linear_acceleration.z,
            ],
            dtype=np.float64,
        )
        self._last_imu_at = time.monotonic()
        self._latest_imu = {
            "gyro_norm": float(np.linalg.norm(gyro)),
            "acceleration_norm": float(np.linalg.norm(accel)),
            "qx": float(msg.orientation.x),
            "qy": float(msg.orientation.y),
            "qz": float(msg.orientation.z),
            "qw": float(msg.orientation.w),
        }

    def _sport_state_callback(self, msg):
        now = time.monotonic()
        forces = [float(value) for value in msg.foot_force]
        position = [float(value) for value in msg.position]
        self._last_sport_state_at = now
        self._latest_sport_state = {
            "mode": int(msg.mode),
            "body_height": float(msg.body_height),
            "position": position,
            "velocity": [float(value) for value in msg.velocity],
            "yaw_speed": float(msg.yaw_speed),
            "range_obstacle": [
                float(value) for value in msg.range_obstacle
            ],
            "foot_force": forces,
        }

        if (
            self._posture_target
            and now - self._posture_command_at < POSTURE_TRANSITION_SECONDS
        ):
            self._posture_state = "transitioning_" + self._posture_target
            self._posture_candidate = None
            self._posture_candidate_since = 0.0
            return
        self._posture_target = None
        support_force = sum(max(0.0, value) for value in forces)
        position_height = position[2] if len(position) >= 3 else 0.0
        body_height = float(msg.body_height)
        height = (
            body_height
            if math.isfinite(body_height) and body_height > 0.0
            else position_height
        )
        if support_force > 20.0 or height > 0.20:
            candidate = "standing"
        elif support_force < 5.0 and height < 0.14:
            candidate = "lying"
        else:
            candidate = "unknown"

        if candidate == self._posture_state:
            self._posture_candidate = candidate
            self._posture_candidate_since = now
            return
        if candidate != self._posture_candidate:
            self._posture_candidate = candidate
            self._posture_candidate_since = now
            return

        confirmation_seconds = (
            POSTURE_UNKNOWN_SECONDS
            if candidate == "unknown"
            else POSTURE_CONFIRMATION_SECONDS
        )
        if now - self._posture_candidate_since >= confirmation_seconds:
            self._posture_state = candidate

    def _sport_response_callback(self, msg):
        api_id = int(msg.header.identity.api_id)
        if api_id not in {
            DAMP_API_ID,
            MOVE_API_ID,
            STOP_API_ID,
            STAND_UP_API_ID,
            STAND_DOWN_API_ID,
        }:
            return
        self._last_sport_response_at = time.monotonic()
        self._last_sport_response = {
            "request_id": int(msg.header.identity.id),
            "api_id": api_id,
            "status_code": int(msg.header.status.code),
            "data": str(msg.data),
        }

    def _remote_control_response_callback(self, msg):
        api_id = int(msg.header.identity.api_id)
        if api_id not in {
            REMOTE_AVOIDANCE_SWITCH_SET_API_ID,
            REMOTE_AVOIDANCE_SWITCH_GET_API_ID,
            REMOTE_MOVE_API_ID,
            REMOTE_SOURCE_API_ID,
        }:
            return
        status_code = int(msg.header.status.code)
        data = str(msg.data)
        self._last_remote_response_at = time.monotonic()
        response_info = {
            "request_id": int(msg.header.identity.id),
            "api_id": api_id,
            "status_code": status_code,
            "data": data,
        }
        self._last_remote_response = response_info
        if api_id in {
            REMOTE_AVOIDANCE_SWITCH_SET_API_ID,
            REMOTE_AVOIDANCE_SWITCH_GET_API_ID,
        }:
            self._last_avoidance_response = response_info
            request_id = int(msg.header.identity.id)
            requested = self._avoidance_requests.pop(request_id, None)
            enabled = requested
            if data:
                try:
                    payload = json.loads(data)
                    if "enable" in payload:
                        enabled = bool(payload["enable"])
                except (TypeError, ValueError, AttributeError):
                    enabled = None
            if status_code == 0 and enabled is not None:
                self._native_avoidance_enabled = enabled
                self._native_avoidance_confirmed_at = (
                    self._last_remote_response_at
                )
            elif status_code != 0:
                self._native_avoidance_confirmed_at = 0.0
        elif api_id == REMOTE_SOURCE_API_ID:
            self._last_remote_source_response = response_info
            request_id = int(msg.header.identity.id)
            requested = self._remote_source_requests.pop(request_id, None)
            if requested is None:
                return
            if status_code == 0:
                self._remote_commands_from_api = requested
                self._remote_source_confirmed_at = (
                    self._last_remote_response_at if requested else 0.0
                )
            elif requested:
                self._remote_commands_from_api = False
                self._remote_source_confirmed_at = 0.0

    def _native_avoidance_ready(self, now=None):
        return (
            self._obstacle_avoidance_state_ready(now)
            and self._native_avoidance_enabled is True
        )

    def _obstacle_avoidance_state_ready(self, now=None):
        now = time.monotonic() if now is None else now
        return (
            self._native_avoidance_enabled
            is self._obstacle_avoidance_requested
            and self._native_avoidance_confirmed_at > 0.0
            and now - self._native_avoidance_confirmed_at
            <= AVOIDANCE_CONFIRMATION_TIMEOUT_SECONDS
        )

    def _obstacle_avoidance_command_ready(self, now=None):
        now = time.monotonic() if now is None else now
        return self._obstacle_avoidance_state_ready(now) or (
            self._last_avoidance_request_at > 0.0
            and now - self._last_avoidance_request_at
            <= AVOIDANCE_CONFIRMATION_TIMEOUT_SECONDS
        )

    def _remote_source_ready(self, now=None):
        del now
        return (
            self._remote_commands_from_api is True
            and self._remote_source_confirmed_at > 0.0
        )

    def _remote_source_operational(self):
        return self._remote_commands_from_api is True

    def _ensure_native_obstacle_avoidance(self):
        now = time.monotonic()
        if now - self._last_avoidance_request_at < 1.5:
            return
        if not self._obstacle_avoidance_state_ready(now):
            self._request_obstacle_avoidance_state(
                self._obstacle_avoidance_requested
            )
        else:
            self._request_obstacle_avoidance_state()
        if self._control_armed and (
            not self._remote_source_ready(now)
            or now - self._last_remote_source_request_at
            >= REMOTE_SOURCE_REFRESH_SECONDS
        ):
            self._set_remote_command_source(True)

    def _movement_safety_reason(self, vx, vy, vyaw):
        del vx, vy, vyaw
        now = time.monotonic()
        if not self._obstacle_avoidance_command_ready(now):
            return (
                "native_avoidance_unconfirmed"
                if self._obstacle_avoidance_requested
                else "avoidance_mode_unconfirmed"
            )
        if self._control_armed and not self._remote_source_operational():
            return "remote_source_unconfirmed"
        if now - self._last_sport_state_at > SPORT_STATE_SAFETY_TIMEOUT_SECONDS:
            return "sport_state_unavailable"
        return None

    def _native_motion_stalled(self, now):
        if not self._moving or now - self._motion_started_at < OBSTACLE_STOP_GRACE_SECONDS:
            self._obstacle_stall_started_at = 0.0
            return False
        if self._latest_sport_state is None or now - self._last_sport_state_at > 0.25:
            self._obstacle_stall_started_at = 0.0
            return False

        vx, vy, vyaw = self._active_velocity
        actual = self._latest_sport_state.get("velocity", [0.0, 0.0, 0.0])
        linear_command = math.hypot(vx, vy)
        if linear_command > 0.01 and len(actual) >= 2:
            progress = math.hypot(actual[0], actual[1])
            threshold = max(0.008, linear_command * 0.18)
        elif abs(vyaw) > 0.02:
            progress = abs(self._latest_sport_state.get("yaw_speed", 0.0))
            threshold = max(0.015, abs(vyaw) * 0.15)
        else:
            self._obstacle_stall_started_at = 0.0
            return False

        if progress > threshold:
            self._obstacle_stall_started_at = 0.0
            return False
        if not self._obstacle_stall_started_at:
            self._obstacle_stall_started_at = now
            return False
        return now - self._obstacle_stall_started_at >= OBSTACLE_STOP_CONFIRM_SECONDS

    @staticmethod
    def _quaternion_distance(first, second):
        dot = abs(
            first["qx"] * second["qx"]
            + first["qy"] * second["qy"]
            + first["qz"] * second["qz"]
            + first["qw"] * second["qw"]
        )
        return 2.0 * math.acos(max(-1.0, min(1.0, dot)))

    @staticmethod
    def _quaternion_yaw(pose):
        siny = 2.0 * (pose["qw"] * pose["qz"] + pose["qx"] * pose["qy"])
        cosy = 1.0 - 2.0 * (pose["qy"] ** 2 + pose["qz"] ** 2)
        return math.atan2(siny, cosy)

    def _current_location(self):
        pose = self._latest_odom
        origin = self._origin_odom
        if pose is None or origin is None:
            return None
        yaw = self._quaternion_yaw(pose) - self._quaternion_yaw(origin)
        yaw = math.atan2(math.sin(yaw), math.cos(yaw))
        return {
            "x": pose["x"] - origin["x"],
            "y": pose["y"] - origin["y"],
            "z": pose["z"] - origin["z"],
            "yaw_rad": yaw,
            "yaw_deg": math.degrees(yaw),
            "frame": self._map_frame,
        }

    def _accept_keyframe(self, now):
        imu = self._latest_imu
        if imu is None or now - self._last_imu_at > 0.25:
            return False
        if imu["gyro_norm"] > self.max_angular_velocity:
            return False
        if abs(imu["acceleration_norm"] - 9.80665) > self.max_acceleration_delta:
            return False
        if now - self._last_odom_at > 0.25:
            return False
        if now - self._last_odom_jump_at < 1.0:
            return False

        pose = self._latest_odom
        if pose is None or self._last_keyframe_pose is None:
            return True
        translation = math.sqrt(
            (pose["x"] - self._last_keyframe_pose["x"]) ** 2
            + (pose["y"] - self._last_keyframe_pose["y"]) ** 2
            + (pose["z"] - self._last_keyframe_pose["z"]) ** 2
        )
        rotation = self._quaternion_distance(pose, self._last_keyframe_pose)
        return (
            translation >= self.keyframe_distance
            or rotation >= self.keyframe_rotation
            or now - self._last_keyframe_at >= self.keyframe_max_interval
        )

    @staticmethod
    def _xyz_intensity(msg):
        offsets = {field.name: field.offset for field in msg.fields}
        if not all(name in offsets for name in ("x", "y", "z")):
            return np.empty((0, 4), dtype=np.float32)

        names = ["x", "y", "z"]
        formats = ["<f4", "<f4", "<f4"]
        field_offsets = [offsets[name] for name in names]
        if "intensity" in offsets:
            names.append("intensity")
            formats.append("<f4")
            field_offsets.append(offsets["intensity"])

        dtype = np.dtype(
            {
                "names": names,
                "formats": formats,
                "offsets": field_offsets,
                "itemsize": msg.point_step,
            }
        )
        count = int(msg.width) * int(msg.height)
        raw = np.frombuffer(msg.data, dtype=dtype, count=count)
        result = np.empty((count, 4), dtype=np.float32)
        result[:, 0] = raw["x"]
        result[:, 1] = raw["y"]
        result[:, 2] = raw["z"]
        result[:, 3] = raw["intensity"] if "intensity" in names else 0.0
        return result

    def _cloud_callback(self, msg):
        now = time.monotonic()
        self._last_cloud_at = now
        self._received_scan_count += 1
        if msg.header.frame_id:
            self._map_frame = msg.header.frame_id
        if not self._accept_keyframe(now):
            self._rejected_scan_count += 1
            return

        points = self._xyz_intensity(msg)
        if points.size == 0:
            return

        finite = np.isfinite(points[:, :3]).all(axis=1)
        if self.max_range > 0:
            if self._latest_odom is not None:
                sensor_position = np.array(
                    [
                        self._latest_odom["x"],
                        self._latest_odom["y"],
                        self._latest_odom["z"],
                    ],
                    dtype=np.float32,
                )
                ranges = np.linalg.norm(points[:, :3] - sensor_position, axis=1)
            else:
                ranges = np.linalg.norm(points[:, :3], axis=1)
            finite &= ranges <= self.max_range
        points = points[finite]
        if points.size == 0:
            return

        voxel_keys = np.floor(points[:, :3] / self.voxel_size).astype(np.int32)
        _, unique_indices = np.unique(voxel_keys, axis=0, return_index=True)
        voxel_keys = voxel_keys[unique_indices]
        points = points[unique_indices]

        with self._lock:
            available = max(0, self.max_points - len(self._voxels))
            for key, point in zip(voxel_keys, points):
                packed_key = (int(key[0]), int(key[1]), int(key[2]))
                previous = self._voxels.get(packed_key)
                if previous is not None:
                    hits = self._voxel_hits.get(packed_key, 1) + 1
                    # Média limitada: reduz ruído sem permitir que deriva tardia
                    # arraste indefinidamente uma superfície já consolidada.
                    weight = 1.0 / min(hits, 8)
                    self._voxels[packed_key] = tuple(
                        float(previous[index] * (1.0 - weight) + point[index] * weight)
                        for index in range(4)
                    )
                    self._voxel_hits[packed_key] = hits
                    self._merged_point_count += 1
                elif available > 0:
                    available -= 1
                    self._voxels[packed_key] = (
                        float(point[0]),
                        float(point[1]),
                        float(point[2]),
                        float(point[3]),
                    )
                    self._voxel_hits[packed_key] = 1
            self._scan_count += 1
            self._received_points += int(points.shape[0])
        if self._latest_odom is not None:
            self._last_keyframe_pose = dict(self._latest_odom)
        self._last_keyframe_at = now

    def _snapshot(self, limit=None):
        with self._lock:
            values = [
                point
                for key, point in self._voxels.items()
                if self._voxel_hits.get(key, 0) >= self.min_voxel_hits
            ]
        if not values:
            return np.empty((0, 4), dtype=np.float32)
        points = np.asarray(values, dtype=np.float32)
        if limit and points.shape[0] > limit:
            indices = np.linspace(0, points.shape[0] - 1, limit, dtype=np.int64)
            points = points[indices]
        return points

    @staticmethod
    def _to_cloud(points, stamp, frame_id):
        msg = PointCloud2()
        msg.header.stamp = stamp
        msg.header.frame_id = frame_id
        msg.height = 1
        msg.width = int(points.shape[0])
        msg.fields = [
            PointField(name="x", offset=0, datatype=PointField.FLOAT32, count=1),
            PointField(name="y", offset=4, datatype=PointField.FLOAT32, count=1),
            PointField(name="z", offset=8, datatype=PointField.FLOAT32, count=1),
            PointField(
                name="intensity", offset=12, datatype=PointField.FLOAT32, count=1
            ),
        ]
        msg.is_bigendian = False
        msg.point_step = 16
        msg.row_step = msg.point_step * msg.width
        msg.is_dense = True
        msg.data = np.ascontiguousarray(points, dtype="<f4").tobytes()
        return msg

    def publish_map(self):
        points = self._snapshot(self.publish_max_points)
        if points.size:
            self.map_pub.publish(
                self._to_cloud(
                    points,
                    self.get_clock().now().to_msg(),
                    self._map_frame,
                )
            )

    def status_dict(self):
        now = time.monotonic()
        cloud_age = max(0.0, now - self._last_cloud_at)
        imu_age = max(0.0, now - self._last_imu_at)
        odom_age = max(0.0, now - self._last_odom_at)
        sport_state_age = max(0.0, now - self._last_sport_state_at)
        lidar_connected = cloud_age < CLOUD_STATUS_TIMEOUT_SECONDS
        imu_connected = imu_age < SENSOR_STATUS_TIMEOUT_SECONDS
        odom_connected = odom_age < ROBOT_STATUS_TIMEOUT_SECONDS
        sport_state_connected = (
            sport_state_age < SPORT_STATE_STATUS_TIMEOUT_SECONDS
        )
        lio_connected = (
            lidar_connected
            and imu_connected
            and odom_connected
            and now - self._last_odom_jump_at >= 1.0
        )
        native_avoidance_ready = self._native_avoidance_ready(now)
        avoidance_state_ready = self._obstacle_avoidance_state_ready(now)
        avoidance_command_ready = (
            self._obstacle_avoidance_command_ready(now)
        )
        remote_source_ready = self._remote_source_ready(now)
        remote_source_operational = self._remote_source_operational()
        safety_ready = avoidance_command_ready and (
            not self._control_armed or remote_source_operational
        )
        with self._lock:
            point_count = sum(
                self._voxel_hits.get(key, 0) >= self.min_voxel_hits
                for key in self._voxels
            )
            scan_count = self._scan_count
        return {
            "mapping": True,
            "lidar_connected": lidar_connected,
            "imu_connected": imu_connected,
            "lio_connected": lio_connected,
            "robot_connected": odom_connected or sport_state_connected,
            "sport_state_connected": sport_state_connected,
            "sensor_age_seconds": {
                "cloud": round(cloud_age, 3),
                "imu": round(imu_age, 3),
                "odometry": round(odom_age, 3),
                "sport_state": round(sport_state_age, 3),
            },
            "control_armed": self._control_armed,
            "moving": self._moving,
            "last_command": self._last_command,
            "last_command_age_seconds": (
                round(max(0.0, now - self._last_command_at), 2)
                if self._last_command_at
                else None
            ),
            "command_count": self._command_count,
            "command_counts": dict(self._command_counts),
            "motion_publish_count": self._motion_publish_count,
            "motion_publish_rate_hz": round(
                1.0 / MOTION_PUBLISH_PERIOD_SECONDS
            ),
            "active_velocity": {
                "x": self._active_velocity[0],
                "y": self._active_velocity[1],
                "yaw": self._active_velocity[2],
            },
            "control_transport": "obstacles_avoid_remote_api",
            "safety_mode": (
                "unitree_native_obstacles_avoid"
                if self._obstacle_avoidance_requested
                else "operator_free_mode"
            ),
            "obstacle_avoidance_enabled": native_avoidance_ready,
            "obstacle_avoidance_requested": (
                self._obstacle_avoidance_requested
            ),
            "obstacle_avoidance_state_confirmed": avoidance_state_ready,
            "obstacle_avoidance_command_ready": avoidance_command_ready,
            "native_avoidance_switch": self._native_avoidance_enabled,
            "native_avoidance_confirmed": native_avoidance_ready,
            "native_avoidance_confirmation_age_seconds": (
                round(max(0.0, now - self._native_avoidance_confirmed_at), 2)
                if self._native_avoidance_confirmed_at
                else None
            ),
            "safety_ready": safety_ready,
            "safety_blocked": self._safety_blocked,
            "safety_block_reason": self._safety_block_reason,
            "safety_block_age_seconds": (
                round(max(0.0, now - self._safety_blocked_at), 2)
                if self._safety_blocked_at
                else None
            ),
            "remote_commands_from_api": self._remote_commands_from_api,
            "remote_source_confirmed": remote_source_ready,
            "remote_source_operational": remote_source_operational,
            "last_avoidance_response": self._last_avoidance_response,
            "last_remote_source_response": self._last_remote_source_response,
            "last_remote_response": self._last_remote_response,
            "last_remote_response_age_seconds": (
                round(max(0.0, now - self._last_remote_response_at), 2)
                if self._last_remote_response_at
                else None
            ),
            "last_sport_response": self._last_sport_response,
            "last_sport_response_age_seconds": (
                round(max(0.0, now - self._last_sport_response_at), 2)
                if self._last_sport_response_at
                else None
            ),
            "point_count": point_count,
            "scan_count": scan_count,
            "received_scan_count": self._received_scan_count,
            "rejected_scan_count": self._rejected_scan_count,
            "merged_point_count": self._merged_point_count,
            "elapsed_seconds": round(now - self._started_at, 1),
            "voxel_size": self.voxel_size,
            "min_voxel_hits": self.min_voxel_hits,
            "speed_limit_percent": self._speed_percent,
            "speed_min_percent": MIN_SPEED_PERCENT,
            "speed_max_percent": MAX_SPEED_PERCENT,
            "speed_step_percent": SPEED_STEP_PERCENT,
            "linear_speed_mps": round(
                MOTION_PROFILES["forward"][0]
                * self._speed_percent
                / MAX_SPEED_PERCENT,
                3,
            ),
            "reverse_speed_mps": round(
                abs(MOTION_PROFILES["backward"][0])
                * self._speed_percent
                / MAX_SPEED_PERCENT,
                3,
            ),
            "yaw_speed_radps": round(
                abs(MOTION_PROFILES["rotate_left"][2])
                * self._speed_percent
                / MAX_SPEED_PERCENT,
                3,
            ),
            "lateral_speed_mps": round(
                MAX_LATERAL_SPEED_MPS
                * self._speed_percent
                / MAX_SPEED_PERCENT,
                3,
            ),
            "speed_profile": "go2_edu_native",
            "frame": self._map_frame,
            "slam_backend": "Go2 native LIO",
            "mapping_quality": "ok" if lio_connected else "degraded",
            "imu": self._latest_imu,
            "origin": self._origin_odom,
            "current_pose": self._latest_odom,
            "current_location": self._current_location(),
            "posture": self._posture_state,
            "sport_state": self._latest_sport_state,
        }

    def publish_status(self):
        msg = String()
        msg.data = json.dumps(self.status_dict(), ensure_ascii=False)
        self.status_pub.publish(msg)
        status = self.status_dict()
        self.get_logger().info(
            "Mapa: %d pontos | %d varreduras | %.1f s"
            % (
                status["point_count"],
                status["scan_count"],
                status["elapsed_seconds"],
            ),
            throttle_duration_sec=5.0,
        )

    def _safe_name(self, requested=None):
        if requested:
            clean = re.sub(r"[^a-zA-Z0-9_-]+", "_", requested).strip("_")
            if clean:
                return clean[:80]
        return "mapa_go2_" + datetime.now().strftime("%Y%m%d_%H%M%S")

    def save_map(self, requested_name=None):
        points = self._snapshot()
        if points.shape[0] < 100:
            raise RuntimeError("nuvem insuficiente para salvar (mínimo: 100 pontos)")

        name = self._safe_name(requested_name)
        pcd_path = self.maps_directory / (name + ".pcd")
        metadata_path = self.maps_directory / (name + ".json")
        temp_pcd = pcd_path.with_suffix(".pcd.tmp")
        temp_metadata = metadata_path.with_suffix(".json.tmp")

        header = (
            "# .PCD v0.7 - mapa 3D Unitree Go2\n"
            "VERSION 0.7\n"
            "FIELDS x y z intensity\n"
            "SIZE 4 4 4 4\n"
            "TYPE F F F F\n"
            "COUNT 1 1 1 1\n"
            "WIDTH %d\n"
            "HEIGHT 1\n"
            "VIEWPOINT 0 0 0 1 0 0 0\n"
            "POINTS %d\n"
            "DATA binary\n" % (points.shape[0], points.shape[0])
        )
        with open(temp_pcd, "wb") as stream:
            stream.write(header.encode("ascii"))
            stream.write(np.ascontiguousarray(points, dtype="<f4").tobytes())

        xyz = points[:, :3]
        metadata = {
            "name": name,
            "created_at": datetime.now().astimezone().isoformat(),
            "pcd_file": pcd_path.name,
            "point_count": int(points.shape[0]),
            "frame": self._map_frame,
            "voxel_size_m": self.voxel_size,
            "bounds_m": {
                "min": xyz.min(axis=0).round(4).tolist(),
                "max": xyz.max(axis=0).round(4).tolist(),
            },
            "mapping_duration_seconds": round(
                time.monotonic() - self._started_at, 2
            ),
            "scan_count": self._scan_count,
            "origin_odom": self._origin_odom,
            "sensor_topics": [
                self.cloud_topic,
                self.odom_topic,
                self.imu_topic,
            ],
            "slam_backend": "Go2 native LIO",
            "raw_sensor_topics": ["/utlidar/cloud", "/utlidar/imu"],
            "deduplication": "one_centroid_per_voxel",
            "min_voxel_hits": self.min_voxel_hits,
            "keyframe_distance_m": self.keyframe_distance,
            "keyframe_rotation_deg": math.degrees(self.keyframe_rotation),
            "speed_limit_percent": self._speed_percent,
        }
        with open(temp_metadata, "w", encoding="utf-8") as stream:
            json.dump(metadata, stream, ensure_ascii=False, indent=2)
            stream.write("\n")

        os.replace(str(temp_pcd), str(pcd_path))
        os.replace(str(temp_metadata), str(metadata_path))
        self._last_saved_count = int(points.shape[0])
        self.get_logger().info("Mapa salvo: %s" % pcd_path)
        return pcd_path, metadata_path, metadata

    def _save_service(self, _request, response):
        try:
            pcd_path, _, metadata = self.save_map()
            response.success = True
            response.message = "%s (%d pontos)" % (
                pcd_path,
                metadata["point_count"],
            )
        except Exception as error:
            response.success = False
            response.message = str(error)
        return response

    def reset_map(self):
        self.stop_motion()
        with self._lock:
            self._voxels.clear()
            self._voxel_hits.clear()
            self._scan_count = 0
            self._received_points = 0
            self._merged_point_count = 0
        self._received_scan_count = 0
        self._rejected_scan_count = 0
        self._last_keyframe_pose = None
        self._last_keyframe_at = 0.0
        self._origin_odom = dict(self._latest_odom) if self._latest_odom else None
        self._started_at = time.monotonic()
        self._last_saved_count = -1
        self.get_logger().warning("Mapa reiniciado pelo operador.")

    def _reset_service(self, _request, response):
        self.reset_map()
        response.success = True
        response.message = "Mapa reiniciado."
        return response

    def arm_control(self, enabled):
        enabled = bool(enabled)
        if enabled:
            self._ensure_native_obstacle_avoidance()
            if not self._obstacle_avoidance_command_ready():
                raise RuntimeError(
                    "controle bloqueado: comando do anticolisão não enviado"
                )
            self._control_armed = True
            self._set_remote_command_source(True)
        else:
            self._control_armed = False
            self.stop_motion(clear_safety_block=True)
            self._set_remote_command_source(False)
        self.get_logger().info(
            "Controle %s." % ("armado" if enabled else "desarmado")
        )

    def set_obstacle_avoidance(self, enabled):
        if not isinstance(enabled, bool):
            raise ValueError("informe true ou false para o anticolisão")
        with self._control_lock:
            self.stop_motion(force=True, clear_safety_block=True)
            self._obstacle_avoidance_requested = enabled
            if self._native_avoidance_enabled is not enabled:
                self._native_avoidance_confirmed_at = 0.0
            self._request_obstacle_avoidance_state(enabled)
        self.get_logger().warning(
            "Anticolisão nativo solicitado: %s."
            % ("HABILITAR" if enabled else "DESABILITAR")
        )
        return enabled

    def _new_sport_request(self, api_id, parameter=None, noreply=False):
        self._request_sequence += 1
        request = Request()
        request.header.identity.id = self._request_sequence
        request.header.identity.api_id = api_id
        request.header.policy.priority = 1
        request.header.policy.noreply = bool(noreply)
        if parameter is not None:
            request.parameter = json.dumps(parameter)
        return request

    def _new_remote_request(self, api_id, parameter, noreply=False):
        request = self._new_sport_request(
            api_id, parameter, noreply=noreply
        )
        return request

    def _request_obstacle_avoidance_state(self, enabled=None):
        is_set_request = enabled is not None
        requested = bool(enabled) if is_set_request else None
        request = self._new_remote_request(
            REMOTE_AVOIDANCE_SWITCH_SET_API_ID
            if is_set_request
            else REMOTE_AVOIDANCE_SWITCH_GET_API_ID,
            {"enable": requested} if is_set_request else None,
        )
        request_id = int(request.header.identity.id)
        self._avoidance_requests[request_id] = requested
        if len(self._avoidance_requests) > 20:
            oldest = next(iter(self._avoidance_requests))
            self._avoidance_requests.pop(oldest, None)
        self.remote_control_pub.publish(request)
        self._last_avoidance_request_at = time.monotonic()

    def _set_remote_command_source(self, enabled):
        request = self._new_remote_request(
            REMOTE_SOURCE_API_ID,
            {"is_remote_commands_from_api": bool(enabled)},
        )
        request_id = int(request.header.identity.id)
        self._remote_source_requests[request_id] = bool(enabled)
        if len(self._remote_source_requests) > 20:
            oldest = next(iter(self._remote_source_requests))
            self._remote_source_requests.pop(oldest, None)
        self.remote_control_pub.publish(request)
        self._last_remote_source_request_at = time.monotonic()
        self._remote_commands_from_api = bool(enabled)
        if not enabled:
            self._remote_source_confirmed_at = 0.0

    def _publish_remote_move(self, vx, vy, vyaw, noreply=False):
        request = self._new_remote_request(
            REMOTE_MOVE_API_ID,
            {
                "x": float(vx),
                "y": float(vy),
                "yaw": float(vyaw),
                "mode": 0,
            },
            noreply=noreply,
        )
        self.remote_control_pub.publish(request)
        self._motion_publish_count += 1

    def move(self, vx=0.0, vy=0.0, vyaw=0.0):
        with self._control_lock:
            if not self._control_armed:
                self.get_logger().warning(
                    "Movimento ignorado: pressione I para armar o controle.",
                    throttle_duration_sec=2.0,
                )
                return
            # Limites técnicos publicados para o comando nativo do Go2 EDU.
            vx = max(
                -MAX_REVERSE_SPEED_MPS,
                min(MAX_FORWARD_SPEED_MPS, float(vx)),
            )
            vy = max(
                -MAX_LATERAL_SPEED_MPS,
                min(MAX_LATERAL_SPEED_MPS, float(vy)),
            )
            vyaw = max(
                -MAX_YAW_SPEED_RADPS,
                min(MAX_YAW_SPEED_RADPS, float(vyaw)),
            )
            safety_reason = self._movement_safety_reason(vx, vy, vyaw)
            if safety_reason:
                raise RuntimeError(
                    "movimento bloqueado: %s"
                    % SAFETY_REASON_MESSAGES.get(
                        safety_reason, safety_reason
                    )
                )
            self._active_velocity = (vx, vy, vyaw)
            now = time.monotonic()
            if not self._moving:
                self._motion_started_at = now
            self._last_motion_at = now
            self._moving = any(
                abs(value) > 1e-4 for value in self._active_velocity
            )
            self._publish_remote_move(*self._active_velocity)

    def move_command(self, command):
        profile = MOTION_PROFILES.get(command)
        if profile is None:
            raise ValueError("comando de movimento inválido")
        if self._safety_blocked:
            raise RuntimeError(
                "movimento bloqueado: %s; solte o controle antes de tentar novamente"
                % SAFETY_REASON_MESSAGES.get(
                    self._safety_block_reason, self._safety_block_reason
                )
            )
        if self._posture_state != "standing":
            raise RuntimeError(
                "robô está deitado ou mudando de postura; use o botão LEVANTAR"
            )
        scale = self._speed_percent / MAX_SPEED_PERCENT
        velocity = tuple(value * scale for value in profile)
        safety_reason = self._movement_safety_reason(*velocity)
        if safety_reason:
            raise RuntimeError(
                "movimento bloqueado: %s"
                % SAFETY_REASON_MESSAGES.get(safety_reason, safety_reason)
            )
        self._last_command = command
        self._last_command_at = time.monotonic()
        self._obstacle_stall_started_at = 0.0
        self._command_count += 1
        self._command_counts[command] += 1
        self.move(
            vx=velocity[0],
            vy=velocity[1],
            vyaw=velocity[2],
        )

    def move_analog(self, forward, lateral, yaw):
        if self._safety_blocked:
            raise RuntimeError(
                "movimento bloqueado: %s; solte o controle antes de tentar novamente"
                % SAFETY_REASON_MESSAGES.get(
                    self._safety_block_reason, self._safety_block_reason
                )
            )
        if self._posture_state != "standing":
            raise RuntimeError(
                "robô está deitado ou mudando de postura; use o botão LEVANTAR"
            )
        velocity = analog_velocity(
            forward,
            lateral,
            yaw,
            self._speed_percent,
        )
        self._last_command = "move_analog"
        self._last_command_at = time.monotonic()
        self._obstacle_stall_started_at = 0.0
        self._command_count += 1
        self._command_counts["move_analog"] += 1
        self.move(vx=velocity[0], vy=velocity[1], vyaw=velocity[2])
        return velocity

    def set_speed_percent(self, percent):
        try:
            requested = float(percent)
        except (TypeError, ValueError):
            raise ValueError("informe uma velocidade entre 10% e 100%")
        if not math.isfinite(requested):
            raise ValueError("velocidade inválida")
        if requested < MIN_SPEED_PERCENT or requested > MAX_SPEED_PERCENT:
            raise ValueError("a velocidade deve ficar entre 10% e 100%")

        selected = int(
            round(requested / SPEED_STEP_PERCENT) * SPEED_STEP_PERCENT
        )
        # Sempre interrompe o movimento antes de trocar o ganho do comando.
        self.stop_motion()
        with self._control_lock:
            self._speed_percent = selected
        self.get_logger().warning(
            "Limite de velocidade alterado para %d%%." % selected
        )
        return selected

    def stop_motion(self, force=False, clear_safety_block=False):
        with self._control_lock:
            now = time.monotonic()
            if clear_safety_block:
                self._safety_blocked = False
                self._safety_block_reason = None
                self._safety_blocked_at = 0.0
            if (
                not force
                and not self._moving
                and now - self._last_stop_sent_at < 0.1
            ):
                return
            self._moving = False
            self._active_velocity = (0.0, 0.0, 0.0)
            self._last_motion_at = 0.0
            self._motion_started_at = 0.0
            self._obstacle_stall_started_at = 0.0
            self._publish_remote_move(0.0, 0.0, 0.0)
            request = self._new_sport_request(STOP_API_ID)
            self.sport_pub.publish(request)
            self._last_stop_sent_at = now
            self._last_command = "stop"
            self._last_command_at = now

    def set_posture(self, posture):
        if not self._control_armed:
            raise PermissionError(
                "controle bloqueado; habilite-o antes de mudar a postura"
            )
        if (
            self._posture_target
            and time.monotonic() - self._posture_command_at
            < POSTURE_TRANSITION_SECONDS
        ):
            raise RuntimeError("aguarde a mudança de postura terminar")
        api_ids = {
            "stand_up": STAND_UP_API_ID,
            "stand_down": STAND_DOWN_API_ID,
        }
        if posture not in api_ids:
            raise ValueError("comando de postura inválido")
        target_state = "standing" if posture == "stand_up" else "lying"
        if self._posture_state == target_state:
            return

        self.stop_motion(clear_safety_block=True)
        request = self._new_sport_request(api_ids[posture])
        self.sport_pub.publish(request)
        self._posture_target = "up" if posture == "stand_up" else "down"
        self._posture_command_at = time.monotonic()
        self._posture_state = "transitioning_" + self._posture_target
        self._posture_candidate = None
        self._posture_candidate_since = 0.0
        self.get_logger().warning(
            "Comando de postura enviado: %s."
            % ("LEVANTAR" if posture == "stand_up" else "DEITAR")
        )

    def damping(self):
        with self._control_lock:
            self.stop_motion(force=True, clear_safety_block=True)
            request = self._new_sport_request(DAMP_API_ID)
            self.sport_pub.publish(request)
            self._posture_target = None
            self._posture_command_at = time.monotonic()
            self._posture_state = "damping"
            self._posture_candidate = None
            self._posture_candidate_since = 0.0
            self._last_command = "damping"
            self._last_command_at = time.monotonic()
        self.get_logger().warning(
            "DAMPING: modo de amortecimento oficial da Unitree enviado; "
            "canal de controle preservado."
        )
        return self._control_armed

    def toggle_posture(self):
        if self._posture_state.startswith("transitioning_"):
            raise RuntimeError("aguarde a mudança de postura terminar")
        if self._posture_state in ("standing", "transitioning_up"):
            self.set_posture("stand_down")
            return "stand_down"
        self.set_posture("stand_up")
        return "stand_up"

    def _motion_watchdog(self):
        with self._control_lock:
            if not self._moving:
                return
            now = time.monotonic()
            safety_reason = self._movement_safety_reason(
                *self._active_velocity
            )
            if safety_reason:
                self.stop_motion(force=True)
                self._safety_blocked = True
                self._safety_block_reason = safety_reason
                self._safety_blocked_at = now
                self.get_logger().error(
                    "Movimento interrompido: %s."
                    % SAFETY_REASON_MESSAGES.get(safety_reason, safety_reason)
                )
                return
            if (
                self._obstacle_avoidance_requested
                and self._native_motion_stalled(now)
            ):
                self.stop_motion(force=True)
                self._safety_blocked = True
                self._safety_block_reason = "native_obstacle_limit"
                self._safety_blocked_at = now
                self.get_logger().warning(
                    "Movimento interrompido no limite do anticolisão nativo."
                )
                return
            if (
                not self._control_armed
                or now - self._last_motion_at
                > MOTION_WATCHDOG_SECONDS
            ):
                self._moving = False
                self._active_velocity = (0.0, 0.0, 0.0)
                self._last_motion_at = 0.0
                self._motion_started_at = 0.0
                self._obstacle_stall_started_at = 0.0
                self._publish_remote_move(0.0, 0.0, 0.0)
                request = self._new_sport_request(STOP_API_ID)
                self.sport_pub.publish(request)
                self._last_stop_sent_at = time.monotonic()
                self._last_command = "stop"
                self._last_command_at = self._last_stop_sent_at
                return
            self._publish_remote_move(
                *self._active_velocity, noreply=True
            )

    def shutdown_safely(self):
        if self._shutdown_started:
            return
        self._shutdown_started = True
        self.arm_control(False)
        for _ in range(3):
            self.stop_motion(force=True)
            time.sleep(0.03)
        with self._lock:
            current_count = len(self._voxels)
        if current_count >= 100 and current_count != self._last_saved_count:
            try:
                self.save_map("autosave_" + datetime.now().strftime("%Y%m%d_%H%M%S"))
            except Exception as error:
                self.get_logger().error("Falha no autosave: %s" % error)


class KeyboardController:
    HELP = """
Controles de mapeamento (velocidade ajustável: 10% a 100%)
  I             armar movimento
  O             desarmar movimento
  W/S ou ↑/↓    avançar / recuar
  A/D ou ←/→    girar para esquerda / direita
  Espaço        parada imediata
  P             salvar mapa agora
  C             limpar e reiniciar o mapa
  H             mostrar esta ajuda
  Esc           salvar e sair

Segure a tecla de movimento. O watchdog para o robô em 0,25 s se os comandos
deixarem de chegar. A locomoção usa o anticolisão nativo do Go2. Mantenha
supervisão presencial e caminho livre.
"""

    def __init__(self, node):
        self.node = node
        self._thread = None
        self._stop = threading.Event()
        self._old_term = None
        self._old_flags = None

    def start(self):
        if not sys.stdin.isatty():
            self.node.get_logger().warning(
                "Terminal não interativo: teleop por teclado desativado."
            )
            return
        print(self.HELP, flush=True)
        fd = sys.stdin.fileno()
        self._old_term = termios.tcgetattr(fd)
        self._old_flags = fcntl.fcntl(fd, fcntl.F_GETFL)
        tty.setcbreak(fd)
        fcntl.fcntl(fd, fcntl.F_SETFL, self._old_flags | os.O_NONBLOCK)
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _run(self):
        fd = sys.stdin.fileno()
        while not self._stop.is_set() and rclpy.ok():
            readable, _, _ = select.select([sys.stdin], [], [], 0.1)
            if not readable:
                continue
            try:
                token = os.read(fd, 8).decode("utf-8", errors="ignore")
            except BlockingIOError:
                continue
            if not token:
                continue
            self._handle(token)

    def _handle(self, token):
        lower = token.lower()
        if token.startswith("\x1b["):
            if "A" in token:
                self.node.move_command("forward")
            elif "B" in token:
                self.node.move_command("backward")
            elif "D" in token:
                self.node.move_command("rotate_left")
            elif "C" in token:
                self.node.move_command("rotate_right")
            return
        if token == "\x1b":
            self.node.shutdown_safely()
            rclpy.shutdown()
        elif lower == "i":
            self.node.arm_control(True)
        elif lower == "o":
            self.node.arm_control(False)
        elif lower == "w":
            self.node.move_command("forward")
        elif lower == "s":
            self.node.move_command("backward")
        elif lower == "a":
            self.node.move_command("rotate_left")
        elif lower == "d":
            self.node.move_command("rotate_right")
        elif token == " ":
            self.node.stop_motion()
        elif lower == "p":
            try:
                self.node.save_map()
            except Exception as error:
                self.node.get_logger().error(str(error))
        elif lower == "c":
            self.node.reset_map()
        elif lower == "h":
            print(self.HELP, flush=True)

    def close(self):
        self._stop.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=0.3)
        if self._old_term is not None:
            termios.tcsetattr(sys.stdin.fileno(), termios.TCSADRAIN, self._old_term)
        if self._old_flags is not None:
            fcntl.fcntl(sys.stdin.fileno(), fcntl.F_SETFL, self._old_flags)


def main(args=None):
    rclpy.init(args=args)
    node = Go2MappingNode()
    keyboard = KeyboardController(node)
    if bool(node.get_parameter("interactive").value):
        keyboard.start()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        keyboard.close()
        node.shutdown_safely()
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == "__main__":
    main()
