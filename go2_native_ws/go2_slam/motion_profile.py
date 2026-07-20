"""Escala de movimento equivalente ao comando nativo do Go2 EDU."""

import math


DEFAULT_SPEED_PERCENT = 100
MIN_SPEED_PERCENT = 10
MAX_SPEED_PERCENT = 100
SPEED_STEP_PERCENT = 10

# O Go2 EDU é especificado em 0–3,7 m/s, com máximo aproximado de 5 m/s
# medido em laboratório. O perfil de 100% representa esse máximo publicado;
# o firmware ainda pode limitar a velocidade conforme o modo e o ambiente.
MAX_FORWARD_SPEED_MPS = 5.0
MAX_REVERSE_SPEED_MPS = 2.5
MAX_LATERAL_SPEED_MPS = 1.0
MAX_YAW_SPEED_RADPS = 4.0

MOTION_PROFILES = {
    "forward": (MAX_FORWARD_SPEED_MPS, 0.0, 0.0),
    "backward": (-MAX_REVERSE_SPEED_MPS, 0.0, 0.0),
    "rotate_left": (0.0, 0.0, MAX_YAW_SPEED_RADPS),
    "rotate_right": (0.0, 0.0, -MAX_YAW_SPEED_RADPS),
}


def normalized_axis(value, name):
    if isinstance(value, bool):
        raise ValueError("eixo %s deve ficar entre -1 e 1" % name)
    try:
        selected = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError("eixo %s deve ficar entre -1 e 1" % name) from error
    if not math.isfinite(selected) or not -1.0 <= selected <= 1.0:
        raise ValueError("eixo %s deve ficar entre -1 e 1" % name)
    return selected


def analog_velocity(forward, lateral, yaw, speed_percent):
    """Converte os três eixos normalizados para unidades nativas do SDK."""
    forward = normalized_axis(forward, "forward")
    lateral = normalized_axis(lateral, "lateral")
    yaw = normalized_axis(yaw, "yaw")
    speed_percent = float(speed_percent)
    if not math.isfinite(speed_percent) or not 0 <= speed_percent <= 100:
        raise ValueError("percentual de velocidade inválido")

    scale = speed_percent / MAX_SPEED_PERCENT
    forward_limit = (
        MAX_FORWARD_SPEED_MPS
        if forward >= 0
        else MAX_REVERSE_SPEED_MPS
    )
    return (
        forward * forward_limit * scale,
        lateral * MAX_LATERAL_SPEED_MPS * scale,
        yaw * MAX_YAW_SPEED_RADPS * scale,
    )
