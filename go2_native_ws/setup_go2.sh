#!/usr/bin/env bash

GO2_WS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

GO2_SETUP_RESTORE_NOUNSET=false
if [[ "$-" == *u* ]]; then
  GO2_SETUP_RESTORE_NOUNSET=true
  set +u
fi

source /opt/ros/foxy/setup.bash
source "$GO2_WS_ROOT/unitree_ros2/cyclonedds_ws/install/setup.bash"

if [[ "$GO2_SETUP_RESTORE_NOUNSET" == true ]]; then
  set -u
fi
unset GO2_SETUP_RESTORE_NOUNSET

export RMW_IMPLEMENTATION=rmw_cyclonedds_cpp
export ROS_DOMAIN_ID=0
export CYCLONEDDS_URI='<CycloneDDS><Domain><General><Interfaces><NetworkInterface name="eth0" priority="default" multicast="default" /></Interfaces></General></Domain></CycloneDDS>'

echo "Ambiente Go2 ativo em eth0 (192.168.123.18), CycloneDDS 0.10, domínio DDS 0."
