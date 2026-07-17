#!/usr/bin/env bash
set -Eeuo pipefail

UPLINK_CONNECTION="${GO2_UPLINK_CONNECTION:-XD4 Local}"
UPLINK_INTERFACE="${GO2_UPLINK_INTERFACE:-wlan0}"
ROBOT_INTERFACE="${GO2_ROBOT_INTERFACE:-eth0}"

nmcli radio wifi on

# O Wi-Fi XD4 e a unica rota de internet. A Ethernet continua dedicada a
# rede local 192.168.123.0/24 do Go2, sem instalar rota default.
nmcli connection modify "$UPLINK_CONNECTION" \
  connection.autoconnect yes \
  connection.autoconnect-priority 100 \
  connection.interface-name "$UPLINK_INTERFACE" \
  ipv4.never-default no \
  ipv4.route-metric 20 \
  ipv6.never-default no \
  ipv6.route-metric 20

# Perfis antigos da rede Thaina nao devem disputar o autoconnect no boot.
while IFS= read -r connection_uuid; do
  connection_name="$(
    nmcli -g connection.id connection show "$connection_uuid" 2>/dev/null \
      || true
  )"
  if [[ "${connection_name,,}" == *thaina* ]]; then
    nmcli connection modify "$connection_uuid" \
      connection.autoconnect no \
      connection.autoconnect-priority -100
  fi
done < <(
  nmcli -t -f UUID,TYPE connection show \
    | awk -F: '$2 == "802-11-wireless" {print $1}'
)

robot_connection="$(
  nmcli -g GENERAL.CONNECTION device show "$ROBOT_INTERFACE" 2>/dev/null \
    || true
)"
if [[ -n "$robot_connection" && "$robot_connection" != "--" ]]; then
  nmcli connection modify "$robot_connection" \
    ipv4.never-default yes \
    ipv4.route-metric 600 \
    ipv6.never-default yes \
    ipv6.route-metric 600
fi

active_connection="$(nmcli -g GENERAL.CONNECTION device show "$UPLINK_INTERFACE" 2>/dev/null || true)"
if [[ "$active_connection" != "$UPLINK_CONNECTION" ]]; then
  nmcli --wait 30 connection up "$UPLINK_CONNECTION" ifname "$UPLINK_INTERFACE"
fi

uplink_gateway=""
for _ in {1..30}; do
  uplink_gateway="$(
    nmcli -g IP4.GATEWAY device show "$UPLINK_INTERFACE" | head -n 1
  )"
  [[ -n "$uplink_gateway" ]] && break
  sleep 1
done
[[ -n "$uplink_gateway" ]] || {
  echo "[ERRO] A conexao '$UPLINK_CONNECTION' nao recebeu gateway IPv4." >&2
  exit 1
}

while ip -4 route show default dev "$ROBOT_INTERFACE" \
  | grep -q '^default'; do
  ip -4 route del default dev "$ROBOT_INTERFACE"
done

ip -4 route replace default via "$uplink_gateway" \
  dev "$UPLINK_INTERFACE" metric 20

selected_route="$(ip -4 route get 8.8.8.8)"
[[ "$selected_route" == *"dev $UPLINK_INTERFACE"* ]] || {
  echo "[ERRO] A rota default nao selecionou $UPLINK_INTERFACE." >&2
  exit 1
}

echo "Internet: '$UPLINK_CONNECTION' em $UPLINK_INTERFACE; Go2 local em $ROBOT_INTERFACE sem rota default."
