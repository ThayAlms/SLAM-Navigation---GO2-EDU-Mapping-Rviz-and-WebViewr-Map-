#!/usr/bin/env python3
"""Recebe comandos do painel pela sala LiveKit e os executa no gateway local."""

import argparse
import base64
import json
import math
import os
import re
import signal
import subprocess
import time
from collections import deque
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import UUID


COMMAND_TOPIC = "go2.command"
ALLOWED_COMMANDS = {
    "move_analog",
    "forward",
    "backward",
    "rotate_left",
    "rotate_right",
    "stand_up",
    "stand_down",
    "recovery_stand",
    "arm",
    "disarm",
    "set_speed",
    "set_obstacle_avoidance",
    "damping",
    "reset_map",
    "save_map",
    "calibrate_docking_station",
    "start_docking",
    "cancel_docking",
    "stop",
    "emergency_stop",
}
DATA_PATTERN = re.compile(r'"data"\s*:\s*"([A-Za-z0-9+/=]+)"')
PARTICIPANT_PATTERN = re.compile(r'"participant"\s*:\s*"([^"]*)"')


def decode_received_line(line):
    if "received data" not in line:
        return None, ""
    data_match = DATA_PATTERN.search(line)
    if not data_match:
        return None, ""
    participant_match = PARTICIPANT_PATTERN.search(line)
    participant = participant_match.group(1) if participant_match else ""
    try:
        payload = base64.b64decode(data_match.group(1), validate=True)
        return json.loads(payload.decode("utf-8")), participant
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
        return None, participant


def validate_command(message, participant, now_ms=None):
    if not isinstance(message, dict) or message.get("type") != "go2.command":
        raise ValueError("pacote não é um comando do Go2")
    if message.get("version") != 1 or message.get("robot_id") != "primary":
        raise ValueError("versão ou robô inválido")

    request_id = str(message.get("request_id", ""))
    UUID(request_id)
    user_id = str(message.get("user_id", ""))
    UUID(user_id)
    if not participant.startswith(user_id + "-"):
        raise ValueError("identidade do operador não confere")

    command = str(message.get("command", ""))
    if command not in ALLOWED_COMMANDS:
        raise ValueError("comando não permitido")
    if not isinstance(message.get("payload", {}), dict):
        raise ValueError("payload inválido")

    current_ms = int(time.time() * 1000) if now_ms is None else now_ms
    issued_at = int(message.get("issued_at", 0))
    expires_at = int(message.get("expires_at", 0))
    if issued_at > current_ms + 5_000 or current_ms > expires_at:
        raise ValueError("comando expirado")
    if expires_at - issued_at > 10_000:
        raise ValueError("validade do comando excedida")
    return request_id, command, message.get("payload", {})


def gateway_action(command, payload):
    if command == "move_analog":
        axes = {}
        for name in ("forward", "lateral", "yaw"):
            value = payload.get(name)
            if isinstance(value, bool):
                raise ValueError("eixos do controle devem ficar entre -1 e 1")
            try:
                value = float(value)
            except (TypeError, ValueError) as error:
                raise ValueError(
                    "eixos do controle devem ficar entre -1 e 1"
                ) from error
            if not math.isfinite(value) or not -1.0 <= value <= 1.0:
                raise ValueError("eixos do controle devem ficar entre -1 e 1")
            axes[name] = value
        return "/api/control/joystick", axes
    if command in {"forward", "backward", "rotate_left", "rotate_right", "stop"}:
        return "/api/control/move", {"command": command}
    if command in {"stand_up", "stand_down", "recovery_stand"}:
        return "/api/control/posture", {"command": command}
    if command in {"arm", "disarm"}:
        return "/api/control/arm", {"armed": command == "arm"}
    if command == "set_speed":
        percent = int(payload.get("percent", 0))
        if not 10 <= percent <= 100:
            raise ValueError("velocidade fora da faixa de 10% a 100%")
        return "/api/control/speed", {"percent": percent}
    if command == "set_obstacle_avoidance":
        enabled = payload.get("enabled")
        if not isinstance(enabled, bool):
            raise ValueError("estado do anticolisão deve ser booleano")
        return "/api/control/obstacle-avoidance", {"enabled": enabled}
    if command == "damping":
        return "/api/control/damping", {}
    if command == "reset_map":
        return "/api/map/reset", {}
    if command == "save_map":
        return "/api/map/save", {}
    if command == "calibrate_docking_station":
        return "/api/docking/calibrate", {}
    if command == "start_docking":
        return "/api/docking/start", {}
    if command == "cancel_docking":
        return "/api/docking/cancel", {}
    if command == "emergency_stop":
        return "/api/control/stop", {}
    raise ValueError("comando não reconhecido")


def execute_gateway(base_url, gateway_key, command, payload, timeout):
    path, body = gateway_action(command, payload)
    headers = {"Content-Type": "application/json"}
    if gateway_key:
        headers["X-Gateway-Key"] = gateway_key
    request = Request(
        base_url.rstrip("/") + path,
        data=json.dumps(body, separators=(",", ":")).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def join_command():
    return [
        "lk",
        "room",
        "join",
        "--identity",
        "go2-command-gateway",
        os.environ.get("LIVEKIT_ROOM_NAME", "go2-primary"),
    ]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--gateway-url",
        default=os.environ.get("ROBOT_GATEWAY_URL", "http://127.0.0.1:8081"),
    )
    parser.add_argument(
        "--gateway-key",
        default=os.environ.get("ROBOT_GATEWAY_API_KEY", ""),
    )
    parser.add_argument("--timeout", type=float, default=3.0)
    args = parser.parse_args()

    stopping = False
    process = None
    seen_order = deque(maxlen=1_000)
    seen = set()

    def stop(_signum=None, _frame=None):
        nonlocal stopping
        stopping = True
        if process and process.poll() is None:
            process.terminate()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    print("Controle remoto: LiveKit → gateway local do Go2", flush=True)

    while not stopping:
        try:
            process = subprocess.Popen(
                join_command(),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            for line in process.stdout:
                if stopping:
                    break
                message, participant = decode_received_line(line)
                if not isinstance(message, dict) or message.get("type") != "go2.command":
                    continue
                try:
                    request_id, command, payload = validate_command(message, participant)
                    if request_id in seen:
                        continue
                    if len(seen_order) == seen_order.maxlen:
                        seen.discard(seen_order[0])
                    seen_order.append(request_id)
                    seen.add(request_id)
                    execute_gateway(
                        args.gateway_url,
                        args.gateway_key,
                        command,
                        payload,
                        args.timeout,
                    )
                    if command not in {
                        "move_analog",
                        "forward",
                        "backward",
                        "rotate_left",
                        "rotate_right",
                    }:
                        print("Comando executado: %s" % command, flush=True)
                except (ValueError, HTTPError, URLError, TimeoutError, OSError) as error:
                    print("Comando recusado: %s" % error, flush=True)
            if process.poll() not in (0, -signal.SIGTERM) and not stopping:
                print("LiveKit desconectou; reconectando...", flush=True)
        except (OSError, subprocess.SubprocessError) as error:
            print("LiveKit indisponível: %s" % error, flush=True)
        if not stopping:
            time.sleep(2)


if __name__ == "__main__":
    main()
