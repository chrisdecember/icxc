#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════
#  OPERATION: GOLDEN THRONE — 5-bot coordinated swarm launcher
#
#  Usage:
#    cd rs-sdk
#    bash /path/to/rs-sdk-farm/setup.sh [--server=host] [--local]
#
#  This script:
#    1. Creates 5 bot accounts (king, fingers, pickswing, netter, timber)
#    2. Copies the custom scripts into each bot directory
#    3. Launches all 5 bots in parallel
#    4. THE SWARM BEGINS
# ═══════════════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOTS=("king" "fingers" "pickswing" "netter" "timber")
SERVER_FLAG=""
EXTRA_FLAGS=""

for arg in "$@"; do
  case "$arg" in
    --local) SERVER_FLAG="--local" ;;
    --server=*) SERVER_FLAG="$arg" ;;
    --no-chat) EXTRA_FLAGS="$EXTRA_FLAGS --no-chat" ;;
  esac
done

echo "╔══════════════════════════════════════════════╗"
echo "║       OPERATION: GOLDEN THRONE               ║"
echo "║   5-bot coordinated swarm deployment          ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# Step 1: Create bot accounts
echo "[SETUP] Creating bot accounts..."
for name in "${BOTS[@]}"; do
  if [ -d "bots/$name" ]; then
    echo "  ✓ $name already exists"
  else
    bun bots/create-bot.ts "$name" $SERVER_FLAG $EXTRA_FLAGS
    echo "  ✓ $name created"
  fi
done

# Step 2: Copy custom scripts
echo ""
echo "[SETUP] Deploying swarm scripts..."
for name in "${BOTS[@]}"; do
  if [ -f "$SCRIPT_DIR/bots/$name/script.ts" ]; then
    cp "$SCRIPT_DIR/bots/$name/script.ts" "bots/$name/script.ts"
    echo "  ✓ $name script deployed"
  else
    echo "  ✗ $name script not found at $SCRIPT_DIR/bots/$name/script.ts"
  fi
done

# Step 3: Launch the swarm
echo ""
echo "[SETUP] Launching the swarm..."
echo ""

PIDS=()

for name in "${BOTS[@]}"; do
  echo "  🚀 Launching $name..."
  bun "bots/$name/script.ts" &
  PIDS+=($!)
  sleep 1  # stagger launches slightly
done

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  ALL BOTS DEPLOYED — THE THRONE AWAITS       ║"
echo "║                                               ║"
echo "║  king     → Leaderboard contender             ║"
echo "║  fingers  → Pickpocket GP machine             ║"
echo "║  pickswing→ Ore supplier (SE Varrock)         ║"
echo "║  netter   → Fish supplier (Draynor)           ║"
echo "║  timber   → Log supplier (Lumbridge)          ║"
echo "║                                               ║"
echo "║  PIDs: ${PIDS[*]}"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "Press Ctrl+C to abort all bots."

# Wait for all bots (or Ctrl+C to kill them all)
trap 'echo ""; echo "[SETUP] Shutting down swarm..."; kill "${PIDS[@]}" 2>/dev/null; exit 0' INT TERM

wait
