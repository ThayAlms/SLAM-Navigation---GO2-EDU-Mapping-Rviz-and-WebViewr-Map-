#!/usr/bin/env python3
"""Publica mapa e telemetria do gateway local na ponte LiveKit da Vercel."""

import argparse
import json
import os
import signal
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def get_json(url, gateway_key, timeout):
    headers = {"Accept": "application/json"}
    if gateway_key:
        headers["X-Gateway-Key"] = gateway_key
    with urlopen(Request(url, headers=headers), timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def sample_points(points, maximum):
    point_count = len(points) // 3
    if point_count <= maximum:
        return points[: point_count * 3]
    sampled = []
    step = point_count / maximum
    for output_index in range(maximum):
        source_index = int(output_index * step) * 3
        sampled.extend(points[source_index : source_index + 3])
    return sampled


def normalized_status(status):
    robot_connected = bool(status.get("robot_connected"))
    fields = (
        "camera_connected",
        "lio_connected",
        "control_armed",
        "posture",
        "point_count",
        "current_location",
        "current_pose",
        "speed_limit_percent",
        "speed_min_percent",
        "speed_max_percent",
        "speed_step_percent",
        "obstacle_avoidance_enabled",
        "safety_mode",
        "safety_ready",
        "safety_blocked",
    )
    telemetry = {field: status.get(field) for field in fields}
    return {
        **telemetry,
        "robot_id": "primary",
        "robot_online": robot_connected,
        "network_online": True,
        "sdk_connected": robot_connected,
        "gateway_connected": True,
    }


def post_snapshot(url, publisher_key, payload, timeout):
    request = Request(
        url,
        data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-Robot-Key": publisher_key,
        },
        method="POST",
    )
    with urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--vercel-url",
        default=os.environ.get("VERCEL_APP_URL", ""),
        help="URL pública do frontend na Vercel",
    )
    parser.add_argument(
        "--publisher-key",
        default=os.environ.get("ROBOT_PUBLISHER_KEY", ""),
    )
    parser.add_argument(
        "--gateway-url",
        default=os.environ.get("ROBOT_GATEWAY_URL", "http://127.0.0.1:8081"),
    )
    parser.add_argument(
        "--gateway-key",
        default=os.environ.get("ROBOT_GATEWAY_API_KEY", ""),
    )
    parser.add_argument("--interval", type=float, default=1.0)
    parser.add_argument("--max-points", type=int, default=1500)
    parser.add_argument("--timeout", type=float, default=10.0)
    args = parser.parse_args()

    if not args.vercel_url:
        parser.error("informe VERCEL_APP_URL ou --vercel-url")
    if not args.publisher_key:
        parser.error("informe ROBOT_PUBLISHER_KEY ou --publisher-key")
    if not 1 <= args.max_points <= 1500:
        parser.error("--max-points deve estar entre 1 e 1500")

    gateway_url = args.gateway_url.rstrip("/")
    publish_url = args.vercel_url.rstrip("/") + "/api/livekit-robot-data"
    stopping = False

    def stop(_signum=None, _frame=None):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    print("Ponte da nuvem de pontos ativa para %s" % publish_url, flush=True)

    sequence = 0
    while not stopping:
        started_at = time.monotonic()
        try:
            status = get_json(
                gateway_url + "/api/status", args.gateway_key, args.timeout
            )
            point_payload = get_json(
                gateway_url + "/api/map/points", args.gateway_key, args.timeout
            )
            points = sample_points(point_payload.get("points", []), args.max_points)
            if not points:
                raise RuntimeError("gateway ainda não possui pontos do LiDAR")
            result = post_snapshot(
                publish_url,
                args.publisher_key,
                {"points": points, "status": normalized_status(status)},
                args.timeout,
            )
            sequence += 1
            if sequence == 1 or sequence % 10 == 0:
                print(
                    "LiveKit: %d pontos publicados na sala %s"
                    % (result.get("point_count", 0), result.get("room_name", "")),
                    flush=True,
                )
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            print("Vercel respondeu HTTP %d: %s" % (error.code, detail), flush=True)
        except (URLError, TimeoutError, RuntimeError, ValueError) as error:
            print("Aguardando dados/publicação: %s" % error, flush=True)

        remaining = args.interval - (time.monotonic() - started_at)
        if remaining > 0 and not stopping:
            time.sleep(remaining)


if __name__ == "__main__":
    main()
