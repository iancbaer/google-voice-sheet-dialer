#!/usr/bin/env bash
set -u

AIRPODS_MAC="9C:A9:C5:1B:DB:EF"
AIRPODS_CARD_FALLBACK="bluez_card.9C_A9_C5_1B_DB_EF"
AIRPODS_NAME_REGEX="airpods|ian.*airpods"
MIC_SOURCE="forced_alsa_mic"
MIC_DEVICE="hw:0,0"
LAST_CONNECT_ATTEMPT=0

now_s() { date +%s; }

card_exists() {
  pactl list cards short 2>/dev/null | awk '{print $2}' | grep -qx "$1"
}

sink_exists() {
  pactl list short sinks 2>/dev/null | awk '{print $2}' | grep -qx "$1"
}

find_airpods_card() {
  local card
  card=$(pactl list cards 2>/dev/null | awk -v rx="$AIRPODS_NAME_REGEX" '
    /^Card #/ { card="" }
    /Name: bluez_card\./ { card=$2 }
    /device.description =/ { desc=tolower($0); if (card != "" && desc ~ rx) print card }
  ' | head -n1)
  if [ -n "$card" ]; then
    printf '%s\n' "$card"
  elif card_exists "$AIRPODS_CARD_FALLBACK"; then
    printf '%s\n' "$AIRPODS_CARD_FALLBACK"
  fi
}

find_airpods_sink() {
  local card="$1"
  local mac_part=""
  mac_part=$(printf '%s' "$card" | sed 's/^bluez_card\.//')
  pactl list short sinks 2>/dev/null | awk -v mac="$mac_part" '$2 ~ "^bluez_output\\." mac {print $2}' | head -n1
}

try_reconnect_airpods() {
  command -v bluetoothctl >/dev/null 2>&1 || return 0
  local now last_delta
  now=$(now_s)
  last_delta=$((now - LAST_CONNECT_ATTEMPT))
  [ "$last_delta" -lt 20 ] && return 0
  LAST_CONNECT_ATTEMPT=$now

  if bluetoothctl info "$AIRPODS_MAC" 2>/dev/null | grep -q "Connected: yes"; then
    return 0
  fi

  # Non-fatal. If the AirPods are in the case or paired elsewhere, this will fail cleanly.
  timeout 8 bluetoothctl connect "$AIRPODS_MAC" >/dev/null 2>&1 || true
}

ensure_forced_mic() {
  if ! pactl list short sources 2>/dev/null | awk '{print $2}' | grep -qx "$MIC_SOURCE"; then
    pactl load-module module-alsa-source device="$MIC_DEVICE" source_name="$MIC_SOURCE" >/dev/null 2>&1 || true
  fi
  pactl set-source-mute "$MIC_SOURCE" 0 >/dev/null 2>&1 || true
  pactl set-source-volume "$MIC_SOURCE" 100% >/dev/null 2>&1 || true
  pactl set-default-source "$MIC_SOURCE" >/dev/null 2>&1 || true
}

ensure_alsa_capture_controls() {
  amixer -q -c 0 sset 'Capture',0 100% cap >/dev/null 2>&1 || true
  amixer -q -c 0 sset 'Capture',1 100% cap >/dev/null 2>&1 || true
  amixer -q -c 0 sset 'Headphone Mic Boost' 3 >/dev/null 2>&1 || true
  amixer -q -c 0 sset 'Headset Mic Boost' 3 >/dev/null 2>&1 || true
  amixer -q -c 0 sset 'Input Source',0 'Headset Mic' >/dev/null 2>&1 || true
  amixer -q -c 0 sset 'Input Source',1 'Headset Mic' >/dev/null 2>&1 || true
}

ensure_airpods_output() {
  local card sink
  card=$(find_airpods_card || true)
  if [ -z "$card" ]; then
    try_reconnect_airpods
    card=$(find_airpods_card || true)
  fi
  [ -z "$card" ] && return 0

  pactl set-card-profile "$card" a2dp-sink-sbc_xq >/dev/null 2>&1 \
    || pactl set-card-profile "$card" a2dp-sink-aac >/dev/null 2>&1 \
    || pactl set-card-profile "$card" a2dp-sink >/dev/null 2>&1 \
    || true

  sink=$(find_airpods_sink "$card" || true)
  if [ -n "$sink" ] && sink_exists "$sink"; then
    pactl set-sink-mute "$sink" 0 >/dev/null 2>&1 || true
    pactl set-sink-volume "$sink" 100% >/dev/null 2>&1 || true
    pactl set-default-sink "$sink" >/dev/null 2>&1 || true

    pactl list short sink-inputs 2>/dev/null | awk '{print $1}' | while read -r id; do
      [ -n "$id" ] && pactl move-sink-input "$id" "$sink" >/dev/null 2>&1 || true
    done
  fi
}

move_live_inputs_to_forced_mic() {
  pactl list short source-outputs 2>/dev/null | awk '{print $1}' | while read -r id; do
    [ -n "$id" ] && pactl move-source-output "$id" "$MIC_SOURCE" >/dev/null 2>&1 || true
  done
}

while true; do
  ensure_alsa_capture_controls
  ensure_forced_mic
  ensure_airpods_output
  move_live_inputs_to_forced_mic
  sleep 2
done
