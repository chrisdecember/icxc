#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════
#  OPERATION: GOLDEN THRONE — multi-strategy rs-sdk farm launcher
#
#  Usage:
#    cd rs-sdk
#
#    # Launch the full 5-bot swarm (default):
#    bash /path/to/rs-sdk-farm/setup.sh [--server=host] [--local]
#
#    # Launch the lone wolf (single bot, no coordination needed):
#    bash /path/to/rs-sdk-farm/setup.sh --lone-wolf [--server=host]
#
#    # Launch just the king + select drones:
#    bash /path/to/rs-sdk-farm/setup.sh --bots=king,pickswing,netter
#
#  Options:
#    --local          Use localhost server
#    --server=HOST    Custom server address
#    --no-chat        Disable public chat display
#    --lone-wolf      Single-bot speedrun variant (creates "lonewolf" bot)
#    --bots=a,b,c     Launch only specific bots from the swarm
# ═══════════════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ALL_BOTS=("king" "fingers" "pickswing" "netter" "timber")
SERVER_FLAG=""
EXTRA_FLAGS=""
LONE_WOLF=false
CUSTOM_BOTS=""

for arg in "$@"; do
  case "$arg" in
    --local) SERVER_FLAG="--local" ;;
    --server=*) SERVER_FLAG="$arg" ;;
    --no-chat) EXTRA_FLAGS="$EXTRA_FLAGS --no-chat" ;;
    --lone-wolf) LONE_WOLF=true ;;
    --bots=*) CUSTOM_BOTS="${arg#--bots=}" ;;
  esac
done

if [ "$LONE_WOLF" = true ]; then
  echo "╔══════════════════════════════════════════════╗"
  echo "║         THE LONE WOLF — Solo Speedrun         ║"
  echo "║   One bot. Every skill. No mercy.             ║"
  echo "╚══════════════════════════════════════════════╝"
  echo ""

  BOT_NAME="lonewolf"

  if [ ! -d "bots/$BOT_NAME" ]; then
    bun bots/create-bot.ts "$BOT_NAME" $SERVER_FLAG $EXTRA_FLAGS
  fi

  if [ -f "$SCRIPT_DIR/bots/$BOT_NAME/script.ts" ]; then
    cp "$SCRIPT_DIR/bots/$BOT_NAME/script.ts" "bots/$BOT_NAME/script.ts"
    echo "[SETUP] Lone wolf script deployed"
  else
    echo "[ERROR] Lone wolf script not found!"
    exit 1
  fi

  echo "[SETUP] Launching the lone wolf..."
  echo ""
  exec bun "bots/$BOT_NAME/script.ts"
fi

# Determine which bots to launch
if [ -n "$CUSTOM_BOTS" ]; then
  IFS=',' read -ra BOTS <<< "$CUSTOM_BOTS"
else
  BOTS=("${ALL_BOTS[@]}")
fi

echo "╔══════════════════════════════════════════════╗"
echo "║       OPERATION: GOLDEN THRONE               ║"
echo "║   ${#BOTS[@]}-bot coordinated swarm deployment          ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# Step 1: Create bot accounts
echo "[SETUP] Creating bot accounts..."
for name in "${BOTS[@]}"; do
  if [ -d "bots/$name" ]; then
    echo "  + $name already exists"
  else
    bun bots/create-bot.ts "$name" $SERVER_FLAG $EXTRA_FLAGS
    echo "  + $name created"
  fi
done

# Step 2: Copy custom scripts
echo ""
echo "[SETUP] Deploying swarm scripts..."
for name in "${BOTS[@]}"; do
  if [ -f "$SCRIPT_DIR/bots/$name/script.ts" ]; then
    cp "$SCRIPT_DIR/bots/$name/script.ts" "bots/$name/script.ts"
    echo "  + $name script deployed"
  else
    echo "  ! $name script not found at $SCRIPT_DIR/bots/$name/script.ts"
  fi
done

# Step 3: Launch the swarm
echo ""
echo "[SETUP] Launching the swarm..."
echo ""

PIDS=()

for name in "${BOTS[@]}"; do
  echo "  >> Launching $name..."
  bun "bots/$name/script.ts" &
  PIDS+=($!)
  sleep 1
done

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  SWARM DEPLOYED                               ║"
echo "║                                               ║"
for name in "${BOTS[@]}"; do
  case "$name" in
    king)      printf "║  %-10s Leaderboard contender            ║\n" "$name" ;;
    fingers)   printf "║  %-10s Pickpocket GP machine             ║\n" "$name" ;;
    pickswing) printf "║  %-10s Ore supplier (SE Varrock)         ║\n" "$name" ;;
    netter)    printf "║  %-10s Fish supplier (Draynor)           ║\n" "$name" ;;
    timber)    printf "║  %-10s Log supplier (Lumbridge)          ║\n" "$name" ;;
    lonewolf)  printf "║  %-10s Solo speedrunner                  ║\n" "$name" ;;
    *)         printf "║  %-10s Custom bot                        ║\n" "$name" ;;
  esac
done
echo "║                                               ║"
echo "║  PIDs: ${PIDS[*]}"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "Press Ctrl+C to abort all bots."

trap 'echo ""; echo "[SETUP] Shutting down swarm..."; kill "${PIDS[@]}" 2>/dev/null; exit 0' INT TERM

wait
