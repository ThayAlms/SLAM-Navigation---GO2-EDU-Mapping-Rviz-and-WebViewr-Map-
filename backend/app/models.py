from enum import Enum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class RobotCommandName(str, Enum):
    MOVE_ANALOG = "move_analog"
    FORWARD = "forward"
    BACKWARD = "backward"
    ROTATE_LEFT = "rotate_left"
    ROTATE_RIGHT = "rotate_right"
    STAND_UP = "stand_up"
    STAND_DOWN = "stand_down"
    ARM = "arm"
    DISARM = "disarm"
    SET_SPEED = "set_speed"
    SET_OBSTACLE_AVOIDANCE = "set_obstacle_avoidance"
    DAMPING = "damping"
    RESET_MAP = "reset_map"
    SAVE_MAP = "save_map"
    STOP = "stop"
    EMERGENCY_STOP = "emergency_stop"


class UserRole(str, Enum):
    OPERATOR = "operator"
    ADMIN = "admin"


class CurrentUser(BaseModel):
    id: UUID
    email: str | None = None
    display_name: str | None = None
    role: UserRole = UserRole.OPERATOR


class AuthContext(BaseModel):
    user: CurrentUser
    access_token: str = Field(exclude=True)


class LoginEventIn(BaseModel):
    source: str = Field(default="web", max_length=30)


class AdminUserCreateIn(BaseModel):
    email: str = Field(
        min_length=3,
        max_length=320,
        pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$",
    )
    password: str = Field(min_length=8, max_length=128)
    display_name: str | None = Field(default=None, max_length=120)
    role: UserRole = UserRole.OPERATOR


class AdminUserCreated(BaseModel):
    id: UUID
    email: str
    display_name: str | None = None
    role: UserRole


class RobotCommandIn(BaseModel):
    command: RobotCommandName
    robot_id: str = Field(default="primary", min_length=1, max_length=80)
    payload: dict[str, Any] = Field(default_factory=dict)


class OracleAnalysisIn(BaseModel):
    robot_id: str = Field(default="primary", min_length=1, max_length=80)
    image_url: str | None = Field(default=None, max_length=2048)
    metadata: dict[str, Any] = Field(default_factory=dict)


class RobotTelemetryIn(BaseModel):
    robot_id: str = Field(default="primary", min_length=1, max_length=80)
    robot_online: bool = False
    network_online: bool = False
    sdk_connected: bool = False
    battery_percent: int | None = Field(default=None, ge=0, le=100)
    video_stream_url: str | None = Field(default=None, max_length=2048)
    map_data_url: str | None = Field(default=None, max_length=2048)
    telemetry: dict[str, Any] = Field(default_factory=dict)


class CommandResultIn(BaseModel):
    status: str = Field(pattern="^(processing|completed|failed)$")
    error_message: str | None = Field(default=None, max_length=2000)
    result: dict[str, Any] = Field(default_factory=dict)
