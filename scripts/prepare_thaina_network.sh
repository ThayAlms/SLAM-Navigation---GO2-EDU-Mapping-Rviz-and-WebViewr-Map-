#!/usr/bin/env bash
set -Eeuo pipefail

UPLINK_CONNECTION="${GO2_UPLINK_CONNECTION:-XD4 Local}"
UPLINK_INTERFACE="${GO2_UPLINK_INTERFACE:-wlan0}"
ROBOT_INTERFACE="${GO2_ROBOT_INTERFACE:-eth0}"
PRIMARY_SSID="${GO2_UPLINK_SSID:-XD4}"
FALLBACK_CONNECTION="${GO2_FALLBACK_CONNECTION:-Thaina}"
FALLBACK_SSID="${GO2_FALLBACK_SSID:-Thaina}"
FALLBACK_PASSWORD="${GO2_FALLBACK_PASSWORD:-}"

nmcli radio wifi on

# XD4 continua sendo a rede preferencial. O perfil Thaina fica habilitado com
# prioridade menor para assumir a wlan0 quando XD4 nao estiver disponivel.
nmcli connection modify "$UPLINK_CONNECTION" \
  connection.autoconnect yes \
  connection.autoconnect-priority 100 \
  connection.interface-name "$UPLINK_INTERFACE" \
  ipv4.never-default no \
  ipv4.route-metric 20 \
  ipv6.never-default no \
  ipv6.route-metric 20

fallback_profile_exists=true
if ! nmcli connection show "$FALLBACK_CONNECTION" >/dev/null 2>&1; then
  fallback_profile_exists=false
  if [[ -n "$FALLBACK_PASSWORD" ]]; then
    nmcli connection add \
      type wifi \
      ifname "$UPLINK_INTERFACE" \
      con-name "$FALLBACK_CONNECTION" \
      ssid "$FALLBACK_SSID"
    fallback_profile_exists=true
  fi
fi

if [[ "$fallback_profile_exists" == true ]]; then
  nmcli connection modify "$FALLBACK_CONNECTION" \
    connection.autoconnect yes \
    connection.autoconnect-priority 50 \
    connection.interface-name "$UPLINK_INTERFACE" \
    802-11-wireless.ssid "$FALLBACK_SSID" \
    ipv4.method auto \
    ipv4.never-default no \
    ipv4.route-metric 30 \
    ipv6.never-default no \
    ipv6.route-metric 30

  if [[ -n "$FALLBACK_PASSWORD" ]]; then
    nmcli connection modify "$FALLBACK_CONNECTION" \
      802-11-wireless-security.key-mgmt wpa-psk \
      802-11-wireless-security.psk "$FALLBACK_PASSWORD"
  fi
fi

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

ssid_is_visible() {
  local wanted_ssid="$1"
  local visible_ssid

  while IFS= read -r visible_ssid; do
    [[ "$visible_ssid" == "$wanted_ssid" ]] && return 0
  done < <(nmcli -g SSID device wifi list ifname "$UPLINK_INTERFACE" 2>/dev/null || true)

  return 1
}

# Atualiza a lista antes da escolha. Se o scan falhar, a ausencia de XD4 ainda
# leva ao fallback; o restart do servico tentara novamente caso nenhuma rede
# esteja acessivel naquele instante.
nmcli --wait 15 device wifi rescan ifname "$UPLINK_INTERFACE" 2>/dev/null || true
if ssid_is_visible "$PRIMARY_SSID"; then
  selected_connection="$UPLINK_CONNECTION"
elif [[ "$fallback_profile_exists" == true ]]; then
  selected_connection="$FALLBACK_CONNECTION"
else
  echo "[ERRO] XD4 indisponivel e o perfil de fallback nao esta configurado." >&2
  echo "Defina GO2_FALLBACK_PASSWORD no arquivo de ambiente do servico." >&2
  exit 1
fi

active_connection="$(nmcli -g GENERAL.CONNECTION device show "$UPLINK_INTERFACE" 2>/dev/null || true)"
if [[ "$active_connection" != "$selected_connection" ]]; then
  nmcli --wait 30 connection up "$selected_connection" ifname "$UPLINK_INTERFACE"
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
  echo "[ERRO] A conexao '$selected_connection' nao recebeu gateway IPv4." >&2
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

echo "Internet: '$selected_connection' em $UPLINK_INTERFACE; Go2 local em $ROBOT_INTERFACE sem rota default."
